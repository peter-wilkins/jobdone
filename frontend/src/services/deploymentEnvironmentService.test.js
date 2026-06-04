import assert from 'node:assert/strict';
import test from 'node:test';
import { deploymentEnvironmentForHostname } from './deploymentEnvironmentService.js';

test('detects explicit staging hostname', () => {
  const environment = deploymentEnvironmentForHostname('jobdone-staging.vercel.app');

  assert.equal(environment.kind, 'staging');
  assert.equal(environment.appName, 'JobDone Staging');
  assert.equal(environment.manifestPath, '/manifest-staging.webmanifest');
});

test('detects explicit production hostname', () => {
  const environment = deploymentEnvironmentForHostname('jobdone-frontend-production.vercel.app');

  assert.equal(environment.kind, 'production');
  assert.equal(environment.appName, 'JobDone Production');
  assert.equal(environment.manifestPath, '/manifest-production.webmanifest');
});

test('keeps explicit frontend hostnames classified', () => {
  assert.equal(
    deploymentEnvironmentForHostname('jobdone-frontend-staging.vercel.app').kind,
    'staging',
  );
  assert.equal(
    deploymentEnvironmentForHostname('jobdone.continuumkit.org').kind,
    'production',
  );
  assert.equal(deploymentEnvironmentForHostname('frontend-jobdone1.vercel.app'), null);
});

test('leaves local development unlabelled', () => {
  assert.equal(deploymentEnvironmentForHostname('localhost'), null);
});
