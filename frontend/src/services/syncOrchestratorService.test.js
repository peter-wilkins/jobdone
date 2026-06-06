import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SyncOrchestratorService,
  syncConfirmedData,
} from './syncOrchestratorService.js';

function deps(overrides = {}) {
  return {
    auth: {
      isLoggedIn: () => true,
    },
    db: {
      getConfirmedEntriesUnsynced: async () => [],
      markEntrySynced: async () => {},
      upsertCloudEntryLocations: async () => {},
      upsertCloudEntryTags: async () => {},
      getEntryByRemoteId: async () => null,
      getEntryByCaptureId: async () => null,
      getEntryByCreatedAt: async () => null,
      addCloudEntry: async () => {},
    },
    api: {
      getCloudEntries: async () => [],
    },
    sync: {
      syncEntry: async () => ({ entry: { id: 'remote-entry-1', locations: [], tags: [] } }),
    },
    contactReplicaSync: async () => ({ pushed: 0, pulled: 0, aliases: 0 }),
    locationReplicaSync: async () => ({ pushed: 0, pulled: 0, aliases: 0 }),
    ...overrides,
  };
}

test('sync reports entry pull failures instead of treating cloud as empty', async () => {
  const entryPullError = new Error('server unavailable');
  entryPullError.status = 503;
  const calls = [];
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const result = await syncConfirmedData(deps({
      api: {
        getCloudEntries: async () => {
          throw entryPullError;
        },
      },
      locationReplicaSync: async () => {
        calls.push('locations-replica');
        return { pushed: 0, pulled: 0, aliases: 0 };
      },
    }));

    assert.equal(result.ok, false);
    assert.deepEqual(result.issues.map(issue => issue.step), ['entries_pull']);
    assert.equal(result.issues[0].status, 503);
    assert.deepEqual(calls, ['locations-replica']);
  } finally {
    console.warn = originalWarn;
  }
});

test('sync orchestrator keeps one confirmed-data sync in flight', async () => {
  const orchestrator = new SyncOrchestratorService();
  let resolveEntries;
  let entryPullCount = 0;
  const waitingForEntries = new Promise(resolve => {
    resolveEntries = resolve;
  });

  const options = deps({
    api: {
      getCloudEntries: async () => {
        entryPullCount += 1;
        await waitingForEntries;
        return [];
      },
    },
  });

  const first = orchestrator.syncConfirmedData(options);
  const second = orchestrator.syncConfirmedData(options);
  assert.strictEqual(first, second);

  resolveEntries();
  const result = await first;

  assert.equal(result.ok, true);
  assert.equal(entryPullCount, 1);
});

test('sync uses old Entry sync path by default while Local Replica flag is off', async () => {
  const calls = [];
  const result = await syncConfirmedData(deps({
    db: {
      ...deps().db,
      getConfirmedEntriesUnsynced: async () => [{ id: 'entry-1' }],
    },
    sync: {
      syncEntry: async () => {
        calls.push('old-entry-sync');
        return { entry: { id: 'remote-entry-1', locations: [], tags: [] } };
      },
    },
    entryReplicaSync: async () => {
      calls.push('entry-replica');
      return { pushed: 1, pulled: 0 };
    },
  }));

  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['old-entry-sync']);
});

test('sync can route Entries through Local Replica behind explicit flag', async () => {
  const calls = [];
  const result = await syncConfirmedData(deps({
    localReplicaEntriesEnabled: true,
    db: {
      ...deps().db,
      getConfirmedEntriesUnsynced: async () => {
        calls.push('old-entry-query');
        return [{ id: 'entry-1' }];
      },
    },
    api: {
      getCloudEntries: async () => {
        calls.push('old-entry-pull');
        return [];
      },
    },
    entryReplicaSync: async () => {
      calls.push('entry-replica');
      return { pushed: 1, pulled: 2, conflicts: 0, rejected: 0, skipped: false };
    },
  }));

  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['entry-replica']);
  assert.deepEqual(result.entries, { pushed: 1, pulled: 2, conflicts: 0, rejected: 0, skipped: false });
});
