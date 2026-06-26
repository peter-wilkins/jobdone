#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { createWaterWalkDatasetParsers } from '../shared/contracts/waterWalkDataset.js';

const { parseWaterWalkDataset } = createWaterWalkDatasetParsers(z);

async function loadEnvFile(path) {
  try {
    const text = await readFile(path, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch {
    // The script can also run with environment variables supplied directly.
  }
}

await loadEnvFile(resolve(process.cwd(), 'backend/.env'));

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function quoteIdent(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(String(value || ''))) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
  return `"${value}"`;
}

const inputPath = argValue('--input', 'backend/local/water-walk/dewlish-candidates.json');
const farmId = argValue('--farm-id', process.env.JOBDONE_WATER_WALK_FARM_ID || 'dewlish');
const datasetKind = argValue('--dataset-kind', process.env.JOBDONE_WATER_WALK_DATASET_KIND || 'water_walk');
const updatedBy = argValue('--updated-by', process.env.USER || 'local-script');
const target = argValue('--target', process.env.JOBDONE_WATER_WALK_TARGET || 'staging');

const { createJobDoneDb } = await import('../backend/src/services/postgresDb.js');

async function main() {
  const connectionString = target === 'production'
    ? (process.env.JOBDONE_PROD_BACKEND_DB_URL || process.env.JOBDONE_PROD_SUPABASE_DB_URL || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL)
    : (process.env.JOBDONE_STAGING_SUPABASE_DB_URL || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL);
  if (!connectionString) throw new Error('Set JOBDONE_STAGING_SUPABASE_DB_URL, SUPABASE_DB_URL, or DATABASE_URL');

  const schema = process.env.SUPABASE_DB_SCHEMA || 'jobdone';
  const db = createJobDoneDb({ connectionString, schema });
  const raw = JSON.parse(await readFile(resolve(process.cwd(), inputPath), 'utf8'));
  const parsed = parseWaterWalkDataset(raw);
  if (!parsed.success) {
    throw new Error(`Invalid Water Walk dataset: ${(parsed.errors || [parsed.error]).join('; ')}`);
  }

  const sql = `
    insert into ${quoteIdent(schema)}.farm_datasets (farm_id, dataset_kind, payload, updated_at, updated_by)
    values ($1, $2, $3::jsonb, now(), $4)
    on conflict (farm_id, dataset_kind)
    do update set
      payload = excluded.payload,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
    returning farm_id, dataset_kind, updated_at
  `;
  const { data, error } = await db.query(sql, [
    farmId,
    datasetKind,
    JSON.stringify(parsed.data),
    updatedBy,
  ]);
  await db.pool.end();
  if (error) throw new Error(error.message || 'Water Walk dataset upsert failed');

  const row = data[0];
  console.log(`Upserted ${target} ${row.farm_id}/${row.dataset_kind} at ${row.updated_at}`);
  console.log(`${parsed.data.candidates.length} pins, ${parsed.data.areas.length} areas`);
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
