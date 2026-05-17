/**
 * IndexedDB service for local entry storage
 * Handles persistence of recordings, transcripts, and metadata
 */

const DB_NAME = 'plumber-job-log';
const DB_VERSION = 6;
const STORE_NAME = 'entries';
const FEEDBACK_STORE = 'feedback';
const QUERIES_STORE = 'queries';
const CAPTURES_STORE = 'captures';

export class DBService {
  constructor() {
    this.db = null;
  }

  /**
   * Initialize database
   */
  async init() {
    return new Promise((resolve, reject) => {
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
        }
      };
    });
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
      transcript: null,
      summary: null,
      materials: [],
      labour_minutes: null,
      follow_ups: [],
      possible_future_work: '',
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
  async updateEntryWithTranscription(entryId, { transcript, summary, materials, labour_minutes, follow_ups, possible_future_work, intent }) {
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
        entry.materials = materials || [];
        entry.labour_minutes = labour_minutes;
        entry.follow_ups = follow_ups || [];
        entry.possible_future_work = possible_future_work || '';
        if (intent) entry.intent = intent;
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
      materials: cloudJob.materials || [],
      labour_minutes: cloudJob.labour_minutes,
      follow_ups: cloudJob.follow_ups || [],
      possible_future_work: cloudJob.possible_future_work || '',
      created_at: cloudJob.created_at,
      synced_at: cloudJob.synced_at,
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
    if (!this.db) {
      await this.init();
    }
    return this.db;
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

  // ─── Captures ────────────────────────────────────────────────────────────

  /**
   * Create a local-only Capture. Captures never sync before Confirmation.
   *
   * @param {object} captureData
   * @param {string} captureData.source - e.g. voice, share_target, manual
   * @param {Array<object>} captureData.payloads - raw reviewable payload metadata
   * @param {string} [captureData.status] - lifecycle status, defaults ready_for_review
   */
  async createCapture({ source = 'manual', payloads = [], status = 'ready_for_review', ...rest } = {}) {
    if (!Array.isArray(payloads) || payloads.length === 0) {
      throw new Error('Cannot create capture without payloads');
    }

    const db = await this.ensureDb();
    const now = new Date().toISOString();
    const capture = {
      id: this.generateCaptureId(),
      source,
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
        item.status = 'ready_for_review';
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
      const transaction = db.transaction([STORE_NAME, QUERIES_STORE, FEEDBACK_STORE, CAPTURES_STORE], 'readwrite');
      transaction.objectStore(STORE_NAME).clear();
      transaction.objectStore(QUERIES_STORE).clear();
      transaction.objectStore(FEEDBACK_STORE).clear();
      transaction.objectStore(CAPTURES_STORE).clear();

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('Failed to clear database'));
    });
  }
}

// Singleton instance
export const dbService = new DBService();

// Initialize on import
dbService.init().catch(console.error);
