import { apiService } from './apiService.js';
import { authService } from './authService.js';
import { dbService } from './dbService.js';
import { readyPhotoAttachments } from './photoAttachmentService.js';
import { parseEntrySyncPayload } from '../contracts/entrySync.js';

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || '');
      resolve(value.includes(',') ? value.split(',').pop() : value);
    };
    reader.onerror = () => reject(new Error('Failed to read attachment'));
    reader.readAsDataURL(blob);
  });
}

async function serializeReadyAttachments(entryData) {
  const readyPhotos = readyPhotoAttachments(entryData.attachments || []);
  const serialized = [];
  for (const attachment of readyPhotos) {
    if (!attachment.blob) continue;
    serialized.push({
      id: attachment.id,
      kind: 'photo',
      status: 'ready',
      filename: attachment.originalName || 'photo.jpg',
      mimeType: attachment.mimeType || attachment.blob.type || 'image/jpeg',
      size: attachment.size || attachment.blob.size || 0,
      width: attachment.width || null,
      height: attachment.height || null,
      originalName: attachment.originalName || '',
      originalSize: attachment.originalSize || 0,
      originalType: attachment.originalType || '',
      dataBase64: await blobToBase64(attachment.blob),
    });
  }
  return serialized;
}

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
      const locations = Array.isArray(entryData.locations) && entryData.locations.length
        ? entryData.locations
        : await dbService.getLocationsForEntry(entryData.id);
      const tags = Array.isArray(entryData.tags) && entryData.tags.length
        ? entryData.tags
        : await dbService.getTagsForEntry(entryData.id);
      const contacts = Array.isArray(entryData.contacts) ? entryData.contacts : [];
      const attachments = await serializeReadyAttachments(entryData);

      const payload = {
        entryData: {
          id: entryData.id,
          transcript: entryData.transcript,
          summary: entryData.summary,
          createdAt: entryData.createdAt,
          captureId: entryData.captureId || null,
          contextClues,
          locations,
          contacts,
          tags,
          attachments,
        },
      };

      const parsed = parseEntrySyncPayload(payload);
      if (!parsed.success) {
        throw new Error(parsed.error);
      }

      const response = await apiService.syncSave(parsed.data);

      console.log('[Sync] Entry synced:', response.entry?.id);
      return response;
    } catch (error) {
      console.error('[Sync] Failed to sync entry:', error);
      throw error;
    }
  }

  async syncLocations(locations) {
    if (!authService.isLoggedIn() || !locations.length) return null;

    return apiService.syncLocations(locations.map(location => ({
      id: location.id,
      localId: location.id,
      status: location.status,
      displayName: location.displayName,
      placeText: location.placeText,
      addressText: location.addressText,
      latitude: location.latitude,
      longitude: location.longitude,
      remoteId: location.remoteId,
      providerPlaceId: location.providerPlaceId,
      createdAt: location.created_at,
      updatedAt: location.updated_at,
    })));
  }

}

export const syncService = new SyncService();
