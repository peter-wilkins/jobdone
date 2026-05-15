/**
 * IndexedDB service for local job storage
 * Handles persistence of recordings, transcripts, and metadata
 */

const DB_NAME = 'plumber-job-log';
const DB_VERSION = 1;
const STORE_NAME = 'jobs';

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

        // Create jobs object store
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          
          // Indexes for querying
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('created_at', 'created_at', { unique: false });
          store.createIndex('sync_status', 'syncStatus', { unique: false });
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
