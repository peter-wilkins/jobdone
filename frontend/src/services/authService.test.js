import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService, defaultAuthRedirectTo } from './authService.js';

function fakeSupabaseAuth() {
  const calls = [];
  return {
    calls,
    auth: {
      onAuthStateChange: () => {},
      getSession: async () => ({ data: { session: null } }),
      signInWithOAuth: async (payload) => {
        calls.push(['signInWithOAuth', payload]);
        return { error: null };
      },
      signOut: async () => {
        calls.push(['signOut']);
      },
    },
  };
}

test('starts Google OAuth with the configured redirect URL', async () => {
  const supabase = fakeSupabaseAuth();
  const service = new AuthService({
    supabaseClient: supabase,
    redirectTo: () => 'http://jobdone.test/',
  });

  await service.signInWithGoogle();

  assert.deepEqual(supabase.calls, [
    ['signInWithOAuth', {
      provider: 'google',
      options: { redirectTo: 'http://jobdone.test/' },
    }],
  ]);
});

test('reports auth as unconfigured without throwing during init or sign out', async () => {
  const service = new AuthService({ supabaseClient: null });

  assert.equal(service.isConfigured(), false);
  assert.equal(await service.init(), null);
  await service.signOut();
  await assert.rejects(() => service.signInWithGoogle(), /Auth not configured/);
});

test('default redirect falls back to localhost outside a browser', () => {
  assert.equal(defaultAuthRedirectTo(), 'http://localhost:5173');
});
