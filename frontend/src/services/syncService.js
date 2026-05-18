import { apiService } from './apiService.js';
import { authService } from './authService.js';
import { dbService } from './dbService.js';

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
      const contextClues = await dbService.getContextCluesForEntry(entryData.id);
      const locations = Array.isArray(entryData.locationSnapshots) && entryData.locationSnapshots.length
        ? entryData.locationSnapshots
        : await dbService.getLocationsForEntry(entryData.id);
      const tags = Array.isArray(entryData.tagSnapshots) && entryData.tagSnapshots.length
        ? entryData.tagSnapshots
        : await dbService.getTagsForEntry(entryData.id);
      const contacts = Array.isArray(entryData.contactSnapshots) ? entryData.contactSnapshots : [];

      const response = await apiService.syncSave({
        entryData: {
          transcript: entryData.transcript,
          summary: entryData.summary,
          created_at: entryData.created_at,
          captureId: entryData.captureId || entryData.capture_id || null,
          contextClues,
          locations,
          contacts,
          tags,
        },
      });

      console.log('[Sync] Entry synced:', response.entry?.id);
      return response;
    } catch (error) {
      console.error('[Sync] Failed to sync entry:', error);
      throw error;
    }
  }

  async syncContacts(contacts) {
    if (!authService.isLoggedIn() || !contacts.length) return null;

    const response = await apiService.syncContacts(contacts.map(contact => ({
      id: contact.id,
      localId: contact.id,
      status: contact.status,
      displayName: contact.displayName,
      givenName: contact.givenName,
      familyName: contact.familyName,
      organization: contact.organization,
      title: contact.title,
      note: contact.note,
      phones: contact.phones,
      emails: contact.emails,
      normalizedPhones: contact.normalizedPhones,
      normalizedEmails: contact.normalizedEmails,
      primaryPhone: contact.primaryPhone,
      primaryEmail: contact.primaryEmail,
      sourceCaptureIds: contact.sourceCaptureIds,
      created_at: contact.created_at,
    })));
    return response;
  }

}

export const syncService = new SyncService();
