import { findReusableLocation } from './locationIdentityService.js';
import { entryMatchesLocation } from './locationPresentationService.js';

/**
 * IndexedDB service for local entry storage
 * Handles persistence of recordings, transcripts, and metadata
 */

const DB_NAME = 'plumber-job-log';
const DB_VERSION = 12;
const STORE_NAME = 'entries';
const FEEDBACK_STORE = 'feedback';
const QUERIES_STORE = 'queries';
const CAPTURES_STORE = 'captures';
const CONTEXT_CLUES_STORE = 'contextClues';
const LOCATIONS_STORE = 'locations';
const ENTRY_LOCATIONS_STORE = 'entryLocations';
const TAG_CATEGORIES_STORE = 'tagCategories';
const TAGS_STORE = 'tags';
const TAG_VOCABULARY_STORE = 'tagVocabulary';
const ENTRY_TAGS_STORE = 'entryTags';
const CONTACTS_STORE = 'contacts';
const DEFAULT_TAG_CATEGORY = {
  id: 'tag-category-general',
  name: 'General',
  slug: 'general',
};

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

const RESERVED_CONTEXT_CLUE_PAYLOAD_KEYS = new Set([
  'body',
  'description',
  'transcript',
  'contactDetails',
  'rawPayload',
]);

function compactPayload(payload = {}) {
  return Object.fromEntries(
    Object.entries(payload || {}).filter(([key, value]) =>
      !RESERVED_CONTEXT_CLUE_PAYLOAD_KEYS.has(key) && value !== undefined
    )
  );
}

function compactCalendarPayload(event = {}) {
  return compactPayload({
    title: event.title || '',
    start: event.start || event.start_at || null,
    end: event.end || event.end_at || null,
    locationText: event.locationText || event.location || '',
    attendeeHints: Array.isArray(event.attendeeHints) ? event.attendeeHints : [],
    providerIdHash: event.providerIdHash || event.sourceIdHash || null,
  });
}

function normalizeLocationText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLocationKey(value) {
  return normalizeLocationText(value).toLowerCase();
}

function normalizeTagLabel(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTagKey(value) {
  return normalizeTagLabel(value).toLowerCase();
}

function safeLocalKey(value) {
  return normalizeTagKey(value)
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'tag';
}

export function validateTagLabel(value) {
  if (/[\p{C}]/u.test(String(value || ''))) {
    return { valid: false, label: String(value || ''), error: 'Tags can use letters, numbers, spaces, hyphens, and underscores' };
  }
  const label = normalizeTagLabel(value);
  if (!label) return { valid: false, label, error: 'Tag is required' };
  if (label.length > 40) return { valid: false, label, error: 'Tags must be 40 characters or fewer' };
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u.test(label)) {
    return { valid: false, label, error: 'Tags can use letters, numbers, spaces, hyphens, and underscores' };
  }
  return { valid: true, label, error: null };
}

export function entryMentionsContact(entry, contact) {
  const displayName = normalizeSearchText(contact?.displayName);
  if (!displayName) return false;

  const searchableText = [
    entry?.summary,
    entry?.transcript,
  ].filter(Boolean).join(' ');

  return containsExactPhrase(searchableText, displayName);
}

export const entryMentionsPerson = entryMentionsContact;

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

        // v8: local-first Contacts store.
        if (!db.objectStoreNames.contains(CONTACTS_STORE)) {
          const contactStore = db.createObjectStore(CONTACTS_STORE, { keyPath: 'id' });
          contactStore.createIndex('status', 'status', { unique: false });
          contactStore.createIndex('created_at', 'created_at', { unique: false });
          contactStore.createIndex('updated_at', 'updated_at', { unique: false });
          contactStore.createIndex('primaryEmail', 'primaryEmail', { unique: false });
          contactStore.createIndex('primaryPhone', 'primaryPhone', { unique: false });
        }

        // v9: local Context Clue snapshots. Capture-linked clues stay local until Confirmation.
        if (!db.objectStoreNames.contains(CONTEXT_CLUES_STORE)) {
          const contextCluesStore = db.createObjectStore(CONTEXT_CLUES_STORE, { keyPath: 'id' });
          contextCluesStore.createIndex('captureId', 'captureId', { unique: false });
          contextCluesStore.createIndex('entryId', 'entryId', { unique: false });
          contextCluesStore.createIndex('remoteEntryId', 'remoteEntryId', { unique: false });
          contextCluesStore.createIndex('kind', 'kind', { unique: false });
          contextCluesStore.createIndex('created_at', 'created_at', { unique: false });
        }

        // v10: local-first Locations and immutable Entry-Location associations.
        if (!db.objectStoreNames.contains(LOCATIONS_STORE)) {
          const locationsStore = db.createObjectStore(LOCATIONS_STORE, { keyPath: 'id' });
          locationsStore.createIndex('status', 'status', { unique: false });
          locationsStore.createIndex('created_at', 'created_at', { unique: false });
          locationsStore.createIndex('updated_at', 'updated_at', { unique: false });
          locationsStore.createIndex('remoteId', 'remoteId', { unique: false });
          locationsStore.createIndex('normalizedDisplayName', 'normalizedDisplayName', { unique: false });
        }

        if (!db.objectStoreNames.contains(ENTRY_LOCATIONS_STORE)) {
          const entryLocationsStore = db.createObjectStore(ENTRY_LOCATIONS_STORE, { keyPath: 'id' });
          entryLocationsStore.createIndex('entryId', 'entryId', { unique: false });
          entryLocationsStore.createIndex('locationId', 'locationId', { unique: false });
          entryLocationsStore.createIndex('remoteEntryId', 'remoteEntryId', { unique: false });
          entryLocationsStore.createIndex('created_at', 'created_at', { unique: false });
        }

        // v11: local-first Tags, Tag Categories, Vocabulary stats, and immutable Entry-Tag links.
        if (!db.objectStoreNames.contains(TAG_CATEGORIES_STORE)) {
          const categoriesStore = db.createObjectStore(TAG_CATEGORIES_STORE, { keyPath: 'id' });
          categoriesStore.createIndex('slug', 'slug', { unique: false });
          categoriesStore.createIndex('created_at', 'created_at', { unique: false });
        }

        if (!db.objectStoreNames.contains(TAGS_STORE)) {
          const tagsStore = db.createObjectStore(TAGS_STORE, { keyPath: 'id' });
          tagsStore.createIndex('categoryId', 'categoryId', { unique: false });
          tagsStore.createIndex('normalizedLabel', 'normalizedLabel', { unique: false });
          tagsStore.createIndex('status', 'status', { unique: false });
          tagsStore.createIndex('remoteId', 'remoteId', { unique: false });
          tagsStore.createIndex('updated_at', 'updated_at', { unique: false });
        }

        if (!db.objectStoreNames.contains(TAG_VOCABULARY_STORE)) {
          const vocabularyStore = db.createObjectStore(TAG_VOCABULARY_STORE, { keyPath: 'tagId' });
          vocabularyStore.createIndex('last_used_at', 'last_used_at', { unique: false });
          vocabularyStore.createIndex('use_count', 'use_count', { unique: false });
        }

        if (!db.objectStoreNames.contains(ENTRY_TAGS_STORE)) {
          const entryTagsStore = db.createObjectStore(ENTRY_TAGS_STORE, { keyPath: 'id' });
          entryTagsStore.createIndex('entryId', 'entryId', { unique: false });
          entryTagsStore.createIndex('tagId', 'tagId', { unique: false });
          entryTagsStore.createIndex('remoteEntryId', 'remoteEntryId', { unique: false });
          entryTagsStore.createIndex('created_at', 'created_at', { unique: false });
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
          this.promoteContextCluesFromCapture(entry.captureId, entry.id)
            .then(() => resolve(entry))
            .catch(reject);
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
  async confirmEntry(entryId, { locations = [], contacts = [], tags = [] } = {}) {
    const db = await this.ensureDb();
    const existingLocations = Array.isArray(locations) && locations.length
      ? await this.getLocations('confirmed')
      : [];

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([
        STORE_NAME,
        LOCATIONS_STORE,
        ENTRY_LOCATIONS_STORE,
        TAG_CATEGORIES_STORE,
        TAGS_STORE,
        TAG_VOCABULARY_STORE,
        ENTRY_TAGS_STORE,
      ], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const locationsStore = transaction.objectStore(LOCATIONS_STORE);
      const entryLocationsStore = transaction.objectStore(ENTRY_LOCATIONS_STORE);
      const tagCategoriesStore = transaction.objectStore(TAG_CATEGORIES_STORE);
      const tagsStore = transaction.objectStore(TAGS_STORE);
      const tagVocabularyStore = transaction.objectStore(TAG_VOCABULARY_STORE);
      const entryTagsStore = transaction.objectStore(ENTRY_TAGS_STORE);
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
        entry.locationIds = [];
        entry.locationSnapshots = [];
        entry.contactIds = [];
        entry.contactSnapshots = [];
        entry.tagIds = [];
        entry.tagSnapshots = [];

        const now = new Date().toISOString();
        const normalizedLocations = locations
          .map(location => this.normalizeLocationDraft(location))
          .filter(Boolean);

        for (const location of normalizedLocations) {
          const reusableLocation = location.id
            ? null
            : findReusableLocation(existingLocations, location);
          const locationId = location.id || reusableLocation?.id || this.generateLocationId();
          const snapshot = {
            id: locationId,
            displayName: reusableLocation?.displayName || location.displayName,
            placeText: reusableLocation?.placeText || location.placeText,
            addressText: reusableLocation?.addressText || location.addressText,
            latitude: reusableLocation?.latitude ?? location.latitude,
            longitude: reusableLocation?.longitude ?? location.longitude,
          };
          const locationRecord = {
            ...(reusableLocation || {}),
            ...snapshot,
            status: 'confirmed',
            normalizedDisplayName: normalizeLocationKey(snapshot.displayName),
            remoteId: location.remoteId || reusableLocation?.remoteId || null,
            created_at: reusableLocation?.created_at || location.created_at || now,
            updated_at: now,
          };
          locationsStore.put(locationRecord);
          entryLocationsStore.put({
            id: `entry-location-${entryId}-${locationId}`,
            entryId,
            locationId,
            remoteEntryId: entry.remoteId || null,
            created_at: now,
          });
          entry.locationIds.push(locationId);
          entry.locationSnapshots.push(snapshot);
        }

        const normalizedContacts = contacts
          .map(contact => ({
            id: contact.id || contact.localId || contact.local_id || null,
            displayName: normalizeLocationText(contact.displayName || contact.display_name || contact.label || ''),
            primaryPhone: contact.primaryPhone || contact.primary_phone || null,
            primaryEmail: contact.primaryEmail || contact.primary_email || null,
            phones: contact.phones || [],
            emails: contact.emails || [],
            normalizedPhones: contact.normalizedPhones || contact.normalized_phones || [],
            normalizedEmails: contact.normalizedEmails || contact.normalized_emails || [],
          }))
          .filter(contact => contact.id && contact.displayName);

        for (const contact of normalizedContacts) {
          entry.contactIds.push(contact.id);
          entry.contactSnapshots.push(contact);
        }

        const normalizedTags = tags
          .map(tag => this.normalizeTagDraft(tag))
          .filter(Boolean);

        if (normalizedTags.length) {
          tagCategoriesStore.put({
            ...DEFAULT_TAG_CATEGORY,
            created_at: now,
            updated_at: now,
          });
        }

        for (const tag of normalizedTags) {
          const tagId = tag.id || this.generateTagId(tag.label, tag.categoryId);
          const snapshot = {
            id: tagId,
            label: tag.label,
            normalizedLabel: normalizeTagKey(tag.label),
            categoryId: tag.categoryId,
            categoryName: tag.categoryName,
          };
          tagsStore.put({
            ...snapshot,
            status: 'confirmed',
            remoteId: tag.remoteId || null,
            created_at: tag.created_at || now,
            updated_at: now,
          });
          entryTagsStore.put({
            id: `entry-tag-${entryId}-${tagId}`,
            entryId,
            tagId,
            remoteEntryId: entry.remoteId || null,
            created_at: now,
          });
          tagVocabularyStore.put({
            tagId,
            label: tag.label,
            categoryId: tag.categoryId,
            created_at: tag.created_at || now,
            last_used_at: now,
            use_count: (tag.useCount || 0) + 1,
            accepted_count: (tag.acceptedCount || 0) + 1,
            rejected_count: tag.rejectedCount || 0,
          });
          entry.tagIds.push(tagId);
          entry.tagSnapshots.push(snapshot);
        }

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
  async createEntryFromCapture({ captureId, transcript, summary, created_at, locations = [], tags = [] }) {
    const db = await this.ensureDb();
    const now = new Date().toISOString();
    const existingLocations = Array.isArray(locations) && locations.length
      ? await this.getLocations('confirmed')
      : [];
    const locationSnapshots = locations
      .map(location => this.normalizeLocationDraft(location))
      .filter(Boolean)
      .map(location => {
        const reusableLocation = location.id ? null : findReusableLocation(existingLocations, location);
        return {
          id: location.id || reusableLocation?.id || this.generateLocationId(),
          displayName: reusableLocation?.displayName || location.displayName,
          placeText: reusableLocation?.placeText || location.placeText,
          addressText: reusableLocation?.addressText || location.addressText,
          latitude: reusableLocation?.latitude ?? location.latitude,
          longitude: reusableLocation?.longitude ?? location.longitude,
          remoteId: location.remoteId || reusableLocation?.remoteId || null,
          created_at: reusableLocation?.created_at || location.created_at || now,
        };
      });
    const tagSnapshots = tags
      .map(tag => this.normalizeTagDraft(tag))
      .filter(Boolean)
      .map(tag => ({
        id: tag.id || this.generateTagId(tag.label, tag.categoryId),
        label: tag.label,
        normalizedLabel: normalizeTagKey(tag.label),
        categoryId: tag.categoryId,
        categoryName: tag.categoryName,
      }));

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
      created_at: created_at || now,
      synced_at: null,
      intent: 'NOTE',
      locationIds: locationSnapshots.map(location => location.id),
      locationSnapshots,
      tagIds: tagSnapshots.map(tag => tag.id),
      tagSnapshots,
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([
        STORE_NAME,
        LOCATIONS_STORE,
        ENTRY_LOCATIONS_STORE,
        TAG_CATEGORIES_STORE,
        TAGS_STORE,
        TAG_VOCABULARY_STORE,
        ENTRY_TAGS_STORE,
      ], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const locationsStore = transaction.objectStore(LOCATIONS_STORE);
      const entryLocationsStore = transaction.objectStore(ENTRY_LOCATIONS_STORE);
      const tagCategoriesStore = transaction.objectStore(TAG_CATEGORIES_STORE);
      const tagsStore = transaction.objectStore(TAGS_STORE);
      const tagVocabularyStore = transaction.objectStore(TAG_VOCABULARY_STORE);
      const entryTagsStore = transaction.objectStore(ENTRY_TAGS_STORE);
      const request = store.add(entry);

      for (const location of locationSnapshots) {
        locationsStore.put({
          ...location,
          status: 'confirmed',
          normalizedDisplayName: normalizeLocationKey(location.displayName),
          remoteId: location.remoteId || null,
          created_at: location.created_at || now,
          updated_at: now,
        });
        entryLocationsStore.put({
          id: `entry-location-${entry.id}-${location.id}`,
          entryId: entry.id,
          locationId: location.id,
          remoteEntryId: null,
          created_at: now,
        });
      }

      if (tagSnapshots.length) {
        tagCategoriesStore.put({
          ...DEFAULT_TAG_CATEGORY,
          created_at: now,
          updated_at: now,
        });
      }

      for (const tag of tagSnapshots) {
        tagsStore.put({
          ...tag,
          status: 'confirmed',
          remoteId: null,
          created_at: now,
          updated_at: now,
        });
        entryTagsStore.put({
          id: `entry-tag-${entry.id}-${tag.id}`,
          entryId: entry.id,
          tagId: tag.id,
          remoteEntryId: null,
          created_at: now,
        });
        tagVocabularyStore.put({
          tagId: tag.id,
          label: tag.label,
          categoryId: tag.categoryId,
          created_at: now,
          last_used_at: now,
          use_count: 1,
          accepted_count: 1,
          rejected_count: 0,
        });
      }

      request.onsuccess = () => {
        this.promoteContextCluesFromCapture(captureId, entry.id)
          .then(() => resolve(entry.id))
          .catch(reject);
      };
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
      locationIds: (cloudJob.locations || cloudJob.locationSnapshots || []).map(location =>
        location.local_id || location.localId || location.id
      ).filter(Boolean),
      locationSnapshots: (cloudJob.locations || cloudJob.locationSnapshots || []).map(location => ({
        id: location.local_id || location.localId || location.id,
        displayName: location.display_name || location.displayName || '',
        placeText: location.place_text || location.placeText || location.display_name || '',
        addressText: location.address_text || location.addressText || '',
        latitude: location.latitude ?? null,
        longitude: location.longitude ?? null,
      })),
      tagIds: (cloudJob.tags || cloudJob.tagSnapshots || []).map(tag =>
        tag.local_id || tag.localId || tag.id
      ).filter(Boolean),
      tagSnapshots: (cloudJob.tags || cloudJob.tagSnapshots || []).map(tag => ({
        id: tag.local_id || tag.localId || tag.id,
        label: tag.label || '',
        normalizedLabel: tag.normalized_label || tag.normalizedLabel || normalizeTagKey(tag.label || ''),
        categoryId: tag.category_id || tag.categoryId || DEFAULT_TAG_CATEGORY.id,
        categoryName: tag.category_name || tag.categoryName || tag.tag_categories?.name || DEFAULT_TAG_CATEGORY.name,
      })),
    };
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, LOCATIONS_STORE, ENTRY_LOCATIONS_STORE], 'readwrite');
      const req = tx.objectStore(STORE_NAME).add(entry);
      req.onsuccess = () => {
        Promise.all([
          this.upsertCloudContextClues(entry.id, cloudJob.id, cloudJob.context_clues || cloudJob.contextClues || []),
          this.upsertCloudEntryLocations(entry.id, cloudJob.id, cloudJob.locations || cloudJob.locationSnapshots || []),
          this.upsertCloudEntryTags(entry.id, cloudJob.id, cloudJob.tags || cloudJob.tagSnapshots || []),
        ])
          .then(() => resolve(entry))
          .catch(reject);
      };
      req.onerror = () => reject(new Error('Failed to add cloud entry'));
    });
  }

  async upsertCloudEntryLocations(entryId, remoteEntryId, locations = []) {
    const db = await this.ensureDb();
    if (!Array.isArray(locations) || locations.length === 0) return [];
    return new Promise((resolve, reject) => {
      const tx = db.transaction([LOCATIONS_STORE, ENTRY_LOCATIONS_STORE], 'readwrite');
      const locationStore = tx.objectStore(LOCATIONS_STORE);
      const linkStore = tx.objectStore(ENTRY_LOCATIONS_STORE);
      const saved = [];

      tx.oncomplete = () => resolve(saved);
      tx.onerror = () => reject(new Error('Failed to save cloud entry locations'));

      for (const cloudLocation of locations) {
        const localId = cloudLocation.local_id || cloudLocation.localId || `location-cloud-${cloudLocation.id}`;
        const row = {
          id: localId,
          displayName: cloudLocation.display_name || cloudLocation.displayName || '',
          placeText: cloudLocation.place_text || cloudLocation.placeText || cloudLocation.display_name || '',
          addressText: cloudLocation.address_text || cloudLocation.addressText || '',
          latitude: cloudLocation.latitude ?? null,
          longitude: cloudLocation.longitude ?? null,
          status: cloudLocation.status || 'confirmed',
          normalizedDisplayName: normalizeLocationKey(cloudLocation.display_name || cloudLocation.displayName || ''),
          remoteId: cloudLocation.id || cloudLocation.location_id || null,
          created_at: cloudLocation.created_at || new Date().toISOString(),
          updated_at: cloudLocation.updated_at || cloudLocation.created_at || new Date().toISOString(),
        };
        locationStore.put(row);
        linkStore.put({
          id: `entry-location-${entryId}-${localId}`,
          entryId,
          locationId: localId,
          remoteEntryId,
          created_at: cloudLocation.link_created_at || new Date().toISOString(),
        });
        saved.push(row);
      }
    });
  }

  async upsertCloudEntryTags(entryId, remoteEntryId, tags = []) {
    const db = await this.ensureDb();
    if (!Array.isArray(tags) || tags.length === 0) return [];
    return new Promise((resolve, reject) => {
      const tx = db.transaction([TAG_CATEGORIES_STORE, TAGS_STORE, TAG_VOCABULARY_STORE, ENTRY_TAGS_STORE], 'readwrite');
      const categoryStore = tx.objectStore(TAG_CATEGORIES_STORE);
      const tagStore = tx.objectStore(TAGS_STORE);
      const vocabularyStore = tx.objectStore(TAG_VOCABULARY_STORE);
      const linkStore = tx.objectStore(ENTRY_TAGS_STORE);
      const saved = [];
      const now = new Date().toISOString();

      tx.oncomplete = () => resolve(saved);
      tx.onerror = () => reject(new Error('Failed to save cloud entry tags'));

      categoryStore.put({
        ...DEFAULT_TAG_CATEGORY,
        created_at: now,
        updated_at: now,
      });

      for (const cloudTag of tags) {
        const categoryId = cloudTag.category_id || cloudTag.categoryId || DEFAULT_TAG_CATEGORY.id;
        const categoryName = cloudTag.category_name || cloudTag.categoryName || cloudTag.tag_categories?.name || DEFAULT_TAG_CATEGORY.name;
        const label = normalizeTagLabel(cloudTag.label || '');
        if (!label) continue;
        const localId = cloudTag.local_id || cloudTag.localId || `tag-cloud-${cloudTag.id}`;
        const row = {
          id: localId,
          label,
          normalizedLabel: cloudTag.normalized_label || cloudTag.normalizedLabel || normalizeTagKey(label),
          categoryId,
          categoryName,
          status: cloudTag.status || 'confirmed',
          remoteId: cloudTag.id || cloudTag.tag_id || null,
          created_at: cloudTag.created_at || now,
          updated_at: cloudTag.updated_at || cloudTag.created_at || now,
        };
        categoryStore.put({
          id: categoryId,
          name: categoryName,
          slug: safeLocalKey(categoryName),
          created_at: row.created_at,
          updated_at: row.updated_at,
        });
        tagStore.put(row);
        linkStore.put({
          id: `entry-tag-${entryId}-${localId}`,
          entryId,
          tagId: localId,
          remoteEntryId,
          created_at: cloudTag.link_created_at || now,
        });
        vocabularyStore.put({
          tagId: localId,
          label,
          categoryId,
          created_at: row.created_at,
          last_used_at: row.updated_at,
          use_count: cloudTag.use_count || 1,
          accepted_count: cloudTag.accepted_count || 1,
          rejected_count: cloudTag.rejected_count || 0,
        });
        saved.push(row);
      }
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

  generateContactId() {
    return `contact-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  generateLocationId() {
    return `location-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  generateTagId(label, categoryId = DEFAULT_TAG_CATEGORY.id) {
    return `tag-${safeLocalKey(categoryId)}-${safeLocalKey(label)}`;
  }

  generateContextClueId() {
    return `context-clue-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  generatePersonId() {
    return this.generateContactId();
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

  // ─── Context Clues ─────────────────────────────────────────────────────

  async createContextClue({
    captureId = null,
    entryId = null,
    remoteEntryId = null,
    kind,
    source,
    summary = '',
    payload = {},
    confidence = null,
    metadata = {},
    created_at = null,
  }) {
    if (!kind || !source) {
      throw new Error('Context clue kind and source are required');
    }
    if (!captureId && !entryId && !remoteEntryId) {
      throw new Error('Context clue must be linked to a Capture or Entry');
    }

    const db = await this.ensureDb();
    const now = new Date().toISOString();
    const clue = {
      id: this.generateContextClueId(),
      captureId,
      entryId,
      remoteEntryId,
      kind,
      source,
      summary,
      payload: compactPayload(payload),
      confidence,
      metadata: compactPayload(metadata),
      created_at: created_at || now,
      updated_at: now,
    };

    return new Promise((resolve, reject) => {
      const request = db
        .transaction([CONTEXT_CLUES_STORE], 'readwrite')
        .objectStore(CONTEXT_CLUES_STORE)
        .add(clue);

      request.onsuccess = () => resolve(clue);
      request.onerror = () => reject(new Error('Failed to create context clue'));
    });
  }

  async createCalendarEventContextClue({ captureId = null, entryId = null, event, confidence = null, metadata = {} }) {
    const payload = compactCalendarPayload(event);
    return this.createContextClue({
      captureId,
      entryId,
      kind: 'calendar_event',
      source: 'calendar',
      summary: payload.title ? `Calendar event: ${payload.title}` : 'Calendar event',
      payload,
      confidence,
      metadata,
    });
  }

  async createDeviceLocationContextClue({ captureId = null, entryId = null, clue }) {
    return this.createContextClue({
      captureId,
      entryId,
      kind: 'device_location',
      source: 'device_location',
      summary: clue.summary || 'Current location at capture time',
      payload: clue.payload || {},
      confidence: clue.confidence ?? 0.55,
      metadata: clue.metadata || {},
      created_at: clue.created_at || null,
    });
  }

  async getContextCluesForCapture(captureId) {
    return this.getContextCluesByIndex('captureId', captureId);
  }

  async getContextCluesForEntry(entryId) {
    return this.getContextCluesByIndex('entryId', entryId);
  }

  async getContextCluesByIndex(indexName, value) {
    if (!value) return [];
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([CONTEXT_CLUES_STORE], 'readonly').objectStore(CONTEXT_CLUES_STORE);
      const request = store.index(indexName).getAll(value);
      request.onsuccess = () => {
        const clues = (request.result || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        resolve(clues);
      };
      request.onerror = () => reject(new Error('Failed to fetch context clues'));
    });
  }

  async promoteContextCluesFromCapture(captureId, entryId) {
    if (!captureId || !entryId) return [];
    const db = await this.ensureDb();
    const clues = await this.getContextCluesForCapture(captureId);
    if (!clues.length) return [];

    return new Promise((resolve, reject) => {
      const tx = db.transaction([CONTEXT_CLUES_STORE], 'readwrite');
      const store = tx.objectStore(CONTEXT_CLUES_STORE);
      for (const clue of clues) {
        store.put({
          ...clue,
          entryId,
          updated_at: new Date().toISOString(),
        });
      }
      tx.oncomplete = () => resolve(clues.map(clue => ({ ...clue, entryId })));
      tx.onerror = () => reject(new Error('Failed to promote context clues'));
    });
  }

  async upsertCloudContextClues(entryId, remoteEntryId, cloudClues = []) {
    if (!entryId || !Array.isArray(cloudClues) || cloudClues.length === 0) return [];
    const db = await this.ensureDb();
    const now = new Date().toISOString();
    const clues = cloudClues.map(clue => ({
      id: clue.local_id || clue.id || this.generateContextClueId(),
      remoteId: clue.id || null,
      entryId,
      captureId: null,
      remoteEntryId,
      kind: clue.kind,
      source: clue.source,
      summary: clue.summary || '',
      payload: compactPayload(clue.payload || {}),
      confidence: clue.confidence ?? null,
      metadata: compactPayload(clue.metadata || {}),
      created_at: clue.created_at || now,
      updated_at: now,
    }));

    return new Promise((resolve, reject) => {
      const tx = db.transaction([CONTEXT_CLUES_STORE], 'readwrite');
      const store = tx.objectStore(CONTEXT_CLUES_STORE);
      for (const clue of clues) store.put(clue);
      tx.oncomplete = () => resolve(clues);
      tx.onerror = () => reject(new Error('Failed to save cloud context clues'));
    });
  }

  // ─── Contacts ───────────────────────────────────────────────────────────

  async createContact(contactData) {
    const db = await this.ensureDb();
    const now = new Date().toISOString();
    const contact = {
      id: this.generateContactId(),
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
      ...contactData,
    };

    const tx = db.transaction([CONTACTS_STORE], 'readwrite');
    const request = tx.objectStore(CONTACTS_STORE).add(contact);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(contact);
      request.onerror = () => reject(new Error('Failed to create contact'));
    });
  }

  async createPerson(personData) {
    return this.createContact(personData);
  }

  async getContact(contactId) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction([CONTACTS_STORE], 'readonly').objectStore(CONTACTS_STORE).get(contactId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(new Error('Failed to fetch contact'));
    });
  }

  async getPerson(personId) {
    return this.getContact(personId);
  }

  async deleteContact(contactId) {
    const linkedEntries = await this.getEntriesForContact(contactId);
    if (linkedEntries.length > 0) {
      throw new Error('Cannot delete a contact linked to entries');
    }

    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction([CONTACTS_STORE], 'readwrite').objectStore(CONTACTS_STORE).delete(contactId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to delete contact'));
    });
  }

  async deletePerson(personId) {
    return this.deleteContact(personId);
  }

  async getContacts(status = 'confirmed') {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([CONTACTS_STORE], 'readonly').objectStore(CONTACTS_STORE);
      const request = status ? store.index('status').getAll(status) : store.getAll();
      request.onsuccess = () => {
        const contacts = (request.result || []).sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
        resolve(contacts);
      };
      request.onerror = () => reject(new Error('Failed to fetch contacts'));
    });
  }

  async searchContacts(query) {
    const contacts = await this.getContacts('confirmed');
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return contacts;

    return contacts.filter(contact => {
      const haystack = [
        contact.displayName,
        contact.givenName,
        contact.familyName,
        contact.organization,
        contact.title,
        ...(contact.emails || []).map(email => email.value),
        ...(contact.phones || []).map(phone => phone.value),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }

  async getEntriesForContact(contactId) {
    const contact = await this.getContact(contactId);
    if (!contact) return [];

    const sourceCaptureIds = new Set((contact.sourceCaptureIds || []).filter(Boolean));
    const entries = await this.getEntries('confirmed');
    return entries.filter(entry =>
      (entry.captureId && sourceCaptureIds.has(entry.captureId)) ||
      (Array.isArray(entry.contactIds) && entry.contactIds.includes(contactId)) ||
      entryMentionsContact(entry, contact)
    );
  }

  async findContactsByContactKeys({ normalizedEmails = [], normalizedPhones = [] } = {}) {
    const contacts = await this.getContacts('confirmed');
    const emailSet = new Set((normalizedEmails || []).filter(Boolean));
    const phoneSet = new Set((normalizedPhones || []).filter(Boolean));

    return contacts.filter(contact =>
      (contact.normalizedEmails || []).some(email => emailSet.has(email)) ||
      (contact.normalizedPhones || []).some(phone => phoneSet.has(phone))
    );
  }

  async upsertContact(contactData) {
    const db = await this.ensureDb();
    const now = new Date().toISOString();
    const normalizedEmails = Array.from(new Set((contactData.normalizedEmails || []).filter(Boolean)));
    const normalizedPhones = Array.from(new Set((contactData.normalizedPhones || []).filter(Boolean)));
    const matches = await this.findContactsByContactKeys({ normalizedEmails, normalizedPhones });
    const existing = matches[0] || null;
    const primaryEmail = normalizedEmails[0] || null;
    const primaryPhone = normalizedPhones[0] || null;

    if (!existing) {
      return this.createContact({
        ...contactData,
        normalizedEmails,
        normalizedPhones,
        primaryEmail,
        primaryPhone,
      });
    }

    const merged = {
      ...existing,
      displayName: contactData.displayName || existing.displayName,
      givenName: contactData.givenName || existing.givenName,
      familyName: contactData.familyName || existing.familyName,
      organization: contactData.organization || existing.organization,
      title: contactData.title || existing.title,
      note: contactData.note || existing.note,
      phones: this.mergeContactValues(existing.phones, contactData.phones),
      emails: this.mergeContactValues(existing.emails, contactData.emails),
      normalizedPhones: Array.from(new Set([...(existing.normalizedPhones || []), ...normalizedPhones])),
      normalizedEmails: Array.from(new Set([...(existing.normalizedEmails || []), ...normalizedEmails])),
      primaryPhone: existing.primaryPhone || primaryPhone,
      primaryEmail: existing.primaryEmail || primaryEmail,
      sourceCaptureIds: Array.from(new Set([...(existing.sourceCaptureIds || []), ...(contactData.sourceCaptureIds || [])])),
      syncStatus: 'pending',
      updated_at: now,
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction([CONTACTS_STORE], 'readwrite');
      const store = tx.objectStore(CONTACTS_STORE);
      const req = store.put(merged);
      req.onsuccess = () => resolve(merged);
      req.onerror = () => reject(new Error('Failed to update contact'));
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

  async getContactsUnsynced() {
    const contacts = await this.getContacts('confirmed');
    return contacts.filter(contact => contact.syncStatus !== 'synced' || !contact.remoteId);
  }

  async markContactSynced(contactId, remoteId = null) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([CONTACTS_STORE], 'readwrite').objectStore(CONTACTS_STORE);
      const request = store.get(contactId);

      request.onsuccess = () => {
        const contact = request.result;
        if (!contact) { reject(new Error('Contact not found')); return; }

        const synced = {
          ...contact,
          remoteId: remoteId || contact.remoteId,
          syncStatus: 'synced',
          synced_at: new Date().toISOString(),
        };
        const updateRequest = store.put(synced);
        updateRequest.onsuccess = () => resolve(synced);
        updateRequest.onerror = () => reject(new Error('Failed to mark contact synced'));
      };

      request.onerror = () => reject(new Error('Failed to fetch contact'));
    });
  }

  async markPersonSynced(personId, remoteId = null) {
    return this.markContactSynced(personId, remoteId);
  }

  async upsertCloudContact(cloudContact) {
    const normalizedEmails = Array.from(new Set((cloudContact.normalized_emails || []).filter(Boolean)));
    const normalizedPhones = Array.from(new Set((cloudContact.normalized_phones || []).filter(Boolean)));
    const localId = cloudContact.local_id || null;
    const existingByLocalId = localId ? await this.getContact(localId) : null;
    const matches = await this.findContactsByContactKeys({ normalizedEmails, normalizedPhones });
    const existing = existingByLocalId || matches.find(contact => contact.remoteId === cloudContact.id) || matches[0] || null;
    const contactData = {
      displayName: cloudContact.display_name || '',
      givenName: cloudContact.given_name || '',
      familyName: cloudContact.family_name || '',
      organization: cloudContact.organization || '',
      title: cloudContact.title || '',
      note: cloudContact.note || '',
      phones: cloudContact.phones || [],
      emails: cloudContact.emails || [],
      normalizedPhones,
      normalizedEmails,
      primaryPhone: cloudContact.primary_phone || normalizedPhones[0] || null,
      primaryEmail: cloudContact.primary_email || normalizedEmails[0] || null,
      sourceCaptureIds: cloudContact.source_capture_ids || [],
      remoteId: cloudContact.id,
      syncStatus: 'synced',
      synced_at: new Date().toISOString(),
    };

    if (!existing) {
      return this.createContact({
        ...contactData,
        id: localId || this.generateContactId(),
        created_at: cloudContact.created_at || new Date().toISOString(),
        updated_at: cloudContact.updated_at || cloudContact.created_at || new Date().toISOString(),
      });
    }

    const db = await this.ensureDb();
    const merged = {
      ...existing,
      ...contactData,
      displayName: contactData.displayName || existing.displayName,
      phones: this.mergeContactValues(existing.phones, contactData.phones),
      emails: this.mergeContactValues(existing.emails, contactData.emails),
      normalizedPhones: Array.from(new Set([...(existing.normalizedPhones || []), ...normalizedPhones])),
      normalizedEmails: Array.from(new Set([...(existing.normalizedEmails || []), ...normalizedEmails])),
      sourceCaptureIds: Array.from(new Set([...(existing.sourceCaptureIds || []), ...contactData.sourceCaptureIds])),
      updated_at: cloudContact.updated_at || existing.updated_at,
    };

    return new Promise((resolve, reject) => {
      const request = db.transaction([CONTACTS_STORE], 'readwrite').objectStore(CONTACTS_STORE).put(merged);
      request.onsuccess = () => resolve(merged);
      request.onerror = () => reject(new Error('Failed to save cloud contact'));
    });
  }

  async upsertCloudPerson(cloudPerson) {
    return this.upsertCloudContact(cloudPerson);
  }

  // ─── Locations ──────────────────────────────────────────────────────────

  normalizeLocationDraft(location = {}) {
    const displayName = normalizeLocationText(
      location.displayName || location.display_name || location.placeText || location.place_text || location.addressText || location.address_text
    );
    if (!displayName) return null;

    return {
      id: location.id || location.localId || location.local_id || null,
      displayName,
      placeText: normalizeLocationText(location.placeText || location.place_text || displayName),
      addressText: normalizeLocationText(location.addressText || location.address_text || ''),
      latitude: location.latitude ?? null,
      longitude: location.longitude ?? null,
      remoteId: location.remoteId || location.remote_id || null,
      created_at: location.created_at || null,
    };
  }

  async getLocations(status = 'confirmed') {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([LOCATIONS_STORE], 'readonly').objectStore(LOCATIONS_STORE);
      const req = status ? store.index('status').getAll(status) : store.getAll();
      req.onsuccess = () => {
        const rows = req.result || [];
        rows.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
        resolve(rows);
      };
      req.onerror = () => reject(new Error('Failed to fetch locations'));
    });
  }

  async getLocation(locationId) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction([LOCATIONS_STORE], 'readonly').objectStore(LOCATIONS_STORE).get(locationId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(new Error('Failed to fetch location'));
    });
  }

  async updateLocation(locationId, updates = {}) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([LOCATIONS_STORE], 'readwrite');
      const store = tx.objectStore(LOCATIONS_STORE);
      const request = store.get(locationId);

      request.onsuccess = () => {
        const location = request.result;
        if (!location) {
          reject(new Error('Location not found'));
          return;
        }

        const updated = {
          ...location,
          ...updates,
          id: location.id,
          updated_at: new Date().toISOString(),
        };
        const put = store.put(updated);
        put.onsuccess = () => resolve(updated);
        put.onerror = () => reject(new Error('Failed to update location'));
      };

      request.onerror = () => reject(new Error('Failed to fetch location'));
    });
  }

  async getEntriesForLocation(locationId) {
    const location = await this.getLocation(locationId);
    if (!location) return [];

    const entries = await this.getEntries('confirmed');
    return entries.filter(entry => entryMatchesLocation(entry, location));
  }

  async getLocationsUnsynced() {
    const locations = await this.getLocations('confirmed');
    return locations.filter(location => !location.remoteId);
  }

  async getLocationsForEntry(entryId) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([ENTRY_LOCATIONS_STORE, LOCATIONS_STORE], 'readonly');
      const linksReq = tx.objectStore(ENTRY_LOCATIONS_STORE).index('entryId').getAll(entryId);
      linksReq.onsuccess = () => {
        const links = linksReq.result || [];
        if (links.length === 0) {
          resolve([]);
          return;
        }
        const locations = [];
        let remaining = links.length;
        for (const link of links) {
          const locationReq = tx.objectStore(LOCATIONS_STORE).get(link.locationId);
          locationReq.onsuccess = () => {
            if (locationReq.result) locations.push(locationReq.result);
            remaining -= 1;
            if (remaining === 0) resolve(locations);
          };
          locationReq.onerror = () => reject(new Error('Failed to fetch entry location'));
        }
      };
      linksReq.onerror = () => reject(new Error('Failed to fetch entry location links'));
    });
  }

  async markLocationSynced(locationId, remoteId = null) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([LOCATIONS_STORE], 'readwrite').objectStore(LOCATIONS_STORE);
      const req = store.get(locationId);
      req.onsuccess = () => {
        const location = req.result;
        if (!location) { reject(new Error('Location not found')); return; }
        location.remoteId = remoteId;
        location.updated_at = new Date().toISOString();
        const put = store.put(location);
        put.onsuccess = () => resolve(location);
        put.onerror = () => reject(new Error('Failed to mark location synced'));
      };
      req.onerror = () => reject(new Error('Failed to fetch location'));
    });
  }

  async upsertCloudLocation(cloudLocation) {
    const db = await this.ensureDb();
    const locationData = {
      id: cloudLocation.local_id || `location-cloud-${cloudLocation.id}`,
      displayName: cloudLocation.display_name || '',
      placeText: cloudLocation.place_text || cloudLocation.display_name || '',
      addressText: cloudLocation.address_text || '',
      latitude: cloudLocation.latitude ?? null,
      longitude: cloudLocation.longitude ?? null,
      status: cloudLocation.status || 'confirmed',
      normalizedDisplayName: normalizeLocationKey(cloudLocation.display_name || cloudLocation.place_text || ''),
      remoteId: cloudLocation.id,
      created_at: cloudLocation.created_at || new Date().toISOString(),
      updated_at: cloudLocation.updated_at || cloudLocation.created_at || new Date().toISOString(),
    };

    return new Promise((resolve, reject) => {
      const store = db.transaction([LOCATIONS_STORE], 'readwrite').objectStore(LOCATIONS_STORE);
      const req = store.put(locationData);
      req.onsuccess = () => resolve(locationData);
      req.onerror = () => reject(new Error('Failed to save cloud location'));
    });
  }

  // ─── Tags ───────────────────────────────────────────────────────────────

  normalizeTagDraft(tag = {}) {
    const validation = validateTagLabel(tag.label || tag.name || tag.displayName || tag);
    if (!validation.valid) return null;
    const categoryName = normalizeTagLabel(tag.categoryName || tag.category_name || DEFAULT_TAG_CATEGORY.name) || DEFAULT_TAG_CATEGORY.name;
    const categoryId = tag.categoryId || tag.category_id || `tag-category-${safeLocalKey(categoryName)}`;

    return {
      id: tag.id || tag.localId || tag.local_id || null,
      label: validation.label,
      categoryId,
      categoryName,
      remoteId: tag.remoteId || tag.remote_id || null,
      created_at: tag.created_at || null,
      useCount: tag.useCount || tag.use_count || 0,
      acceptedCount: tag.acceptedCount || tag.accepted_count || 0,
      rejectedCount: tag.rejectedCount || tag.rejected_count || 0,
    };
  }

  async getTags(status = 'confirmed') {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([TAGS_STORE], 'readonly').objectStore(TAGS_STORE);
      const req = status ? store.index('status').getAll(status) : store.getAll();
      req.onsuccess = () => {
        const rows = req.result || [];
        rows.sort((a, b) => String(a.label).localeCompare(String(b.label)));
        resolve(rows);
      };
      req.onerror = () => reject(new Error('Failed to fetch tags'));
    });
  }

  async getTagsForEntry(entryId) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([ENTRY_TAGS_STORE, TAGS_STORE], 'readonly');
      const linksReq = tx.objectStore(ENTRY_TAGS_STORE).index('entryId').getAll(entryId);
      linksReq.onsuccess = () => {
        const links = linksReq.result || [];
        if (links.length === 0) {
          resolve([]);
          return;
        }
        const tags = [];
        let remaining = links.length;
        for (const link of links) {
          const tagReq = tx.objectStore(TAGS_STORE).get(link.tagId);
          tagReq.onsuccess = () => {
            if (tagReq.result) tags.push(tagReq.result);
            remaining -= 1;
            if (remaining === 0) resolve(tags);
          };
          tagReq.onerror = () => reject(new Error('Failed to fetch entry tag'));
        }
      };
      linksReq.onerror = () => reject(new Error('Failed to fetch entry tag links'));
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
      diagnosticBundle: meta.diagnosticBundle || null,
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

  async createFeedbackTextReport({ transcript, diagnosticBundle }) {
    const db = await this.ensureDb();
    const item = {
      id: `fb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      audioBlob: null,
      audioSize: 0,
      audioDuration: 0,
      diagnosticBundle: diagnosticBundle || null,
      status: 'ready_for_review',
      syncStatus: 'pending',
      errorMessage: null,
      transcript,
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
      const storeNames = Array.from(db.objectStoreNames);
      const transaction = db.transaction(storeNames, 'readwrite');
      for (const storeName of storeNames) {
        transaction.objectStore(storeName).clear();
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('Failed to clear database'));
    });
  }
}

// Singleton instance
export const dbService = new DBService();

// Initialize on import
dbService.init().catch(console.error);
