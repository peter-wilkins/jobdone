import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APIService,
  defaultApiBaseUrl,
  shouldApplyAppUpdateForApiResponse,
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

test('detects app update headers even on failed API responses', () => {
  const storage = new Map();
  const sessionStorage = {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
  };
  const response = new Response(JSON.stringify({ error: 'old app contract' }), {
    status: 500,
    headers: { 'x-jobdone-build': 'backend2' },
  });

  assert.equal(shouldApplyAppUpdateForApiResponse(response, {
    currentBuild: 'front1',
    storage: sessionStorage,
    updateStarted: false,
    updateDeferred: false,
  }), true);
});

test('routes explicit staging and production hostnames to matching backend aliases', () => {
  assert.equal(
    defaultApiBaseUrl('jobdone-staging.vercel.app'),
    'https://jobdone-backend-staging.vercel.app',
  );
  assert.equal(
    defaultApiBaseUrl('jobdone-frontend-staging.vercel.app'),
    'https://jobdone-backend-staging.vercel.app',
  );
  assert.equal(
    defaultApiBaseUrl('jobdone-frontend-production.vercel.app'),
    'https://jobdone-backend-production.vercel.app',
  );
  assert.equal(
    defaultApiBaseUrl('jobdone.continuumkit.org'),
    'https://jobdone-backend-production.vercel.app',
  );
  assert.equal(
    defaultApiBaseUrl('frontend-old-preview.vercel.app'),
    'https://jobdone-gamma.vercel.app',
  );
});

const LOCATION_ID = '01973e36-4c80-7abc-8a72-111111111111';

test('Location Replica manifest rejects failed responses instead of returning empty data', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'auth expired' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });

  try {
    await assert.rejects(
      () => new APIService().getLocationReplicaManifest({ locations: [] }),
      /auth expired/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Location Replica pulls reject noncanonical response bodies', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: true,
    locations: [{ id: LOCATION_ID, display_name: '14 Bell Street' }],
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  try {
    await assert.rejects(
      () => new APIService().pullLocationsForReplica([LOCATION_ID]),
      /Invalid input|displayName/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Location Replica pushes reject noncanonical request bodies before fetch', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response('{}', { status: 200 });
  };

  try {
    await assert.rejects(
      () => new APIService().pushLocationsForReplica([{
        id: LOCATION_ID,
        displayName: '14 Bell Street',
        created_at: '2026-05-17T01:00:00.000Z',
      }]),
      /Use locations\.0\.createdAt/,
    );
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('generic Local Replica push rejects noncanonical request bodies before fetch', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response('{}', { status: 200 });
  };

  try {
    await assert.rejects(
      () => new APIService().pushLocalReplica({
        replicaEpoch: LOCATION_ID,
        base_t: 0,
        intents: [],
      }),
      /expected number|unrecognized|must not cross/,
    );
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('generic Local Replica pull rejects noncanonical response bodies', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    replicaEpoch: LOCATION_ID,
    from_t: 0,
    toT: 0,
    hasMore: false,
    objects: [],
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  try {
    await assert.rejects(
      () => new APIService().pullLocalReplica({ replicaEpoch: LOCATION_ID, sinceT: 0 }),
      /expected number|unrecognized|must not cross/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('recall rejects empty queries before fetch', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response('{}', { status: 200 });
  };

  try {
    await assert.rejects(
      () => new APIService().recall('   '),
      /query must be a non-empty string/,
    );
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Team Work state requests selected Team ID', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({
      team: { id: 'team-2', name: 'Foo Team' },
      teams: [{ id: 'team-2', name: 'Foo Team' }],
      inProgressItems: [],
      openBacklogItems: [],
      approvedItems: [],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const state = await new APIService().getTeamWorkState('team-2');
    assert.equal(state.team.id, 'team-2');
    assert.match(requestedUrl, /\/api\/teams\/work\?team_id=team-2$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('claiming a Team Backlog Item sends an explicit JSON body', async () => {
  const originalFetch = globalThis.fetch;
  let requestedOptions = null;
  globalThis.fetch = async (_url, options) => {
    requestedOptions = options;
    return new Response(JSON.stringify({
      backlogItem: { id: 'item-1', description: 'Clean bench', status: 'claimed' },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    await new APIService().claimTeamBacklogItem('item-1');
    assert.equal(requestedOptions.method, 'POST');
    assert.equal(requestedOptions.headers['Content-Type'], 'application/json');
    assert.equal(requestedOptions.body, '{}');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('recall failed responses preserve server status and message', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Authentication required' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });

  try {
    await assert.rejects(
      () => new APIService().recall('tap repair'),
      (error) => {
        assert.equal(error.status, 401);
        assert.equal(error.message, 'Authentication required');
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
