import assert from 'node:assert/strict';
import test from 'node:test';
import {
  setAppUpdateGuard,
  shouldDeferAppUpdateNow,
} from './appUpdateGuardService.js';

test('app update guard defaults to not deferring reloads', () => {
  setAppUpdateGuard(null);
  assert.equal(shouldDeferAppUpdateNow(), false);
});

test('app update guard can defer reloads while local work is in progress', () => {
  setAppUpdateGuard(() => true);
  assert.equal(shouldDeferAppUpdateNow(), true);
  setAppUpdateGuard(null);
});

test('app update guard fails open if the guard throws', () => {
  setAppUpdateGuard(() => {
    throw new Error('bad guard');
  });
  assert.equal(shouldDeferAppUpdateNow(), false);
  setAppUpdateGuard(null);
});
