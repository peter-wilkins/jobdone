import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JOBDONE_DB_SCHEMA,
  authSupabaseKey,
  authSupabaseUrl,
  buildContactLocationCooccurrences,
  findReusableLocation,
  locationsHaveStrongIdentityMatch,
} from './database.js';
import {
  buildSqlFirstRecallQuery,
  isRecencyRecallQuery,
  recallQueryTerms,
  sslConfigForConnection,
  valueForColumn,
} from './postgresDb.js';

describe('Database schema binding', () => {
  test('defaults cloud persistence to the jobdone schema', () => {
    assert.equal(JOBDONE_DB_SCHEMA, 'jobdone');
  });

  test('verifies Supabase database TLS with a trusted CA', () => {
    const ssl = sslConfigForConnection('postgresql://user:pass@aws-0-eu-west-1.pooler.supabase.com:5432/postgres');

    assert.equal(ssl.rejectUnauthorized, true);
    assert.match(ssl.ca, /BEGIN CERTIFICATE/);
  });

  test('falls back old JobDone Auth config to the shared lab Auth project', () => {
    const env = {
      SUPABASE_URL: 'https://yajbsbxjxevysnmiabui.supabase.co',
      SUPABASE_KEY: 'old-project-key',
    };

    assert.equal(authSupabaseUrl(env), 'https://dtwuflwgcwxygjgkvzfl.supabase.co');
    assert.equal(authSupabaseKey(env), 'sb_publishable_Pz0DTPNoldMvAf4aaQ8Fkw_UeH_Cq0Q');
  });
});

describe('Postgres adapter value mapping', () => {
  test('serializes JSONB columns without corrupting text arrays', () => {
    assert.equal(
      valueForColumn('phones', [{ value: '07709 290759', normalized: '07709290759' }]),
      '[{"value":"07709 290759","normalized":"07709290759"}]'
    );
    assert.equal(
      valueForColumn('metadata', { originalName: 'photo.jpg', originalSize: 1024 }),
      '{"originalName":"photo.jpg","originalSize":1024}'
    );
    assert.deepEqual(valueForColumn('normalizedPhones', ['07709290759']), ['07709290759']);
    assert.equal(valueForColumn('embedding', [0.1, 0.2]), '[0.1,0.2]');
  });
});

describe('Database co-occurrence derivation', () => {
  test('derives Contact-Location counts from confirmed Entry links', () => {
    const rows = buildContactLocationCooccurrences([
      {
        entry_id: 'entry-1',
        created_at: '2026-05-17T10:00:00.000Z',
        contacts: { id: 'contact-1', display_name: 'Sarah Jenkins' },
      },
      {
        entry_id: 'entry-2',
        created_at: '2026-05-18T10:00:00.000Z',
        contacts: { id: 'contact-1', display_name: 'Sarah Jenkins' },
      },
      {
        entry_id: 'entry-3',
        created_at: '2026-05-18T11:00:00.000Z',
        contacts: { id: 'contact-2', display_name: 'Ann Smith' },
      },
    ], [
      {
        entry_id: 'entry-1',
        created_at: '2026-05-17T10:05:00.000Z',
        locations: { id: 'loc-1', display_name: '14 Bell Street', place_text: '14 Bell Street' },
      },
      {
        entry_id: 'entry-2',
        created_at: '2026-05-18T10:05:00.000Z',
        locations: { id: 'loc-1', display_name: '14 Bell Street', place_text: '14 Bell Street' },
      },
      {
        entry_id: 'entry-3',
        created_at: '2026-05-18T11:05:00.000Z',
        locations: { id: 'loc-2', display_name: '22 King Road', place_text: '22 King Road' },
      },
    ]);

    assert.deepEqual(rows.sort((a, b) => a.contactId.localeCompare(b.contactId)), [
      {
        contactId: 'contact-1',
        contactLabel: 'Sarah Jenkins',
        locationId: 'loc-1',
        locationLabel: '14 Bell Street',
        locationPlaceText: '14 Bell Street',
        locationLatitude: undefined,
        locationLongitude: undefined,
        count: 2,
        lastSeenAt: '2026-05-18T10:05:00.000Z',
      },
      {
        contactId: 'contact-2',
        contactLabel: 'Ann Smith',
        locationId: 'loc-2',
        locationLabel: '22 King Road',
        locationPlaceText: '22 King Road',
        locationLatitude: undefined,
        locationLongitude: undefined,
        count: 1,
        lastSeenAt: '2026-05-18T11:05:00.000Z',
      },
    ]);
  });
});

describe('Location identity matching', () => {
  test('matches exact normalized display labels', () => {
    const existing = { id: 'loc-1', display_name: '14 Bell Street' };
    const incoming = { displayName: '  14   bell street  ' };

    assert.equal(locationsHaveStrongIdentityMatch(existing, incoming), true);
    assert.equal(findReusableLocation([existing], incoming), existing);
  });

  test('matches postcode plus first address line', () => {
    assert.equal(locationsHaveStrongIdentityMatch(
      { display_name: '14 Bell Street', address_text: '14 Bell Street, London SW1A 1AA' },
      { displayName: 'Bell Street job', addressText: '14 Bell Street, SW1A1AA' }
    ), true);
  });

  test('matches provider place ids when present', () => {
    assert.equal(locationsHaveStrongIdentityMatch(
      { display_name: 'Old provider label', provider_place_id: 'places/abc123' },
      { displayName: 'New provider label', providerPlaceId: 'places/abc123' }
    ), true);
  });

  test('does not match nearby-looking but different labels without strong identity evidence', () => {
    assert.equal(locationsHaveStrongIdentityMatch(
      { display_name: '14 Bell Street', latitude: 51.5, longitude: -0.1 },
      { displayName: '16 Bell Street', latitude: 51.50001, longitude: -0.10001 }
    ), false);
  });
});

describe('SQL-first Recall', () => {
  test('normalizes useful query terms and detects recency intent', () => {
    assert.deepEqual(recallQueryTerms('What did I do for Sarah at Bell Street?'), [
      'sarah',
      'bell',
      'street',
    ]);
    assert.equal(isRecencyRecallQuery('last time at Bell Street'), true);
    assert.equal(isRecencyRecallQuery('Bell Street boiler'), false);
  });

  test('builds a deterministic SQL query without vector or transcript matching', () => {
    const [sql, values] = buildSqlFirstRecallQuery({
      schema: 'jobdone',
      userId: 'user-1',
      query: 'last time Sarah boiler',
      limit: 5,
    });
    const lowerSql = sql.toLowerCase();

    assert.equal(values[0], 'user-1');
    assert.equal(values[1], 'last time sarah boiler');
    assert.deepEqual(values[2], ['sarah', 'boiler']);
    assert.equal(values[3], 5);
    assert.equal(values[4], true);

    assert.match(lowerSql, /from "jobdone"\."entries"/);
    assert.match(lowerSql, /c\.status = 'confirmed'/);
    assert.match(lowerSql, /l\.status = 'confirmed'/);
    assert.match(lowerSql, /t\.status = 'confirmed'/);
    assert.match(lowerSql, /base\.summary/);
    assert.match(lowerSql, /match_reasons/);
    assert.doesNotMatch(lowerSql, /match_entries/);
    assert.doesNotMatch(lowerSql, /embedding/);
    assert.doesNotMatch(lowerSql, /to_tsvector|websearch_to_tsquery/);
    assert.doesNotMatch(lowerSql, /coalesce\(.*transcript/);
  });
});
