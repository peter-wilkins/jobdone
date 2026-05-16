import { apiService } from './apiService.js';
import { authService } from './authService.js';

export class SyncService {
  getUserId() {
    return authService.getUserId();
  }

  /**
   * Sync a confirmed entry to cloud.
   * Returns null (silently) if the user isn't logged in.
   * Returns the server response on success.
   */
  async syncEntry(entryData) {
    if (!authService.isLoggedIn()) {
      console.log('[Sync] Not logged in — skipping cloud sync');
      return null;
    }

    try {
      console.log('[Sync] Syncing entry:', entryData.id);

      const response = await apiService.syncSave({
        entryData: {
          transcript: entryData.transcript,
          summary: entryData.summary,
          materials: entryData.materials,
          labour_minutes: entryData.labour_minutes,
          follow_ups: entryData.follow_ups,
          possible_future_work: entryData.possible_future_work,
          created_at: entryData.created_at,
        },
      });

      console.log('[Sync] Entry synced:', response.entry?.id);
      return response;
    } catch (error) {
      console.error('[Sync] Failed to sync entry:', error);
      throw error;
    }
  }
}

export const syncService = new SyncService();
