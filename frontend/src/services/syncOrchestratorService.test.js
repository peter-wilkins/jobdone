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
    api: {},
    contactReplicaSync: async () => ({ pushed: 0, pulled: 0, aliases: 0 }),
    locationReplicaSync: async () => ({ pushed: 0, pulled: 0, aliases: 0 }),
    entryReplicaSync: async () => ({ pushed: 0, pulled: 0, conflicts: 0, rejected: 0, skipped: false }),
    ...overrides,
  };
}

test('sync reports Entry replica failures and keeps syncing other collections', async () => {
  const entryReplicaError = new Error('server unavailable');
  entryReplicaError.status = 503;
  const calls = [];
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const result = await syncConfirmedData(deps({
      entryReplicaSync: async () => {
        throw entryReplicaError;
      },
      locationReplicaSync: async () => {
        calls.push('locations-replica');
        return { pushed: 0, pulled: 0, aliases: 0 };
      },
    }));

    assert.equal(result.ok, false);
    assert.deepEqual(result.issues.map(issue => issue.step), ['entries_replica']);
    assert.equal(result.issues[0].status, 503);
    assert.deepEqual(calls, ['locations-replica']);
  } finally {
    console.warn = originalWarn;
  }
});

test('sync orchestrator keeps one confirmed-data sync in flight', async () => {
  const orchestrator = new SyncOrchestratorService();
  let resolveEntries;
  let entryReplicaCount = 0;
  const waitingForEntries = new Promise(resolve => {
    resolveEntries = resolve;
  });

  const options = deps({
    entryReplicaSync: async () => {
      entryReplicaCount += 1;
      await waitingForEntries;
      return { pushed: 0, pulled: 0, conflicts: 0, rejected: 0, skipped: false };
    },
  });

  const first = orchestrator.syncConfirmedData(options);
  const second = orchestrator.syncConfirmedData(options);
  assert.strictEqual(first, second);

  resolveEntries();
  const result = await first;

  assert.equal(result.ok, true);
  assert.equal(entryReplicaCount, 1);
});

test('sync always routes Entries through Local Replica', async () => {
  const calls = [];
  const result = await syncConfirmedData(deps({
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
