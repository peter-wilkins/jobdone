import { readFileSync } from 'node:fs';

const mode = process.env.SCHEMA_MODE || 'mvp-clean';
const sqlPath = process.env.LOCAL_REPLICA_SCHEMA_SQL || 'docs/schema.sql';

const expectedTables = {
  syncTransactions: ['t', 'source', 'createdAt'],
  syncTransactionActors: ['t', 'actorUserId', 'actorEmail', 'actorDeviceId'],
  syncObjects: [
    'id',
    'ownerKind',
    'ownerId',
    'collection',
    'createdT',
    'changedT',
    'deletedT',
    'createdAt',
    'changedAt',
    'deletedAt',
    'payloadMeta',
    'payloadJson',
    'payloadBytes',
    'payloadHash',
  ],
  syncObjectPublicProduct: [
    'ownerKind',
    'ownerId',
    'collection',
    'objectId',
    'schemaName',
    'schemaVersion',
    'publicProductJson',
    'changedT',
    'changedAt',
  ],
  syncOwnerAccess: ['id', 'userId', 'ownerKind', 'ownerId', 'capability', 'grantedAt', 'revokedAt'],
  syncIntents: ['id', 'actorUserId', 'intentHash', 'status', 'resultT', 'resultJson', 'createdAt', 'resolvedAt'],
  outboxEffects: [
    'id',
    't',
    'effectType',
    'ownerKind',
    'ownerId',
    'objectRefs',
    'effectJson',
    'status',
    'attempts',
    'nextAttemptAt',
    'createdAt',
    'updatedAt',
    'lastError',
  ],
  opsEvents: [
    'id',
    'requestId',
    'severity',
    'source',
    'kind',
    'action',
    'ownerKind',
    'ownerId',
    'objectRefs',
    'retryable',
    'sanitizedJson',
    'createdAt',
  ],
};

const forbiddenSyncColumns = [
  'replicaEpoch',
  'baseT',
  'remoteId',
  'serverId',
  'updatedAt',
  'updatedT',
];

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function readSql() {
  try {
    return readFileSync(sqlPath, 'utf8');
  } catch (error) {
    fail(`Cannot read schema SQL at ${sqlPath}: ${error.message}`);
  }
}

function extractCreateTableBlock(sql, tableName) {
  const escaped = tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`CREATE TABLE (?:jobdone\\.)?"${escaped}" \\([\\s\\S]*?\\n\\);`, 'm');
  return sql.match(pattern)?.[0] || null;
}

function extractColumns(createTableSql) {
  const columns = [];
  for (const line of createTableSql.split('\n')) {
    const match = line.match(/^\s+(?:"([^"]+)"|([a-z][A-Za-z0-9]*))\s+/);
    if (!match) continue;
    const name = match[1] || match[2];
    if ([
      'PRIMARY',
      'FOREIGN',
      'UNIQUE',
      'CHECK',
      'CONSTRAINT',
    ].includes(name.toUpperCase())) continue;
    columns.push(name);
  }
  return columns;
}

function assertMode() {
  assert(['mvp-clean', 'safety'].includes(mode), `Unsupported SCHEMA_MODE=${mode}`);
  if (mode === 'safety') {
    fail('SCHEMA_MODE=safety is reserved for user-preserving migrations and is not implemented during MVP.');
  }
}

function assertCleanSlate(sql) {
  assert(sql.includes('DROP SCHEMA IF EXISTS jobdone CASCADE;'), 'mvp-clean schema must explicitly drop disposable jobdone schema');
  assert(sql.includes('CREATE SCHEMA jobdone;'), 'Missing jobdone schema creation');
}

function assertTablesAndColumns(sql) {
  for (const [tableName, expectedColumns] of Object.entries(expectedTables)) {
    const block = extractCreateTableBlock(sql, tableName);
    assert(block, `Missing CREATE TABLE jobdone."${tableName}"`);
    assert(block.includes(`jobdone."${tableName}"`), `${tableName} table name must be quoted camelCase`);

    const columns = extractColumns(block);
    assert(
      JSON.stringify(columns) === JSON.stringify(expectedColumns),
      `${tableName} columns mismatch.\nExpected: ${expectedColumns.join(', ')}\nActual:   ${columns.join(', ')}`
    );

    for (const column of expectedColumns) {
      if (/[A-Z]/.test(column)) {
        assert(block.includes(`"${column}"`), `${tableName}.${column} must be quoted camelCase in SQL`);
      }
    }

    for (const forbidden of forbiddenSyncColumns) {
      if (!expectedColumns.includes(forbidden)) {
        assert(!block.includes(`"${forbidden}"`), `${tableName} must not contain stale column "${forbidden}"`);
      }
    }
  }
}

function assertContracts(sql) {
  const syncObjects = extractCreateTableBlock(sql, 'syncObjects');
  assert(syncObjects.includes('PRIMARY KEY (id, "ownerKind", "ownerId")'), 'syncObjects primary key changed unexpectedly');
  assert(syncObjects.includes('"payloadMeta"'), 'syncObjects must use payloadMeta envelope');
  assert(!syncObjects.includes('"replicaEpoch"'), 'syncObjects must not store replicaEpoch');

  const publicProduct = extractCreateTableBlock(sql, 'syncObjectPublicProduct');
  assert(publicProduct.includes('"publicProductJson" jsonb'), 'syncObjectPublicProduct must store publicProductJson');
  assert(publicProduct.includes('ON DELETE CASCADE'), 'syncObjectPublicProduct must cascade with syncObjects');

  const outbox = extractCreateTableBlock(sql, 'outboxEffects');
  assert(outbox.includes('"effectType"'), 'outboxEffects must include effectType');
  assert(outbox.includes('"effectJson"'), 'outboxEffects must include effectJson');
  assert(outbox.includes("'queued','running','succeeded','failed','dead'"), 'outboxEffects status set changed unexpectedly');

  const ops = extractCreateTableBlock(sql, 'opsEvents');
  assert(ops.includes('"requestId"'), 'opsEvents must include requestId');
  assert(ops.includes('"sanitizedJson"'), 'opsEvents must include sanitizedJson');
}

function assertIndexesAndPrivileges(sql) {
  for (const indexName of [
    'syncObjects_owner_collection_id_uidx',
    'syncObjectPublicProduct_owner_collection_idx',
    'syncOwnerAccess_active_uidx',
    'syncIntents_actor_created_idx',
    'outboxEffects_due_idx',
    'opsEvents_request_idx',
  ]) {
    assert(sql.includes(indexName), `Missing index ${indexName}`);
  }

  assert(sql.includes('deny_all_direct_access'), 'Missing deny_all_direct_access policy loop');
  assert(sql.includes('backend_direct_access'), 'Missing backend_direct_access policy loop');
  assert(sql.includes('REVOKE ALL ON SCHEMA jobdone FROM PUBLIC, anon, authenticated;'), 'Missing schema revoke for public client roles');
  assert(sql.includes('REVOKE ALL ON ALL TABLES IN SCHEMA jobdone FROM PUBLIC, anon, authenticated;'), 'Missing table revoke for public client roles');
}

function main() {
  assertMode();
  const sql = readSql();
  assertCleanSlate(sql);
  assertTablesAndColumns(sql);
  assertContracts(sql);
  assertIndexesAndPrivileges(sql);
  console.log(`Local Replica schema conformance passed (${mode}, ${sqlPath})`);
}

main();
