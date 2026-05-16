/**
 * IndexedDB service for local job storage
 * Handles persistence of recordings, transcripts, and metadata
 */

const DB_NAME = 'plumber-job-log';
const DB_VERSION = 3;
const STORE_NAME = 'jobs';
const FEEDBACK_STORE = 'feedback';

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
        reject(new Error('Failed to open database'));
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        const transaction = event.target.transaction;

        // Jobs store (all versions)
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

        // v3: remoteId index on existing jobs store (upgrade path)
        if (db.objectStoreNames.contains(STORE_NAME)) {
          const jobsStore = transaction.objectStore(STORE_NAME);
          if (!jobsStore.indexNames.contains('remoteId')) {
            jobsStore.createIndex('remoteId', 'remoteId', { unique: false });
          }
        }
      };
    });
  }

  /**
   * Create a new job entry
   * @param {Object} jobData - Job metadata
   * @param {Blob} audioBlob - Audio recording blob
   * @returns {Promise<string>} Job ID
   */
  async createJob(jobData, audioBlob) {
    const db = await this.ensureDb();

    const job = {
      id: this.generateId(),
      ...jobData,
      audioBlob,
      audioSize: audioBlob.size,
      audioDuration: jobData.duration,
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
      const request = store.add(job);

      request.onsuccess = () => {
        resolve(job.id);
      };

      request.onerror = () => {
        reject(new Error('Failed to create job'));
      };
    });
  }

  /**
   * Update job with transcription + summary data
   */
  async updateJobWithTranscription(jobId, { transcript, summary, materials, labour_minutes, follow_ups, possible_future_work }) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(jobId);

      getRequest.onsuccess = () => {
        const job = getRequest.result;
        if (!job) {
          reject(new Error('Job not found'));
          return;
        }

        job.transcript = transcript;
        job.summary = summary;
        job.materials = materials || [];
        job.labour_minutes = labour_minutes;
        job.follow_ups = follow_ups || [];
        job.possible_future_work = possible_future_work || '';
        job.status = 'ready_for_review';

        const updateRequest = store.put(job);

        updateRequest.onsuccess = () => {
          resolve(job);
        };

        updateRequest.onerror = () => {
          reject(new Error('Failed to update job'));
        };
      };

      getRequest.onerror = () => {
        reject(new Error('Failed to fetch job'));
      };
    });
  }

  /**
   * Confirm a job (delete audio, move to saved)
   */
  async confirmJob(jobId) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(jobId);

      getRequest.onsuccess = () => {
        const job = getRequest.result;
        if (!job) {
          reject(new Error('Job not found'));
          return;
        }

        // Delete audio blob to save space
        job.audioBlob = null;
        job.status = 'confirmed';
        job.syncStatus = 'pending';

        const updateRequest = store.put(job);

        updateRequest.onsuccess = () => {
          resolve(job);
        };

        updateRequest.onerror = () => {
          reject(new Error('Failed to confirm job'));
        };
      };

      getRequest.onerror = () => {
        reject(new Error('Failed to fetch job'));
      };
    });
  }

  /**
   * Reject a job (delete it)
   */
  async rejectJob(jobId) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(jobId);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(new Error('Failed to delete job'));
      };
    });
  }

  /**
   * Get all jobs, optionally filtered by status
   */
  async getJobs(status = null) {
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
        const jobs = request.result.map(job => ({
          ...job,
          audioBlob: undefined,
        }));
        // Sort by created_at descending
        jobs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        resolve(jobs);
      };

      request.onerror = () => {
        reject(new Error('Failed to fetch jobs'));
      };
    });
  }

  /**
   * Get a single job by ID (includes audio blob)
   */
  async getJob(jobId) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(jobId);

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(new Error('Failed to fetch job'));
      };
    });
  }

  /**
   * Mark a job as failed (transcription error)
   */
  async markJobFailed(jobId, errorMessage) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(jobId);

      getRequest.onsuccess = () => {
        const job = getRequest.result;
        if (!job) { reject(new Error('Job not found')); return; }

        job.status = 'failed';
        job.errorMessage = errorMessage || 'Failed to process recording';

        const updateRequest = store.put(job);
        updateRequest.onsuccess = () => resolve(job);
        updateRequest.onerror = () => reject(new Error('Failed to mark job failed'));
      };

      getRequest.onerror = () => reject(new Error('Failed to fetch job'));
    });
  }

  /**
   * Reset a failed job back to recording status (for retry)
   */
  async resetJobForRetry(jobId) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(jobId);

      getRequest.onsuccess = () => {
        const job = getRequest.result;
        if (!job) { reject(new Error('Job not found')); return; }

        job.status = 'recording';
        job.errorMessage = null;

        const updateRequest = store.put(job);
        updateRequest.onsuccess = () => resolve(job);
        updateRequest.onerror = () => reject(new Error('Failed to reset job'));
      };

      getRequest.onerror = () => reject(new Error('Failed to fetch job'));
    });
  }

  /**
   * Mark a job as successfully synced to cloud
   * @param {string} jobId - local job id
   * @param {string|null} remoteId - Supabase UUID returned from the server
   */
  async markJobSynced(jobId, remoteId = null) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(jobId);

      getRequest.onsuccess = () => {
        const job = getRequest.result;
        if (!job) { reject(new Error('Job not found')); return; }

        job.syncStatus = 'synced';
        job.synced_at = new Date().toISOString();
        job.remoteId = remoteId;

        const updateRequest = store.put(job);
        updateRequest.onsuccess = () => resolve(job);
        updateRequest.onerror = () => reject(new Error('Failed to mark job synced'));
      };

      getRequest.onerror = () => reject(new Error('Failed to fetch job'));
    });
  }

  /** Get confirmed jobs that haven\'t been synced to cloud yet */
  async getConfirmedJobsUnsynced() {
    const confirmed = await this.getJobs('confirmed');
    return confirmed.filter(j => !j.remoteId);
  }

  /** Find a local job by its Supabase remote ID */
  async getJobByRemoteId(remoteId) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([STORE_NAME], 'readonly').objectStore(STORE_NAME);
      const req = store.index('remoteId').get(remoteId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(new Error('Failed to query by remoteId'));
    });
  }

  /** Add a job fetched from the cloud into local IndexedDB as confirmed */
  async addCloudJob(cloudJob) {
    const db = await this.ensureDb();
    const job = {
      id: `job-cloud-${cloudJob.id}`,
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
      const req = db.transaction([STORE_NAME], 'readwrite').objectStore(STORE_NAME).add(job);
      req.onsuccess = () => resolve(job);
      req.onerror = () => reject(new Error('Failed to add cloud job'));
    });
  }

  /**
   * Get jobs pending sync
   */
  async getPendingSyncJobs() {
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
        reject(new Error('Failed to fetch pending jobs'));
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
    return `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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

  /**
   * Clear all data (for testing)
   */
  async clear() {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(new Error('Failed to clear database'));
      };
    });
  }
}

// Singleton instance
export const dbService = new DBService();

// Initialize on import
dbService.init().catch(console.error);
