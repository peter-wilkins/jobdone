import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultApiBaseUrl,
  shouldApplyAppUpdateForBackendBuild,
  shouldStartBuildMismatchReload,
} from './apiService.js';

test('detects backend-advertised frontend build changes', () => {
  assert.equal(shouldApplyAppUpdateForBackendBuild('5151199', '5151199'), false);
  assert.equal(shouldApplyAppUpdateForBackendBuild('abc1234', '5151199'), true);
  assert.equal(shouldApplyAppUpdateForBackendBuild('dev', '5151199'), false);
  assert.equal(shouldApplyAppUpdateForBackendBuild(null, '5151199'), false);
});

test('allows only one build mismatch reload per frontend/backend build pair', () => {
  const storage = new Map();
  const sessionStorage = {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
  };

  assert.equal(shouldStartBuildMismatchReload('backend1', {
    currentBuild: 'front1',
    storage: sessionStorage,
  }), true);
  assert.equal(shouldStartBuildMismatchReload('backend1', {
    currentBuild: 'front1',
    storage: sessionStorage,
  }), false);
  assert.equal(shouldStartBuildMismatchReload('backend2', {
    currentBuild: 'front1',
    storage: sessionStorage,
  }), true);
  assert.equal(shouldStartBuildMismatchReload('front1', {
    currentBuild: 'front1',
    storage: sessionStorage,
  }), false);
});

test('routes explicit staging and production hostnames to matching backend aliases', () => {
  assert.equal(
    defaultApiBaseUrl('jobdone-frontend-staging.vercel.app'),
    'https://jobdone-backend-staging.vercel.app',
  );
  assert.equal(
    defaultApiBaseUrl('jobdone-frontend-production.vercel.app'),
    'https://jobdone-backend-production.vercel.app',
  );
  assert.equal(
    defaultApiBaseUrl('frontend-six-sage-63.vercel.app'),
    'https://jobdone-gamma.vercel.app',
  );
});
