import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const serviceWorkerSource = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

test('share-target service worker uses current IndexedDB version', () => {
  assert.match(serviceWorkerSource, /const DB_VERSION = 15;/);
});

test('share-target service worker preserves IndexedDB on open failure', () => {
  assert.doesNotMatch(serviceWorkerSource, /deleteDatabase\(DB_NAME\)/);
  assert.match(serviceWorkerSource, /preserving local database/);
});
