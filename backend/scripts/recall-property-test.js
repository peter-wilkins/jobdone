#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import pg from 'pg';
import {
  renderGitHubErrorAnnotation,
  renderLocalFailureText,
  renderMarkdownSummary,
} from './recall-property-diagnostics.js';

const { Pool } = pg;

const DEFAULT_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const DB_URL = process.env.RECALL_PROPERTY_DB_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.DATABASE_URL ||
  DEFAULT_DB_URL;
const SCHEMA = process.env.SUPABASE_DB_SCHEMA || 'jobdone';
const GOLDEN_PATH = resolve(process.cwd(), process.env.RECALL_PROPERTY_GOLDEN || '.recall-property-golden.json');
const FAILURE_PATH = resolve(process.cwd(), '../tmp/recall-property-failures/latest.json');
const CASE_COUNT = Number(process.env.RECALL_PROPERTY_CASES || 12);
const REGENERATE = process.env.REGENERATE_RECALL_GOLDEN === '1';

process.env.SUPABASE_DB_URL ||= DB_URL;
process.env.SUPABASE_DB_SCHEMA ||= SCHEMA;

const { recallEntries, jobdoneDb } = await import('../src/services/database.js');
let jobdonePoolClosed = false;

async function closeJobdonePool() {
  if (jobdonePoolClosed) return;
  jobdonePoolClosed = true;
  await jobdoneDb?.pool?.end?.();
}

function rng(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(random, values) {
  return values[Math.floor(random() * values.length)];
}

function id(seed, slot) {
  const n = ((seed * 1000) + slot).toString(16).padStart(12, '0').slice(-12);
  return `00000000-0000-4000-8000-${n}`;
}

function day(offset) {
  return new Date(Date.UTC(2026, 0, 1 + offset, 10, 0, 0)).toISOString();
}

function entry({
  id: entryId,
  userId,
  summary,
  transcript = 'spoken note',
  createdAt,
  contacts = [],
  locations = [],
  tags = [],
}) {
  return { id: entryId, userId, summary, transcript, createdAt, contacts, locations, tags };
}

function buildWorld(seed) {
  const random = rng(seed);
  const userId = `recall-prop-user-${seed}`;
  const otherUserId = `recall-prop-other-${seed}`;
  const contacts = [
    { id: id(seed, 1), userId, status: 'confirmed', displayName: 'Sarah Jenkins' },
    { id: id(seed, 2), userId, status: 'confirmed', displayName: 'Sarah Jones' },
    { id: id(seed, 3), userId, status: 'confirmed', displayName: pick(random, ['Mike Turner', 'Mick Turner']) },
  ];
  const locations = [
    { id: id(seed, 11), userId, status: 'confirmed', displayName: 'Bell Street', placeText: '14 Bell Street', addressText: '14 Bell Street' },
    { id: id(seed, 12), userId, status: 'confirmed', displayName: 'King Road', placeText: '22 King Road', addressText: '22 King Road' },
  ];
  const tagCategory = { id: id(seed, 21), userId, name: 'Workflow', slug: 'workflow' };
  const tags = [
    { id: id(seed, 31), userId, categoryId: tagCategory.id, status: 'confirmed', label: 'Follow Up' },
    { id: id(seed, 32), userId, categoryId: tagCategory.id, status: 'draft', label: 'Urgent' },
  ];

  const boilerWord = pick(random, ['boiler', 'heating', 'pressure']);
  const pipeWord = pick(random, ['pipe', 'leak', 'stopcock']);
  const entries = [
    entry({
      id: id(seed, 101),
      userId,
      summary: `Checked ${boilerWord} at Bell Street for Sarah Jenkins.`,
      createdAt: day(1),
      contacts: [contacts[0].id],
      locations: [locations[0].id],
    }),
    entry({
      id: id(seed, 102),
      userId,
      summary: `Returned to Bell Street and fixed ${pipeWord} for Sarah Jenkins.`,
      createdAt: day(5),
      contacts: [contacts[0].id],
      locations: [locations[0].id],
    }),
    entry({
      id: id(seed, 103),
      userId,
      summary: `Serviced shower valve at King Road for Sarah Jones.`,
      createdAt: day(3),
      contacts: [contacts[1].id],
      locations: [locations[1].id],
    }),
    entry({
      id: id(seed, 104),
      userId,
      summary: 'Need to return with a part for the towel rail.',
      createdAt: day(4),
      tags: [tags[0].id],
    }),
    entry({
      id: id(seed, 105),
      userId,
      summary: 'General check with no searchable hidden keyword.',
      transcript: 'zebra hidden only in transcript',
      createdAt: day(6),
    }),
    entry({
      id: id(seed, 106),
      userId,
      summary: 'Collected parts from merchant.',
      createdAt: day(7),
      tags: [tags[1].id],
    }),
    entry({
      id: id(seed, 201),
      userId: otherUserId,
      summary: 'Newest Bell Street visit for Sarah Jenkins from wrong user.',
      createdAt: day(9),
    }),
  ];

  const distractorCount = Math.floor(random() * 4);
  for (let i = 0; i < distractorCount; i += 1) {
    entries.push(entry({
      id: id(seed, 300 + i),
      userId,
      summary: pick(random, [
        'Replaced kitchen tap washer.',
        'Quoted for bathroom refit.',
        'Checked radiator valves in hallway.',
      ]),
      createdAt: day(10 + i),
      contacts: random() > 0.5 ? [contacts[2].id] : [],
    }));
  }

  const queries = [
    {
      id: 'contact-full-name',
      text: 'Sarah Jenkins',
      expect: {
        include: [id(seed, 101), id(seed, 102)],
        exclude: [id(seed, 103), id(seed, 201)],
      },
    },
    {
      id: 'ambiguous-first-name',
      text: 'Sarah',
      expect: {
        include: [id(seed, 101), id(seed, 102), id(seed, 103)],
        exclude: [id(seed, 201)],
      },
    },
    {
      id: 'location-history',
      text: 'Bell Street',
      expect: {
        include: [id(seed, 101), id(seed, 102)],
        exclude: [id(seed, 103), id(seed, 201)],
      },
    },
    {
      id: 'recency-location',
      text: 'last time Bell Street',
      expect: {
        include: [id(seed, 101), id(seed, 102)],
        first: id(seed, 102),
        exclude: [id(seed, 201)],
      },
    },
    {
      id: 'workflow-tag',
      text: 'Follow Up',
      expect: {
        include: [id(seed, 104)],
        exclude: [id(seed, 106)],
      },
    },
    {
      id: 'draft-tag-not-truth',
      text: 'Urgent',
      expect: {
        include: [],
        exclude: [id(seed, 106)],
        empty: true,
      },
    },
    {
      id: 'transcript-not-truth',
      text: 'zebra',
      expect: {
        include: [],
        exclude: [id(seed, 105)],
        empty: true,
      },
    },
    {
      id: 'unconfirmed-capture-not-truth',
      text: 'draft estimate',
      expect: {
        include: [],
        exclude: [],
        empty: true,
      },
    },
  ];

  return {
    seed,
    userId,
    otherUserId,
    tagCategories: [tagCategory],
    contacts,
    locations,
    tags,
    entries,
    unconfirmedCaptures: [
      {
        id: `capture-${seed}-1`,
        userId,
        transcript: 'draft estimate before confirmation',
        summary: 'draft estimate',
      },
    ],
    queries,
  };
}

async function loadOrCreateGolden() {
  if (!REGENERATE) {
    try {
      return JSON.parse(await readFile(GOLDEN_PATH, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  const worlds = Array.from({ length: CASE_COUNT }, (_, index) => buildWorld(1000 + index));
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    contract: 'sql-first-recall-v1',
    worlds,
  };

  await mkdir(dirname(GOLDEN_PATH), { recursive: true });
  await writeFile(GOLDEN_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`${REGENERATE ? 'Regenerated' : 'Created'} ${GOLDEN_PATH}`);
  return payload;
}

function quoteIdent(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

function table(name) {
  return `${quoteIdent(SCHEMA)}.${quoteIdent(name)}`;
}

async function verifySchema(pool) {
  const result = await pool.query('select to_regclass($1) as entries', [`${SCHEMA}.entries`]);
  if (!result.rows[0]?.entries) {
    throw new Error(
      `Local JobDone schema not found in ${SCHEMA}. Apply docs/schema.sql first.`
    );
  }
}

async function insertRows(client, tableName, columns, rows) {
  if (!rows.length) return;
  const placeholders = [];
  const values = [];
  for (const row of rows) {
    placeholders.push(`(${columns.map(column => {
      values.push(row[column] ?? null);
      return `$${values.length}`;
    }).join(', ')})`);
  }
  await client.query(
    `insert into ${table(tableName)} (${columns.map(quoteIdent).join(', ')}) values ${placeholders.join(', ')}`,
    values
  );
}

async function cleanUsers(client, userIds) {
  const userColumnByTable = {
    contacts: 'userId',
  };
  for (const tableName of [
    'entry_contacts',
    'entry_locations',
    'entry_tags',
    'tag_vocabulary',
    'context_clues',
    'queries',
    'feedback',
    'entries',
    'contacts',
    'locations',
    'tags',
    'tag_categories',
  ]) {
    const userColumn = userColumnByTable[tableName] || 'user_id';
    await client.query(`delete from ${table(tableName)} where ${quoteIdent(userColumn)} = any($1::text[])`, [userIds]);
  }
}

async function seedWorld(pool, world) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await cleanUsers(client, [world.userId, world.otherUserId]);
    await insertRows(client, 'tag_categories', ['id', 'user_id', 'name', 'slug'], world.tagCategories.map(row => ({
      id: row.id,
      user_id: row.userId,
      name: row.name,
      slug: row.slug,
    })));
    await insertRows(client, 'contacts', ['id', 'userId', 'clientId', 'status', 'displayName'], world.contacts.map(row => ({
      id: row.id,
      userId: row.userId,
      clientId: row.id,
      status: row.status,
      displayName: row.displayName,
    })));
    await insertRows(client, 'locations', ['id', 'user_id', 'status', 'display_name', 'place_text', 'address_text'], world.locations.map(row => ({
      id: row.id,
      user_id: row.userId,
      status: row.status,
      display_name: row.displayName,
      place_text: row.placeText,
      address_text: row.addressText,
    })));
    await insertRows(client, 'tags', ['id', 'user_id', 'category_id', 'status', 'label', 'normalized_label'], world.tags.map(row => ({
      id: row.id,
      user_id: row.userId,
      category_id: row.categoryId,
      status: row.status,
      label: row.label,
      normalized_label: row.label.toLowerCase(),
    })));
    await insertRows(client, 'entries', ['id', 'user_id', 'transcript', 'summary', 'created_at'], world.entries.map(row => ({
      id: row.id,
      user_id: row.userId,
      transcript: row.transcript,
      summary: row.summary,
      created_at: row.createdAt,
    })));

    const entryContacts = world.entries.flatMap(row => row.contacts.map((contactId, index) => ({
      id: id(world.seed, 10000 + parseInt(row.id.slice(-3), 16) + index),
      user_id: row.userId,
      entry_id: row.id,
      contact_id: contactId,
      created_at: row.createdAt,
    })));
    const entryLocations = world.entries.flatMap(row => row.locations.map((locationId, index) => ({
      id: id(world.seed, 11000 + parseInt(row.id.slice(-3), 16) + index),
      user_id: row.userId,
      entry_id: row.id,
      location_id: locationId,
      created_at: row.createdAt,
    })));
    const entryTags = world.entries.flatMap(row => row.tags.map((tagId, index) => ({
      id: id(world.seed, 12000 + parseInt(row.id.slice(-3), 16) + index),
      user_id: row.userId,
      entry_id: row.id,
      tag_id: tagId,
      created_at: row.createdAt,
    })));
    await insertRows(client, 'entry_contacts', ['id', 'user_id', 'entry_id', 'contact_id', 'created_at'], entryContacts);
    await insertRows(client, 'entry_locations', ['id', 'user_id', 'entry_id', 'location_id', 'created_at'], entryLocations);
    await insertRows(client, 'entry_tags', ['id', 'user_id', 'entry_id', 'tag_id', 'created_at'], entryTags);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function validateResult(queryCase, rows) {
  const actualIds = rows.map(row => row.id);
  const failures = [];

  for (const expectedId of queryCase.expect.include || []) {
    if (!actualIds.includes(expectedId)) failures.push(`missing expected ${expectedId}`);
  }
  for (const excludedId of queryCase.expect.exclude || []) {
    if (actualIds.includes(excludedId)) failures.push(`returned excluded ${excludedId}`);
  }
  if (queryCase.expect.first && actualIds[0] !== queryCase.expect.first) {
    failures.push(`expected first ${queryCase.expect.first}, got ${actualIds[0] || '<none>'}`);
  }
  if (queryCase.expect.empty && actualIds.length !== 0) {
    failures.push(`expected empty result, got ${actualIds.length} rows`);
  }

  return {
    ok: failures.length === 0,
    failures,
    actual: rows.map(row => ({
      id: row.id,
      summary: row.summary,
      recall_score: row.recall_score,
      match_reasons: row.match_reasons,
    })),
  };
}

async function runQueryCase(pool, world, queryCase) {
  await seedWorld(pool, world);
  const rows = await recallEntries(world.userId, { query: queryCase.text, limit: 10 });
  return validateResult(queryCase, rows);
}

function pruneWorld(world) {
  const entryIds = new Set(world.entries.map(row => row.id));
  const contactIds = new Set(world.entries.flatMap(row => row.contacts));
  const locationIds = new Set(world.entries.flatMap(row => row.locations));
  const tagIds = new Set(world.entries.flatMap(row => row.tags));
  const categoryIds = new Set(world.tags.filter(row => tagIds.has(row.id)).map(row => row.categoryId));
  return {
    ...world,
    contacts: world.contacts.filter(row => contactIds.has(row.id)),
    locations: world.locations.filter(row => locationIds.has(row.id)),
    tags: world.tags.filter(row => tagIds.has(row.id)),
    tagCategories: world.tagCategories.filter(row => categoryIds.has(row.id)),
    queries: world.queries,
  };
}

async function shrinkFailure(pool, world, queryCase) {
  const protectedIds = new Set([
    ...(queryCase.expect.include || []),
    queryCase.expect.first,
  ].filter(Boolean));
  let current = structuredClone(world);
  let changed = true;

  while (changed) {
    changed = false;
    for (const candidate of [...current.entries]) {
      if (protectedIds.has(candidate.id)) continue;
      const attempt = pruneWorld({
        ...current,
        entries: current.entries.filter(row => row.id !== candidate.id),
      });
      const result = await runQueryCase(pool, attempt, queryCase);
      if (!result.ok) {
        current = attempt;
        changed = true;
      }
    }
  }

  return pruneWorld(current);
}

async function writeFailure(failure) {
  await mkdir(dirname(FAILURE_PATH), { recursive: true });
  await writeFile(FAILURE_PATH, `${JSON.stringify(failure, null, 2)}\n`);
  if (process.env.GITHUB_ACTIONS) {
    console.error(renderGitHubErrorAnnotation(failure));
    console.error('Recall property failed. See the GitHub job summary for the shrunk repro.');
  } else {
    console.error(renderLocalFailureText(failure, FAILURE_PATH));
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    await writeFile(
      process.env.GITHUB_STEP_SUMMARY,
      renderMarkdownSummary(failure, FAILURE_PATH),
      { flag: 'a' },
    );
  }
}

async function main() {
  const golden = await loadOrCreateGolden();
  const pool = new Pool({ connectionString: DB_URL });
  try {
    await verifySchema(pool);
    let checked = 0;

    for (const world of golden.worlds) {
      await seedWorld(pool, world);
      for (const queryCase of world.queries) {
        checked += 1;
        const rows = await recallEntries(world.userId, { query: queryCase.text, limit: 10 });
        const result = validateResult(queryCase, rows);
        if (!result.ok) {
          const shrunkWorld = await shrinkFailure(pool, world, queryCase);
          const shrunkResult = await runQueryCase(pool, shrunkWorld, queryCase);
          const failure = {
            seed: world.seed,
            query: queryCase,
            failures: shrunkResult.failures,
            actual: shrunkResult.actual,
            shrunkWorld,
          };
          await writeFailure(failure);
          process.exitCode = 1;
          return;
        }
      }
    }

    console.log(`Recall property loop passed ${checked} generated queries from ${golden.worlds.length} worlds.`);
  } finally {
    await pool.end();
    await closeJobdonePool();
  }
}

main().catch(async error => {
  console.error(error.stack || error.message || error);
  await closeJobdonePool();
  process.exit(1);
});
