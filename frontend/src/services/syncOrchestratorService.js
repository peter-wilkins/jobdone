import { apiService } from './apiService.js';
import { authService } from './authService.js';
import { dbService } from './dbService.js';
import { syncEntryReplica } from './localReplicaEntryService.js';
import { syncContactReplica, syncLocationReplica } from './localReplicaService.js';

function syncIssue(step, error) {
  return {
    step,
    message: error?.message || 'Sync failed',
    status: error?.status || null,
    requestId: error?.requestId || null,
    debugDetail: error?.debugDetail || null,
  };
}

export async function syncConfirmedData({
  db = dbService,
  api = apiService,
  auth = authService,
  entryReplicaSync = syncEntryReplica,
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

  try {
    result.entries = await entryReplicaSync({ db, api, auth });
  } catch (error) {
    console.warn('[Sync] Failed to sync Entry replica:', error);
    issues.push(syncIssue('entries_replica', error));
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
