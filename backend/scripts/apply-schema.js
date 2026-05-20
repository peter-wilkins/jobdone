#!/usr/bin/env node

import dotenv from 'dotenv';
dotenv.config();

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';

const args = new Set(process.argv.slice(2));
const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL;
const schemaPath = resolve(process.cwd(), '..', 'docs', 'schema.sql');

if (!databaseUrl) {
  console.error('DATABASE_URL, SUPABASE_DB_URL, or POSTGRES_URL is required.');
  console.error('Use the Supabase direct/session pooler Postgres connection string, not the anon API key.');
  process.exit(1);
}

if (!args.has('--yes')) {
  console.error('Refusing to apply schema without --yes.');
  console.error('This project schema is destructive in clean-slate mode.');
  process.exit(1);
}

function redactConnectionString(value) {
  try {
    const url = new URL(value);
    if (url.password) url.password = '***';
    if (url.username) url.username = url.username.slice(0, 3) + '***';
    return url.toString();
  } catch {
    return '[unparseable connection string]';
  }
}

const client = new Client({
  connectionString: databaseUrl,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
});

try {
  console.log(`Applying ${schemaPath}`);
  console.log(`Target ${redactConnectionString(databaseUrl)}`);
  const sql = await readFile(schemaPath, 'utf8');
  await client.connect();
  await client.query(sql);
  const { rows } = await client.query(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema = 'jobdone'
    ORDER BY table_name
  `);
  console.log(`Applied schema. jobdone tables: ${rows.map(row => row.table_name).join(', ')}`);
} catch (error) {
  console.error('Schema apply failed:', error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
