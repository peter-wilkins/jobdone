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
          created_at: entryData.created_at,
          captureId: entryData.captureId || entryData.capture_id || null,
        },
      });

      console.log('[Sync] Entry synced:', response.entry?.id);
      return response;
    } catch (error) {
      console.error('[Sync] Failed to sync entry:', error);
      throw error;
    }
  }

  async syncPeople(people) {
    if (!authService.isLoggedIn() || !people.length) return null;

    const response = await apiService.syncPeople(people.map(person => ({
      id: person.id,
      localId: person.id,
      status: person.status,
      displayName: person.displayName,
      givenName: person.givenName,
      familyName: person.familyName,
      organization: person.organization,
      title: person.title,
      note: person.note,
      phones: person.phones,
      emails: person.emails,
      normalizedPhones: person.normalizedPhones,
      normalizedEmails: person.normalizedEmails,
      primaryPhone: person.primaryPhone,
      primaryEmail: person.primaryEmail,
      sourceCaptureIds: person.sourceCaptureIds,
      created_at: person.created_at,
    })));
    return response;
  }
}

export const syncService = new SyncService();
