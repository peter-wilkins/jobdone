import { apiService } from './apiService.js';

/**
 * Sync service for uploading jobs to cloud
 */
export class SyncService {
  constructor() {
    // Generate or retrieve a unique session ID for this device
    this.userId = this.getOrCreateUserId();
  }

  /**
   * Get or create a user ID (anonymous session)
   * Stored in localStorage so it persists across sessions
   */
  getOrCreateUserId() {
    const stored = localStorage.getItem('jobdone_user_id');
    if (stored) {
      return stored;
    }

    // Generate new anonymous user ID
    const newId = `anon-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem('jobdone_user_id', newId);
    console.log('[Sync] Created new user ID:', newId);
    return newId;
  }

  /**
   * Sync a confirmed job to cloud
   * @param {Object} jobData - Job data from database
   * @returns {Promise<{success: boolean, job: Object}>}
   */
  async syncJob(jobData) {
    try {
      console.log('[Sync] Syncing job:', jobData.id);

      const response = await apiService.syncSave({
        userId: this.userId,
        jobData: {
          transcript: jobData.transcript,
          summary: jobData.summary,
          materials: jobData.materials,
          labour_minutes: jobData.labour_minutes,
          follow_ups: jobData.follow_ups,
          possible_future_work: jobData.possible_future_work,
          created_at: jobData.created_at,
        },
      });

      console.log('[Sync] Job synced successfully:', response.job?.id);
      return response;
    } catch (error) {
      console.error('[Sync] Failed to sync job:', error);
      throw error;
    }
  }

  /**
   * Get current user ID
   */
  getUserId() {
    return this.userId;
  }
}

export const syncService = new SyncService();
