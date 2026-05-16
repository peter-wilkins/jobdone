import { apiService } from './apiService.js';
import { authService } from './authService.js';

export class SyncService {
  getUserId() {
    return authService.getUserId();
  }

  /**
   * Sync a confirmed job to cloud.
   * Returns null (silently) if the user isn't logged in.
   * Returns the server response on success.
   */
  async syncJob(jobData) {
    if (!authService.isLoggedIn()) {
      console.log('[Sync] Not logged in — skipping cloud sync');
      return null;
    }

    try {
      console.log('[Sync] Syncing job:', jobData.id);

      const response = await apiService.syncSave({
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

      console.log('[Sync] Job synced:', response.job?.id);
      return response;
    } catch (error) {
      console.error('[Sync] Failed to sync job:', error);
      throw error;
    }
  }
}

export const syncService = new SyncService();
