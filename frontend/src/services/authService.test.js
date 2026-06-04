import assert from 'node:assert/strict';
import test from 'node:test';
import { authClientOptions, authRedirectUrl } from './authService.js';

test('auth redirect uses current browser origin when no app URL is configured', () => {
  assert.equal(
    authRedirectUrl({
      configuredAppUrl: '',
      location: { origin: 'https://jobdone-staging.vercel.app' },
    }),
    'https://jobdone-staging.vercel.app',
  );
});

test('auth redirect trims configured app URL trailing slash', () => {
  assert.equal(
    authRedirectUrl({
      configuredAppUrl: 'https://jobdone-production.vercel.app/',
      location: { origin: 'https://wrong.example' },
    }),
    'https://jobdone-production.vercel.app',
  );
});

test('auth sessions persist until explicit sign out', () => {
  assert.equal(authClientOptions.auth.persistSession, true);
  assert.equal(authClientOptions.auth.autoRefreshToken, true);
  assert.equal(authClientOptions.auth.detectSessionInUrl, true);
});
