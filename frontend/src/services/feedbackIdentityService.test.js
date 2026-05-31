import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createFeedbackDeviceId,
  getFeedbackDeviceId,
  isValidFeedbackDeviceId,
  resetFeedbackDeviceIdForTests,
} from './feedbackIdentityService.js';

function installStorage() {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  };
}

function removeStorage() {
  delete globalThis.localStorage;
}

test('creates opaque valid feedback device ids', () => {
  const id = createFeedbackDeviceId();

  assert.equal(isValidFeedbackDeviceId(id), true);
  assert.match(id, /^fbd_/);
  assert.equal(id.includes('@'), false);
});

test('persists a per-device feedback id', () => {
  installStorage();
  resetFeedbackDeviceIdForTests();

  const first = getFeedbackDeviceId();
  const second = getFeedbackDeviceId();

  assert.equal(first, second);
  assert.equal(isValidFeedbackDeviceId(first), true);

  removeStorage();
});
