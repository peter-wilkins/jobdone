import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authClientOptions,
  authRedirectUrl,
  consumeAuthErrorFromLocation,
  isJobDoneAuthOrigin,
  isNativeShellUserAgent,
  nativeShellAuthCallbackUrl,
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
      configuredAppUrl: 'https://jobdone-frontend-production.vercel.app/',
      location: { origin: 'https://wrong.example' },
    }),
    'https://jobdone-frontend-production.vercel.app',
  );
});

test('auth redirect prefers current installed app origin over canonical build URL', () => {
  assert.equal(
    authRedirectUrl({
      configuredAppUrl: 'https://jobdone-frontend-production.vercel.app/',
      location: { origin: 'https://jobdone-staging.vercel.app' },
    }),
    'https://jobdone-staging.vercel.app',
  );
});

test('auth redirect uses staging native shell callback scheme when running inside staging shell', () => {
  assert.equal(
    authRedirectUrl({
      configuredAppUrl: 'https://jobdone-staging.vercel.app',
      location: { origin: 'https://jobdone-staging.vercel.app' },
      userAgent: 'Mozilla/5.0 JobDoneNativeShell/0.1.0 staging',
    }),
    'jobdone-staging://auth-callback',
  );
});

test('auth redirect uses production native shell callback scheme when running inside production shell', () => {
  assert.equal(
    authRedirectUrl({
      configuredAppUrl: 'https://jobdone.continuumkit.org',
      location: { origin: 'https://jobdone.continuumkit.org' },
      userAgent: 'Mozilla/5.0 JobDoneNativeShell/0.1.0 production',
    }),
    'jobdone://auth-callback',
  );
});

test('native shell detection is explicit to JobDone shell marker', () => {
  assert.equal(isNativeShellUserAgent('Mozilla/5.0 JobDoneNativeShell/0.1.0 staging'), true);
  assert.equal(isNativeShellUserAgent('Mozilla/5.0 JobDoneNativeShell/0.1.0 production'), true);
  assert.equal(isNativeShellUserAgent('Mozilla/5.0'), false);
});

test('native shell auth callback URL follows shell environment', () => {
  assert.equal(nativeShellAuthCallbackUrl('JobDoneNativeShell/0.1.0 staging'), 'jobdone-staging://auth-callback');
  assert.equal(nativeShellAuthCallbackUrl('JobDoneNativeShell/0.1.0 production'), 'jobdone://auth-callback');
  assert.equal(nativeShellAuthCallbackUrl('Mozilla/5.0'), null);
});

test('auth redirect does not trust unrelated current origins', () => {
  assert.equal(
    authRedirectUrl({
      configuredAppUrl: 'https://jobdone-frontend-production.vercel.app/',
      location: { origin: 'https://wrong.example' },
    }),
    'https://jobdone-frontend-production.vercel.app',
  );
});

test('auth redirect does not preserve retired frontend aliases', () => {
  assert.equal(
    authRedirectUrl({
      configuredAppUrl: 'https://jobdone-frontend-production.vercel.app/',
      location: { origin: 'https://frontend-jobdone1.vercel.app' },
    }),
    'https://jobdone-frontend-production.vercel.app',
  );
});

test('known JobDone app origins are valid auth redirect origins', () => {
  assert.equal(isJobDoneAuthOrigin('https://jobdone-staging.vercel.app'), true);
  assert.equal(isJobDoneAuthOrigin('https://jobdone-frontend-production.vercel.app'), true);
  assert.equal(isJobDoneAuthOrigin('https://jobdone.continuumkit.org'), true);
  assert.equal(isJobDoneAuthOrigin('https://frontend-six-sage-63.vercel.app'), false);
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
