import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const serviceWorkerSource = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

test('share-target service worker uses current IndexedDB version', () => {
  assert.match(serviceWorkerSource, /const DB_VERSION = 17;/);
});

test('share-target service worker can create Local Replica stores', () => {
  assert.match(serviceWorkerSource, /const CLIENT_ID_ALIASES_STORE = 'clientIdAliases';/);
  assert.match(serviceWorkerSource, /const SYNC_OBJECTS_LOCAL_STORE = 'syncObjectsLocal';/);
  assert.match(serviceWorkerSource, /const SYNC_INTENTS_LOCAL_STORE = 'syncIntentsLocal';/);
  assert.match(serviceWorkerSource, /const REPLICA_STATE_STORE = 'replicaState';/);
  assert.match(serviceWorkerSource, /const LOCAL_REPLICA_MATERIALIZED_STORE = 'localReplicaMaterialized';/);
});

test('share-target service worker preserves IndexedDB on open failure', () => {
  assert.doesNotMatch(serviceWorkerSource, /deleteDatabase\(DB_NAME\)/);
  assert.match(serviceWorkerSource, /preserving local database/);
});
