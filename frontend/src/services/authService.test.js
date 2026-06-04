import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authClientOptions,
  authRedirectUrl,
  consumeAuthErrorFromLocation,
  isJobDoneAuthOrigin,
} from './authService.js';

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

test('auth redirect prefers current installed app origin over canonical build URL', () => {
  assert.equal(
    authRedirectUrl({
      configuredAppUrl: 'https://jobdone-production.vercel.app/',
      location: { origin: 'https://frontend-jobdone1.vercel.app' },
    }),
    'https://frontend-jobdone1.vercel.app',
  );
});

test('auth redirect does not trust unrelated current origins', () => {
  assert.equal(
    authRedirectUrl({
      configuredAppUrl: 'https://jobdone-production.vercel.app/',
      location: { origin: 'https://wrong.example' },
    }),
    'https://jobdone-production.vercel.app',
  );
});

test('known JobDone app origins are valid auth redirect origins', () => {
  assert.equal(isJobDoneAuthOrigin('https://jobdone-production.vercel.app'), true);
  assert.equal(isJobDoneAuthOrigin('https://jobdone-staging.vercel.app'), true);
  assert.equal(isJobDoneAuthOrigin('https://frontend-six-sage-63.vercel.app'), true);
  assert.equal(isJobDoneAuthOrigin('http://localhost:5173'), true);
  assert.equal(isJobDoneAuthOrigin('https://wrong.example'), false);
});

test('auth callback errors are consumed and removed from URL', () => {
  const calls = [];
  const error = consumeAuthErrorFromLocation({
    location: {
      pathname: '/',
      search: '',
      hash: '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    },
    history: {
      replaceState: (...args) => calls.push(args),
    },
  });

  assert.deepEqual(error, {
    code: 'otp_expired',
    message: 'Email link is invalid or has expired',
  });
  assert.deepEqual(calls, [[{}, '', '/']]);
});

test('auth sessions persist until explicit sign out', () => {
  assert.equal(authClientOptions.auth.persistSession, true);
  assert.equal(authClientOptions.auth.autoRefreshToken, true);
  assert.equal(authClientOptions.auth.detectSessionInUrl, true);
});
