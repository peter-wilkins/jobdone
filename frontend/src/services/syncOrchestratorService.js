import { apiService } from './apiService.js';
import { authService } from './authService.js';
import { dbService } from './dbService.js';
import { syncContactReplica, syncLocationReplica } from './localReplicaService.js';
import { syncService } from './syncService.js';

function syncIssue(step, error) {
  return {
    step,
    message: error?.message || 'Sync failed',
    status: error?.status || null,
    requestId: error?.requestId || null,
    debugDetail: error?.debugDetail || null,
  };
}

async function pushUnsyncedEntries({ db, sync }, issues) {
  const unsynced = await db.getConfirmedEntriesUnsynced();
  let pushed = 0;

  for (const entry of unsynced) {
    try {
      const result = await sync.syncEntry(entry);
      if (result?.entry?.id) {
        await db.markEntrySynced(entry.id, result.entry.id);
        await db.upsertCloudEntryLocations(entry.id, result.entry.id, result.entry.locations || []);
        await db.upsertCloudEntryTags(entry.id, result.entry.id, result.entry.tags || []);
        pushed += 1;
      }
    } catch (error) {
      console.warn('[Sync] Failed to push entry:', entry.id, error);
      issues.push(syncIssue('entries_push', error));
    }
  }

  return pushed;
}

async function pullCloudEntries({ db, api }) {
  const cloudEntries = await api.getCloudEntries();
  let pulled = 0;

  for (const cloudEntry of cloudEntries) {
    const existsByRemoteId = await db.getEntryByRemoteId(cloudEntry.id);
    if (existsByRemoteId) continue;

    const cloudCaptureId = cloudEntry.captureId;
    const existingCaptureEntry = cloudCaptureId
      ? await db.getEntryByCaptureId(cloudCaptureId)
      : null;
    if (existingCaptureEntry) {
      if (!existingCaptureEntry.remoteId) {
        await db.markEntrySynced(existingCaptureEntry.id, cloudEntry.id);
      }
      continue;
    }

    const existingByCreatedAt = await db.getEntryByCreatedAt(cloudEntry.createdAt);
    if (existingByCreatedAt) {
      if (!existingByCreatedAt.remoteId) {
        await db.markEntrySynced(existingByCreatedAt.id, cloudEntry.id);
      }
      continue;
    }

    await db.addCloudEntry(cloudEntry);
    pulled += 1;
  }

  return pulled;
}

export async function syncConfirmedData({
  db = dbService,
  api = apiService,
  sync = syncService,
  auth = authService,
  contactReplicaSync = syncContactReplica,
  locationReplicaSync = syncLocationReplica,
  reason = 'manual',
} = {}) {
  if (!auth.isLoggedIn()) {
    return { ok: true, skipped: true, reason, issues: [] };
  }

  const issues = [];
  const result = {
    ok: true,
    skipped: false,
    reason,
    entries: { pushed: 0, pulled: 0 },
    contacts: null,
    locations: { pushed: 0, pulled: 0 },
    issues,
  };

  result.entries.pushed = await pushUnsyncedEntries({ db, sync }, issues);

  try {
    result.entries.pulled = await pullCloudEntries({ db, api });
  } catch (error) {
    console.warn('[Sync] Failed to pull entries:', error);
    issues.push(syncIssue('entries_pull', error));
  }

  try {
    result.contacts = await contactReplicaSync({ db, api, auth });
  } catch (error) {
    console.warn('[Sync] Failed to sync contacts:', error);
    issues.push(syncIssue('contacts_replica', error));
  }

  try {
    result.locations = await locationReplicaSync({ db, api, auth });
  } catch (error) {
    console.warn('[Sync] Failed to sync locations:', error);
    issues.push(syncIssue('locations_replica', error));
  }

  result.ok = issues.length === 0;
  return result;
}

export class SyncOrchestratorService {
  constructor() {
    this.activeSync = null;
    this.activeContactSync = null;
  }

  syncConfirmedData(options = {}) {
    if (this.activeSync) return this.activeSync;

    this.activeSync = syncConfirmedData(options)
      .finally(() => {
        this.activeSync = null;
      });

    return this.activeSync;
  }

  syncContactsAfterLocalChange(options = {}) {
    if (this.activeContactSync) return this.activeContactSync;

    this.activeContactSync = syncContactReplica(options)
      .then(result => ({ ok: true, issues: [], ...result }))
      .catch(error => {
        console.warn('[Sync] Contact saved locally but did not sync:', error);
        return {
          ok: false,
          issues: [syncIssue('contacts_replica', error)],
        };
      })
      .finally(() => {
        this.activeContactSync = null;
      });

    return this.activeContactSync;
  }
}

export const syncOrchestratorService = new SyncOrchestratorService();
