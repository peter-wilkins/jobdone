/**
 * IndexedDB service for local entry storage
 * Handles persistence of recordings, transcripts, and metadata
 */

const DB_NAME = 'plumber-job-log';
const DB_VERSION = 8;
const STORE_NAME = 'entries';
const FEEDBACK_STORE = 'feedback';
const QUERIES_STORE = 'queries';
const CAPTURES_STORE = 'captures';
const PEOPLE_STORE = 'people';

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function containsExactPhrase(haystack, phrase) {
  const normalizedHaystack = ` ${normalizeSearchText(haystack)} `;
  const normalizedPhrase = normalizeSearchText(phrase);
  if (!normalizedPhrase) return false;
  return normalizedHaystack.includes(` ${normalizedPhrase} `);
}

export function entryMentionsPerson(entry, person) {
  const displayName = normalizeSearchText(person?.displayName);
  if (!displayName) return false;

  const searchableText = [
    entry?.summary,
    entry?.transcript,
  ].filter(Boolean).join(' ');

  return containsExactPhrase(searchableText, displayName);
}

export class DBService {
  constructor() {
    this.db = null;
    this.initPromise = null;
  }

  /**
   * Initialize database
   */
  async init() {
    if (this.db) return this.db;
    if (this.initPromise) return this.initPromise;

    const openOnce = () => new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        reject(new Error(request.error?.message || 'Failed to open database'));
      };

      request.onblocked = () => {
        reject(new Error('Database upgrade blocked. Close other JobDone tabs and reload.'));
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.db.onversionchange = () => {
          this.db.close();
          this.db = null;
        };
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // v4: rename jobs → entries (drop old store, no prod users)
        if (db.objectStoreNames.contains('jobs')) {
          db.deleteObjectStore('jobs');
        }

        // Entries store
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('created_at', 'created_at', { unique: false });
          store.createIndex('sync_status', 'syncStatus', { unique: false });
          store.createIndex('remoteId', 'remoteId', { unique: false });
          store.createIndex('captureId', 'captureId', { unique: false });
        } else {
          const store = event.target.transaction.objectStore(STORE_NAME);
          if (!store.indexNames.contains('captureId')) {
            store.createIndex('captureId', 'captureId', { unique: false });
          }
        }

        // v2: feedback store
        if (!db.objectStoreNames.contains(FEEDBACK_STORE)) {
          const feedbackStore = db.createObjectStore(FEEDBACK_STORE, { keyPath: 'id' });
          feedbackStore.createIndex('status', 'status', { unique: false });
          feedbackStore.createIndex('created_at', 'created_at', { unique: false });
        }

        // v5: queries store for QUERY intents
        if (!db.objectStoreNames.contains(QUERIES_STORE)) {
          const queriesStore = db.createObjectStore(QUERIES_STORE, { keyPath: 'id' });
          queriesStore.createIndex('created_at', 'created_at', { unique: false });
          queriesStore.createIndex('syncStatus', 'syncStatus', { unique: false });
        }

        // v6: local-only Capture Inbox for pre-confirmation material
        if (!db.objectStoreNames.contains(CAPTURES_STORE)) {
          const capturesStore = db.createObjectStore(CAPTURES_STORE, { keyPath: 'id' });
          capturesStore.createIndex('status', 'status', { unique: false });
          capturesStore.createIndex('created_at', 'created_at', { unique: false });
          capturesStore.createIndex('source', 'source', { unique: false });
          capturesStore.createIndex('kind', 'kind', { unique: false });
        }

        // v8: local-first People store
        if (!db.objectStoreNames.contains(PEOPLE_STORE)) {
          const peopleStore = db.createObjectStore(PEOPLE_STORE, { keyPath: 'id' });
          peopleStore.createIndex('status', 'status', { unique: false });
          peopleStore.createIndex('created_at', 'created_at', { unique: false });
          peopleStore.createIndex('updated_at', 'updated_at', { unique: false });
          peopleStore.createIndex('primaryEmail', 'primaryEmail', { unique: false });
          peopleStore.createIndex('primaryPhone', 'primaryPhone', { unique: false });
        }
      };
    });

    this.initPromise = (async () => {
      try {
        return await openOnce();
      } catch (error) {
        console.warn('[DB] Open failed, resetting local database:', error.message);
        await new Promise((resolve) => {
          const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
          deleteRequest.onsuccess = () => resolve();
          deleteRequest.onerror = () => resolve();
          deleteRequest.onblocked = () => resolve();
        });
        return await openOnce();
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  /**
   * Create a new entry
   * @param {Object} entryData - Entry metadata
   * @param {Blob} audioBlob - Audio recording blob
   * @returns {Promise<string>} Entry ID
   */
  async createEntry(entryData, audioBlob) {
    const db = await this.ensureDb();

    const entry = {
      id: this.generateId(),
      ...entryData,
      audioBlob,
      audioSize: audioBlob.size,
      audioDuration: entryData.duration,
      status: 'recording',
      syncStatus: 'pending',
      remoteId: null,
      created_at: new Date().toISOString(),
      synced_at: null,
      captureId: null,
      transcript: null,
      summary: null,
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.add(entry);

      request.onsuccess = () => {
        resolve(entry.id);
      };

      request.onerror = () => {
        reject(new Error('Failed to create entry'));
      };
    });
  }

  /**
   * Update entry with transcription + summary data
   */
  async updateEntryWithTranscription(entryId, { transcript, summary, intent }) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(entryId);

      getRequest.onsuccess = () => {
        const entry = getRequest.result;
        if (!entry) {
          reject(new Error('Entry not found'));
          return;
        }

        entry.transcript = transcript;
        entry.summary = summary;
        if (intent) entry.intent = intent;
        entry.errorMessage = null;
        entry.status = 'ready_for_review';

        const updateRequest = store.put(entry);

        updateRequest.onsuccess = () => {
          resolve(entry);
        };

        updateRequest.onerror = () => {
          reject(new Error('Failed to update entry'));
        };
      };

      getRequest.onerror = () => {
        reject(new Error('Failed to fetch entry'));
      };
    });
  }

  /**
   * Update entry with arbitrary fields
   * @param {string} entryId
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated entry
   */
  async updateEntry(entryId, updates) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(entryId);

      getRequest.onsuccess = () => {
        const entry = getRequest.result;
        if (!entry) {
          reject(new Error('Entry not found'));
          return;
        }

        // Apply updates
        Object.assign(entry, updates);

        const updateRequest = store.put(entry);

        updateRequest.onsuccess = () => {
          resolve(entry);
        };

        updateRequest.onerror = () => {
          reject(new Error('Failed to update entry'));
        };
      };

      getRequest.onerror = () => {
        reject(new Error('Failed to fetch entry'));
      };
    });
  }

  /**
   * Confirm an entry (delete audio, move to saved)
   */
  async confirmEntry(entryId) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(entryId);

      getRequest.onsuccess = () => {
        const entry = getRequest.result;
        if (!entry) {
          reject(new Error('Entry not found'));
          return;
        }

        // Delete audio blob to save space
        entry.audioBlob = null;
        entry.status = 'confirmed';
        entry.syncStatus = 'pending';

        const updateRequest = store.put(entry);

        updateRequest.onsuccess = () => {
          resolve(entry);
        };

        updateRequest.onerror = () => {
          reject(new Error('Failed to confirm entry'));
        };
      };

      getRequest.onerror = () => {
        reject(new Error('Failed to fetch entry'));
      };
    });
  }

  /**
   * Create an Entry directly from a Capture (for share-target text/link confirms).
   * Entry is created as 'confirmed' since user already reviewed.
   * @param {object} params
   * @param {string} params.captureId - Source capture ID (for reference)
   * @param {string} params.transcript - Entry transcript
   * @param {string} params.summary - Entry summary
   * @param {string} [params.created_at] - Optional timestamp (defaults to now)
   * @returns {Promise<string>} New entry ID
   */
  async createEntryFromCapture({ captureId, transcript, summary, created_at }) {
    const db = await this.ensureDb();

    const entry = {
      id: this.generateId(),
      captureId,
      transcript,
      summary,
      audioBlob: null,
      audioSize: 0,
      audioDuration: null,
      status: 'confirmed',
      syncStatus: 'pending',
      remoteId: null,
      created_at: created_at || new Date().toISOString(),
      synced_at: null,
      intent: 'NOTE',
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.add(entry);

      request.onsuccess = () => resolve(entry.id);
      request.onerror = () => reject(new Error('Failed to create entry from capture'));
    });
  }

  /**
   * Reject an entry (delete it)
   */
  async rejectEntry(entryId) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(entryId);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(new Error('Failed to delete entry'));
      };
    });
  }

  /**
   * Get all entries, optionally filtered by status
   */
  async getEntries(status = null) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);

      let request;
      if (status) {
        const index = store.index('status');
        request = index.getAll(status);
      } else {
        request = store.getAll();
      }

      request.onsuccess = () => {
        // Remove audioBlob from results (not needed in list view)
        const entries = request.result.map(entry => ({
          ...entry,
          audioBlob: undefined,
        }));
        // Sort by created_at descending
        entries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        resolve(entries);
      };

      request.onerror = () => {
        reject(new Error('Failed to fetch entries'));
      };
    });
  }

  /**
   * Get a single entry by ID (includes audio blob)
   */
  async getEntry(entryId) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(entryId);

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(new Error('Failed to fetch entry'));
      };
    });
  }

  /**
   * Mark an entry as failed (transcription error)
   */
  async markEntryFailed(entryId, errorMessage) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(entryId);

      getRequest.onsuccess = () => {
        const entry = getRequest.result;
        if (!entry) { reject(new Error('Entry not found')); return; }

        entry.status = 'failed';
        entry.errorMessage = errorMessage || 'Failed to process recording';

        const updateRequest = store.put(entry);
        updateRequest.onsuccess = () => resolve(entry);
        updateRequest.onerror = () => reject(new Error('Failed to mark entry failed'));
      };

      getRequest.onerror = () => reject(new Error('Failed to fetch entry'));
    });
  }

  /**
   * Reset a failed entry back to recording status (for retry)
   */
  async resetEntryForRetry(entryId) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(entryId);

      getRequest.onsuccess = () => {
        const entry = getRequest.result;
        if (!entry) { reject(new Error('Entry not found')); return; }

        entry.status = 'recording';
        entry.errorMessage = null;

        const updateRequest = store.put(entry);
        updateRequest.onsuccess = () => resolve(entry);
        updateRequest.onerror = () => reject(new Error('Failed to reset entry'));
      };

      getRequest.onerror = () => reject(new Error('Failed to fetch entry'));
    });
  }

  /**
   * Mark an entry as successfully synced to cloud
   * @param {string} entryId - local entry id
   * @param {string|null} remoteId - Supabase UUID returned from the server
   */
  async markEntrySynced(entryId, remoteId = null) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(entryId);

      getRequest.onsuccess = () => {
        const entry = getRequest.result;
        if (!entry) { reject(new Error('Entry not found')); return; }

        entry.syncStatus = 'synced';
        entry.synced_at = new Date().toISOString();
        entry.remoteId = remoteId;

        const updateRequest = store.put(entry);
        updateRequest.onsuccess = () => resolve(entry);
        updateRequest.onerror = () => reject(new Error('Failed to mark entry synced'));
      };

      getRequest.onerror = () => reject(new Error('Failed to fetch entry'));
    });
  }

  /** Get confirmed entries that haven't been synced to cloud yet */
  async getConfirmedEntriesUnsynced() {
    const confirmed = await this.getEntries('confirmed');
    return confirmed.filter(e => !e.remoteId);
  }

  /** Find a local entry by its Supabase remote ID */
  async getEntryByRemoteId(remoteId) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([STORE_NAME], 'readonly').objectStore(STORE_NAME);
      const req = store.index('remoteId').get(remoteId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(new Error('Failed to query entry by remoteId'));
    });
  }

  /** Find a local entry by its original creation timestamp */
  async getEntryByCreatedAt(createdAt) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([STORE_NAME], 'readonly').objectStore(STORE_NAME);
      const req = store.index('created_at').get(createdAt);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(new Error('Failed to query entry by created_at'));
    });
  }

  /** Find a local entry by its originating Capture ID */
  async getEntryByCaptureId(captureId) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([STORE_NAME], 'readonly').objectStore(STORE_NAME);
      const req = store.index('captureId').get(captureId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(new Error('Failed to query entry by captureId'));
    });
  }

  /** Add an entry fetched from the cloud into local IndexedDB as confirmed */
  async addCloudEntry(cloudJob) {
    const db = await this.ensureDb();
    const entry = {
      id: `entry-cloud-${cloudJob.id}`,
      remoteId: cloudJob.id,
      audioBlob: null,
      audioSize: 0,
      audioDuration: null,
      status: 'confirmed',
      syncStatus: 'synced',
      errorMessage: null,
      transcript: cloudJob.transcript,
      summary: cloudJob.summary,
      created_at: cloudJob.created_at,
      synced_at: cloudJob.synced_at,
      captureId: cloudJob.capture_id || cloudJob.captureId || null,
    };
    return new Promise((resolve, reject) => {
      const req = db.transaction([STORE_NAME], 'readwrite').objectStore(STORE_NAME).add(entry);
      req.onsuccess = () => resolve(entry);
      req.onerror = () => reject(new Error('Failed to add cloud entry'));
    });
  }

  /**
   * Get entries pending sync
   */
  async getPendingSyncEntries() {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('sync_status');
      const request = index.getAll('pending');

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(new Error('Failed to fetch pending entries'));
      };
    });
  }

  /**
   * Ensure database is initialized
   */
  async ensureDb() {
    if (this.db) return this.db;
    return this.init();
  }

  /**
   * Generate unique ID
   */
  generateId() {
    return `entry-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  generateCaptureId() {
    return `capture-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  generatePersonId() {
    return `person-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // ─── Captures ────────────────────────────────────────────────────────────

  /**
   * Create a local-only Capture. Captures never sync before Confirmation.
   *
   * @param {object} captureData
   * @param {string} captureData.source - e.g. voice, share_target, manual
   * @param {Array<object>} captureData.payloads - raw reviewable payload metadata
   * @param {string} [captureData.status] - lifecycle status, defaults ready_for_review
   */
  async createCapture({ source = 'manual', payloads = [], status = 'ready_for_review', kind = 'entry', ...rest } = {}) {
    if (!Array.isArray(payloads) || payloads.length === 0) {
      throw new Error('Cannot create capture without payloads');
    }

    const db = await this.ensureDb();
    const now = new Date().toISOString();
    const capture = {
      id: this.generateCaptureId(),
      source,
      kind,
      payloads,
      status,
      errorMessage: null,
      created_at: now,
      updated_at: now,
      ...rest,
    };

    return new Promise((resolve, reject) => {
      const request = db
        .transaction([CAPTURES_STORE], 'readwrite')
        .objectStore(CAPTURES_STORE)
        .add(capture);

      request.onsuccess = () => resolve(capture.id);
      request.onerror = () => reject(new Error('Failed to create capture'));
    });
  }

  async getCapture(captureId) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const request = db
        .transaction([CAPTURES_STORE], 'readonly')
        .objectStore(CAPTURES_STORE)
        .get(captureId);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(new Error('Failed to fetch capture'));
    });
  }

  async getCaptures(status = null) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const store = db.transaction([CAPTURES_STORE], 'readonly').objectStore(CAPTURES_STORE);
      const request = status ? store.index('status').getAll(status) : store.getAll();

      request.onsuccess = () => {
        const captures = request.result
          .filter(capture => capture.status !== 'confirmed' && capture.status !== 'rejected')
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        resolve(captures);
      };
      request.onerror = () => reject(new Error('Failed to fetch captures'));
    });
  }

  async updateCapture(captureId, updates) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const store = db.transaction([CAPTURES_STORE], 'readwrite').objectStore(CAPTURES_STORE);
      const getRequest = store.get(captureId);

      getRequest.onsuccess = () => {
        const capture = getRequest.result;
        if (!capture) { reject(new Error('Capture not found')); return; }

        Object.assign(capture, updates, { updated_at: new Date().toISOString() });
        const putRequest = store.put(capture);
        putRequest.onsuccess = () => resolve(capture);
        putRequest.onerror = () => reject(new Error('Failed to update capture'));
      };
      getRequest.onerror = () => reject(new Error('Failed to fetch capture'));
    });
  }

  async rejectCapture(captureId) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const request = db
        .transaction([CAPTURES_STORE], 'readwrite')
        .objectStore(CAPTURES_STORE)
        .delete(captureId);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to reject capture'));
    });
  }

  // ─── People ─────────────────────────────────────────────────────────────

  async createPerson(personData) {
    const db = await this.ensureDb();
    const now = new Date().toISOString();
    const person = {
      id: this.generatePersonId(),
      status: 'confirmed',
      displayName: '',
      givenName: '',
      familyName: '',
      organization: '',
      title: '',
      note: '',
      phones: [],
      emails: [],
      normalizedPhones: [],
      normalizedEmails: [],
      primaryPhone: null,
      primaryEmail: null,
      sourceCaptureIds: [],
      remoteId: null,
      syncStatus: 'pending',
      synced_at: null,
      created_at: now,
      updated_at: now,
      ...personData,
    };

    const tx = db.transaction([PEOPLE_STORE], 'readwrite');
    const request = tx.objectStore(PEOPLE_STORE).add(person);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(person);
      request.onerror = () => reject(new Error('Failed to create person'));
    });
  }

  async getPerson(personId) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction([PEOPLE_STORE], 'readonly').objectStore(PEOPLE_STORE).get(personId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(new Error('Failed to fetch person'));
    });
  }

  async deletePerson(personId) {
    const linkedEntries = await this.getEntriesForPerson(personId);
    if (linkedEntries.length > 0) {
      throw new Error('Cannot delete a person linked to entries');
    }

    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction([PEOPLE_STORE], 'readwrite').objectStore(PEOPLE_STORE).delete(personId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to delete person'));
    });
  }

  async getPeople(status = 'confirmed') {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([PEOPLE_STORE], 'readonly').objectStore(PEOPLE_STORE);
      const request = status ? store.index('status').getAll(status) : store.getAll();
      request.onsuccess = () => {
        const people = (request.result || []).sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
        resolve(people);
      };
      request.onerror = () => reject(new Error('Failed to fetch people'));
    });
  }

  async searchPeople(query) {
    const people = await this.getPeople('confirmed');
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return people;

    return people.filter(person => {
      const haystack = [
        person.displayName,
        person.givenName,
        person.familyName,
        person.organization,
        person.title,
        ...(person.emails || []).map(email => email.value),
        ...(person.phones || []).map(phone => phone.value),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }

  async getEntriesForPerson(personId) {
    const person = await this.getPerson(personId);
    if (!person) return [];

    const sourceCaptureIds = new Set((person.sourceCaptureIds || []).filter(Boolean));
    const entries = await this.getEntries('confirmed');
    return entries.filter(entry =>
      (entry.captureId && sourceCaptureIds.has(entry.captureId)) ||
      (Array.isArray(entry.personIds) && entry.personIds.includes(personId)) ||
      entryMentionsPerson(entry, person)
    );
  }

  async findPeopleByContactKeys({ normalizedEmails = [], normalizedPhones = [] } = {}) {
    const people = await this.getPeople('confirmed');
    const emailSet = new Set((normalizedEmails || []).filter(Boolean));
    const phoneSet = new Set((normalizedPhones || []).filter(Boolean));

    return people.filter(person =>
      (person.normalizedEmails || []).some(email => emailSet.has(email)) ||
      (person.normalizedPhones || []).some(phone => phoneSet.has(phone))
    );
  }

  async upsertPerson(personData) {
    const db = await this.ensureDb();
    const now = new Date().toISOString();
    const normalizedEmails = Array.from(new Set((personData.normalizedEmails || []).filter(Boolean)));
    const normalizedPhones = Array.from(new Set((personData.normalizedPhones || []).filter(Boolean)));
    const matches = await this.findPeopleByContactKeys({ normalizedEmails, normalizedPhones });
    const existing = matches[0] || null;
    const primaryEmail = normalizedEmails[0] || null;
    const primaryPhone = normalizedPhones[0] || null;

    if (!existing) {
      return this.createPerson({
        ...personData,
        normalizedEmails,
        normalizedPhones,
        primaryEmail,
        primaryPhone,
      });
    }

    const merged = {
      ...existing,
      displayName: personData.displayName || existing.displayName,
      givenName: personData.givenName || existing.givenName,
      familyName: personData.familyName || existing.familyName,
      organization: personData.organization || existing.organization,
      title: personData.title || existing.title,
      note: personData.note || existing.note,
      phones: this.mergeContactValues(existing.phones, personData.phones),
      emails: this.mergeContactValues(existing.emails, personData.emails),
      normalizedPhones: Array.from(new Set([...(existing.normalizedPhones || []), ...normalizedPhones])),
      normalizedEmails: Array.from(new Set([...(existing.normalizedEmails || []), ...normalizedEmails])),
      primaryPhone: existing.primaryPhone || primaryPhone,
      primaryEmail: existing.primaryEmail || primaryEmail,
      sourceCaptureIds: Array.from(new Set([...(existing.sourceCaptureIds || []), ...(personData.sourceCaptureIds || [])])),
      syncStatus: 'pending',
      updated_at: now,
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction([PEOPLE_STORE], 'readwrite');
      const store = tx.objectStore(PEOPLE_STORE);
      const req = store.put(merged);
      req.onsuccess = () => resolve(merged);
      req.onerror = () => reject(new Error('Failed to update person'));
    });
  }

  mergeContactValues(existingValues = [], incomingValues = []) {
    const merged = [...existingValues];
    for (const value of incomingValues || []) {
      const key = value?.normalized || value?.value;
      if (!key) continue;
      if (!merged.some(item => (item?.normalized || item?.value) === key)) {
        merged.push(value);
      }
    }
    return merged;
  }

  async getPeopleUnsynced() {
    const people = await this.getPeople('confirmed');
    return people.filter(person => person.syncStatus !== 'synced' || !person.remoteId);
  }

  async markPersonSynced(personId, remoteId = null) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([PEOPLE_STORE], 'readwrite').objectStore(PEOPLE_STORE);
      const request = store.get(personId);

      request.onsuccess = () => {
        const person = request.result;
        if (!person) { reject(new Error('Person not found')); return; }

        const synced = {
          ...person,
          remoteId: remoteId || person.remoteId,
          syncStatus: 'synced',
          synced_at: new Date().toISOString(),
        };
        const updateRequest = store.put(synced);
        updateRequest.onsuccess = () => resolve(synced);
        updateRequest.onerror = () => reject(new Error('Failed to mark person synced'));
      };

      request.onerror = () => reject(new Error('Failed to fetch person'));
    });
  }

  async upsertCloudPerson(cloudPerson) {
    const normalizedEmails = Array.from(new Set((cloudPerson.normalized_emails || []).filter(Boolean)));
    const normalizedPhones = Array.from(new Set((cloudPerson.normalized_phones || []).filter(Boolean)));
    const matches = await this.findPeopleByContactKeys({ normalizedEmails, normalizedPhones });
    const existing = matches.find(person => person.remoteId === cloudPerson.id) || matches[0] || null;
    const personData = {
      displayName: cloudPerson.display_name || '',
      givenName: cloudPerson.given_name || '',
      familyName: cloudPerson.family_name || '',
      organization: cloudPerson.organization || '',
      title: cloudPerson.title || '',
      note: cloudPerson.note || '',
      phones: cloudPerson.phones || [],
      emails: cloudPerson.emails || [],
      normalizedPhones,
      normalizedEmails,
      primaryPhone: cloudPerson.primary_phone || normalizedPhones[0] || null,
      primaryEmail: cloudPerson.primary_email || normalizedEmails[0] || null,
      sourceCaptureIds: cloudPerson.source_capture_ids || [],
      remoteId: cloudPerson.id,
      syncStatus: 'synced',
      synced_at: new Date().toISOString(),
    };

    if (!existing) {
      return this.createPerson({
        ...personData,
        id: cloudPerson.local_id || this.generatePersonId(),
        created_at: cloudPerson.created_at || new Date().toISOString(),
        updated_at: cloudPerson.updated_at || cloudPerson.created_at || new Date().toISOString(),
      });
    }

    const db = await this.ensureDb();
    const merged = {
      ...existing,
      ...personData,
      displayName: personData.displayName || existing.displayName,
      phones: this.mergeContactValues(existing.phones, personData.phones),
      emails: this.mergeContactValues(existing.emails, personData.emails),
      normalizedPhones: Array.from(new Set([...(existing.normalizedPhones || []), ...normalizedPhones])),
      normalizedEmails: Array.from(new Set([...(existing.normalizedEmails || []), ...normalizedEmails])),
      sourceCaptureIds: Array.from(new Set([...(existing.sourceCaptureIds || []), ...personData.sourceCaptureIds])),
      updated_at: cloudPerson.updated_at || existing.updated_at,
    };

    return new Promise((resolve, reject) => {
      const request = db.transaction([PEOPLE_STORE], 'readwrite').objectStore(PEOPLE_STORE).put(merged);
      request.onsuccess = () => resolve(merged);
      request.onerror = () => reject(new Error('Failed to save cloud person'));
    });
  }

  // ─── Feedback ────────────────────────────────────────────────────────────

  async createFeedback(meta, audioBlob) {
    const db = await this.ensureDb();
    const item = {
      id: `fb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      audioBlob,
      audioSize: audioBlob.size,
      audioDuration: meta.duration,
      status: 'recording',
      syncStatus: 'pending',
      errorMessage: null,
      transcript: null,
      created_at: new Date().toISOString(),
      synced_at: null,
    };
    return new Promise((resolve, reject) => {
      const tx = db.transaction([FEEDBACK_STORE], 'readwrite');
      tx.objectStore(FEEDBACK_STORE).add(item).onsuccess = () => resolve(item.id);
      tx.onerror = () => reject(new Error('Failed to create feedback'));
    });
  }

  async getFeedbackItem(id) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction([FEEDBACK_STORE], 'readonly').objectStore(FEEDBACK_STORE).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error('Failed to fetch feedback item'));
    });
  }

  async getFeedbackItems(status = null) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([FEEDBACK_STORE], 'readonly').objectStore(FEEDBACK_STORE);
      const req = status ? store.index('status').getAll(status) : store.getAll();
      req.onsuccess = () => {
        const items = req.result.map(f => ({ ...f, audioBlob: undefined }));
        items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        resolve(items);
      };
      req.onerror = () => reject(new Error('Failed to fetch feedback items'));
    });
  }

  async updateFeedbackWithTranscript(id, transcript) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([FEEDBACK_STORE], 'readwrite').objectStore(FEEDBACK_STORE);
      const req = store.get(id);
      req.onsuccess = () => {
        const item = req.result;
        if (!item) { reject(new Error('Feedback item not found')); return; }
        item.transcript = transcript;
        item.errorMessage = null;
        item.status = 'ready_for_review';
        const put = store.put(item);
        put.onsuccess = () => resolve(item);
        put.onerror = () => reject(new Error('Failed to update feedback'));
      };
      req.onerror = () => reject(new Error('Failed to fetch feedback item'));
    });
  }

  async updateFeedback(id, updates) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([FEEDBACK_STORE], 'readwrite').objectStore(FEEDBACK_STORE);
      const req = store.get(id);
      req.onsuccess = () => {
        const item = req.result;
        if (!item) { reject(new Error('Feedback item not found')); return; }
        Object.assign(item, updates);
        const put = store.put(item);
        put.onsuccess = () => resolve(item);
        put.onerror = () => reject(new Error('Failed to update feedback'));
      };
      req.onerror = () => reject(new Error('Failed to fetch feedback item'));
    });
  }

  async confirmFeedback(id) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([FEEDBACK_STORE], 'readwrite').objectStore(FEEDBACK_STORE);
      const req = store.get(id);
      req.onsuccess = () => {
        const item = req.result;
        if (!item) { reject(new Error('Feedback item not found')); return; }
        item.audioBlob = null;
        item.status = 'confirmed';
        item.syncStatus = 'pending';
        const put = store.put(item);
        put.onsuccess = () => resolve(item);
        put.onerror = () => reject(new Error('Failed to confirm feedback'));
      };
      req.onerror = () => reject(new Error('Failed to fetch feedback item'));
    });
  }

  async rejectFeedback(id) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction([FEEDBACK_STORE], 'readwrite').objectStore(FEEDBACK_STORE).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(new Error('Failed to delete feedback'));
    });
  }

  async markFeedbackSynced(id) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([FEEDBACK_STORE], 'readwrite').objectStore(FEEDBACK_STORE);
      const req = store.get(id);
      req.onsuccess = () => {
        const item = req.result;
        if (!item) { reject(new Error('Feedback item not found')); return; }
        item.syncStatus = 'synced';
        item.synced_at = new Date().toISOString();
        const put = store.put(item);
        put.onsuccess = () => resolve(item);
        put.onerror = () => reject(new Error('Failed to mark feedback synced'));
      };
      req.onerror = () => reject(new Error('Failed to fetch feedback item'));
    });
  }

  async markFeedbackFailed(id, errorMessage) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([FEEDBACK_STORE], 'readwrite').objectStore(FEEDBACK_STORE);
      const req = store.get(id);
      req.onsuccess = () => {
        const item = req.result;
        if (!item) { reject(new Error('Feedback item not found')); return; }
        item.status = 'failed';
        item.errorMessage = errorMessage;
        const put = store.put(item);
        put.onsuccess = () => resolve(item);
        put.onerror = () => reject(new Error('Failed to mark feedback failed'));
      };
      req.onerror = () => reject(new Error('Failed to fetch feedback item'));
    });
  }

  async resetFeedbackForRetry(id) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([FEEDBACK_STORE], 'readwrite').objectStore(FEEDBACK_STORE);
      const req = store.get(id);
      req.onsuccess = () => {
        const item = req.result;
        if (!item) { reject(new Error('Feedback item not found')); return; }
        item.status = 'recording';
        item.errorMessage = null;
        const put = store.put(item);
        put.onsuccess = () => resolve(item);
        put.onerror = () => reject(new Error('Failed to reset feedback'));
      };
      req.onerror = () => reject(new Error('Failed to fetch feedback item'));
    });
  }

  // ─── Queries ────────────────────────────────────────────────────────────

  /**
   * Save a query to the queries table. Deduplicates by text.
   * @param {string} text - The query text
   * @param {string} [createdAt] - Optional ISO timestamp (for server sync)
   * @param {boolean} [isSynced] - Whether already synced to server
   * @returns {Promise<string>} Query ID
   */
  async saveQuery(text, createdAt, isSynced) {
    const db = await this.ensureDb();
    const now = new Date().toISOString();

    // Check for existing query with same text
    const existing = await this.findQueryByText(text);
    if (existing) {
      // Update created_at to bubble to top
      return this.updateQuery(existing.id, {
        created_at: createdAt || now,
      });
    }

    const query = {
      id: `query-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      text,
      syncStatus: isSynced ? 'synced' : 'pending',
      created_at: createdAt || now,
      synced_at: isSynced ? now : null,
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([QUERIES_STORE], 'readwrite');
      const store = transaction.objectStore(QUERIES_STORE);
      const request = store.add(query);

      request.onsuccess = () => resolve(query.id);
      request.onerror = () => reject(new Error('Failed to save query'));
    });
  }

  /**
   * Find a query by text
   */
  async findQueryByText(text) {
    const queries = await this.getQueries();
    return queries.find(q => q.text === text) || null;
  }

  /**
   * Update a query by ID
   */
  async updateQuery(queryId, updates) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([QUERIES_STORE], 'readwrite');
      const store = transaction.objectStore(QUERIES_STORE);
      const getRequest = store.get(queryId);

      getRequest.onsuccess = () => {
        const query = getRequest.result;
        if (!query) { reject(new Error('Query not found')); return; }
        Object.assign(query, updates);
        const put = store.put(query);
        put.onsuccess = () => resolve(query.id);
        put.onerror = () => reject(new Error('Failed to update query'));
      };
      getRequest.onerror = () => reject(new Error('Failed to fetch query'));
    });
  }

  /**
   * Mark a query as synced
   */
  async markQuerySynced(text) {
    const query = await this.findQueryByText(text);
    if (query) {
      await this.updateQuery(query.id, {
        syncStatus: 'synced',
        synced_at: new Date().toISOString(),
      });
    }
  }

  /**
   * Get up to `limit` queries, most recent first
   */
  async getQueries(limit = 50) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([QUERIES_STORE], 'readonly');
      const store = transaction.objectStore(QUERIES_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        const queries = request.result
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .slice(0, limit);
        resolve(queries);
      };

      request.onerror = () => reject(new Error('Failed to fetch queries'));
    });
  }

  /**
   * Clear all data (for testing)
   */
  async clearAll() {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME, QUERIES_STORE, FEEDBACK_STORE, CAPTURES_STORE, PEOPLE_STORE], 'readwrite');
      transaction.objectStore(STORE_NAME).clear();
      transaction.objectStore(QUERIES_STORE).clear();
      transaction.objectStore(FEEDBACK_STORE).clear();
      transaction.objectStore(CAPTURES_STORE).clear();
      transaction.objectStore(PEOPLE_STORE).clear();

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('Failed to clear database'));
    });
  }
}

// Singleton instance
export const dbService = new DBService();

// Initialize on import
dbService.init().catch(console.error);
