import assert from 'node:assert/strict';
import test from 'node:test';
import {
  debugApiDetailsEnabledForUser,
  isDebugEmail,
} from './debugUserService.js';

test('enables API debug details for Peter allowlisted email', () => {
  assert.equal(isDebugEmail('poppetew@gmail.com'), true);
  assert.equal(debugApiDetailsEnabledForUser({ email: ' Poppetew@Gmail.com ' }), true);
});

test('does not enable API debug details for normal users', () => {
  assert.equal(isDebugEmail('worker@example.com'), false);
  assert.equal(debugApiDetailsEnabledForUser({ email: 'worker@example.com' }), false);
});
