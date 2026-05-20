import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerLocationRoutes } from './locations.js';
import { normalizeAddressLookupResults } from '../services/addressLookup.js';

async function buildApp(addressLookup) {
  const app = Fastify({ logger: false });
  await app.register(registerLocationRoutes, { addressLookup });
  await app.ready();
  return app;
}

async function buildAppWithDeps(deps = {}) {
  const app = Fastify({ logger: false });
  await app.register(registerLocationRoutes, deps);
  await app.ready();
  return app;
}

describe('LocationRoutes address lookup', () => {
  test('normalizes provider results into selectable address candidates', () => {
    const candidates = normalizeAddressLookupResults([{
      display_name: '14, Bell Street, Exampletown, AB1 2CD, United Kingdom',
      lat: '53.1',
      lon: '-6.2',
      osm_type: 'way',
      osm_id: 123,
      place_id: 456,
      category: 'building',
      type: 'house',
      address: {
        house_number: '14',
        road: 'Bell Street',
        town: 'Exampletown',
        postcode: 'AB1 2CD',
        country: 'United Kingdom',
      },
    }]);

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].displayName, '14 Bell Street');
    assert.equal(candidates[0].addressText, '14 Bell Street, Exampletown, AB1 2CD, United Kingdom');
    assert.equal(candidates[0].latitude, 53.1);
    assert.equal(candidates[0].longitude, -6.2);
    assert.equal(candidates[0].providerPlaceId, 'nominatim:way:123:456');
  });

  test('returns lookup candidates from injected service', async () => {
    const app = await buildApp({
      search: async query => {
        assert.equal(query, 'AB1 2CD');
        return {
          candidates: [{
            id: 'candidate-1',
            displayName: '14 Bell Street',
            addressText: '14 Bell Street, AB1 2CD',
          }],
        };
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/locations/lookup?q=AB1%202CD',
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.candidates.length, 1);
    assert.equal(body.candidates[0].displayName, '14 Bell Street');
    assert.match(body.attribution, /OpenStreetMap/);
  });

  test('returns no candidates without treating no results as failure', async () => {
    const app = await buildApp({
      search: async () => ({ candidates: [] }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/locations/lookup?q=No%20Match',
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body).candidates, []);
  });

  test('returns 502 when provider lookup fails', async () => {
    const app = await buildApp({
      search: async () => {
        throw new Error('provider down');
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/locations/lookup?q=AB1%202CD',
    });

    assert.equal(res.statusCode, 502);
    assert.equal(JSON.parse(res.body).error, 'Address lookup is unavailable right now');
  });

  test('rate limits address lookup before calling provider', async () => {
    let lookupCalls = 0;
    const app = await buildAppWithDeps({
      checkCostlyRouteRateLimit: () => ({ allowed: false, retryAfterSeconds: 45 }),
      addressLookup: {
        search: async () => {
          lookupCalls += 1;
          return { candidates: [] };
        },
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/locations/lookup?q=AB1%202CD',
    });

    assert.equal(res.statusCode, 429);
    assert.equal(res.headers['retry-after'], '45');
    assert.equal(JSON.parse(res.body).error, 'Too many requests');
    assert.equal(lookupCalls, 0);
  });
});
