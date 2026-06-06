import { readFileSync } from 'node:fs';

const mode = process.env.SCHEMA_MODE || 'mvp-clean';
const sqlPath = process.env.LOCAL_REPLICA_SCHEMA_SQL || 'supabase/create_jobdone_next_local_replica.sql';

const expectedTables = {
  syncTransactions: {
    columns: {
      t: 'BIGINT',
      replicaEpoch: 'UUID',
      actorUserId: 'UUID',
      actorEmail: 'TEXT',
      actorDeviceId: 'TEXT',
      source: 'TEXT',
      createdAt: 'TIMESTAMPTZ',
    },
    indexes: [
      'syncTransactionsReplicaTIdx',
      'syncTransactionsActorUserTIdx',
    ],
  },
  syncOwnerAccess: {
    columns: {
      id: 'UUID',
      ownerKind: 'TEXT',
      ownerId: 'UUID',
      userId: 'UUID',
      role: 'TEXT',
      createdT: 'BIGINT',
      revokedT: 'BIGINT',
      createdAt: 'TIMESTAMPTZ',
      revokedAt: 'TIMESTAMPTZ',
    },
    indexes: [
      'syncOwnerAccessActiveUidx',
      'syncOwnerAccessUserOwnerIdx',
      'syncOwnerAccessOwnerIdx',
    ],
  },
  syncObjects: {
    columns: {
      id: 'UUID',
      ownerKind: 'TEXT',
      ownerId: 'UUID',
      collection: 'TEXT',
      createdT: 'BIGINT',
      changedT: 'BIGINT',
      deletedT: 'BIGINT',
      createdAt: 'TIMESTAMPTZ',
      changedAt: 'TIMESTAMPTZ',
      deletedAt: 'TIMESTAMPTZ',
      codec: 'TEXT',
      encryptionMode: 'TEXT',
      payloadJson: 'JSONB',
      payloadBytes: 'BYTEA',
      payloadHash: 'TEXT',
      schemaVersion: 'INTEGER',
    },
    indexes: [
      'syncObjectsOwnerChangedIdx',
      'syncObjectsOwnerCollectionChangedIdx',
      'syncObjectsPayloadHashIdx',
      'syncObjectsDeletedIdx',
    ],
  },
  syncIntents: {
    columns: {
      id: 'UUID',
      replicaEpoch: 'UUID',
      baseT: 'BIGINT',
      actorUserId: 'UUID',
      actorDeviceId: 'TEXT',
      ownerKind: 'TEXT',
      ownerId: 'UUID',
      collection: 'TEXT',
      action: 'TEXT',
      objectId: 'UUID',
      baseObjectT: 'BIGINT',
      payloadJson: 'JSONB',
      payloadHash: 'TEXT',
      status: 'TEXT',
      resultJson: 'JSONB',
      committedT: 'BIGINT',
      createdAt: 'TIMESTAMPTZ',
      receivedAt: 'TIMESTAMPTZ',
    },
    indexes: [
      'syncIntentsActorReceivedIdx',
      'syncIntentsOwnerStatusIdx',
      'syncIntentsCommittedTIdx',
    ],
  },
};

const forbiddenNames = [
  'backendId',
  'remoteId',
  'serverId',
  'updatedT',
  'updatedAt',
  'backend_id',
  'remote_id',
  'server_id',
  'owner_id',
  'owner_kind',
  'created_t',
  'changed_t',
  'deleted_t',
  'created_at',
  'changed_at',
  'deleted_at',
  'updated_t',
  'updated_at',
  'payload_json',
  'payload_bytes',
  'payload_hash',
  'schema_version',
  'encryption_mode',
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
  const pattern = new RegExp(`CREATE TABLE "${tableName}" \\([\\s\\S]*?\\n\\);`, 'm');
  const match = sql.match(pattern);
  return match?.[0] || null;
}

function extractColumns(createTableSql) {
  const columns = new Map();
  for (const line of createTableSql.split('\n')) {
    const match = line.match(/^\s+"([^"]+)"\s+([A-Z]+(?:\s+WITH\s+TIME\s+ZONE)?)/);
    if (match) {
      columns.set(match[1], match[2].replace(/\s+/g, ' '));
    }
  }
  return columns;
}

function listCreateTables(sql) {
  return [...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map(match => match[1]);
}

function listQuotedIdentifiers(sql) {
  return [...sql.matchAll(/"([^"]+)"/g)].map(match => match[1]);
}

function assertCamelCaseIdentifiers(sql) {
  const sqlWithoutComments = sql.replace(/--.*$/gm, '');
  const badIdentifiers = listQuotedIdentifiers(sqlWithoutComments)
    .filter(identifier => identifier.includes('_'));
  assert(
    badIdentifiers.length === 0,
    `JobDone sync SQL identifiers must be camelCase. Found: ${[...new Set(badIdentifiers)].join(', ')}`
  );

  for (const forbiddenName of forbiddenNames) {
    assert(
      !sqlWithoutComments.includes(`"${forbiddenName}"`),
      `Forbidden app-facing schema identifier found: "${forbiddenName}"`
    );
  }
}

function assertTableColumns(sql) {
  const actualTables = listCreateTables(sql).sort();
  const expectedTableNames = Object.keys(expectedTables).sort();

  assert(
    JSON.stringify(actualTables) === JSON.stringify(expectedTableNames),
    `Expected only ${expectedTableNames.join(', ')} tables, found ${actualTables.join(', ')}`
  );

  for (const [tableName, expectation] of Object.entries(expectedTables)) {
    const block = extractCreateTableBlock(sql, tableName);
    assert(block, `Missing CREATE TABLE "${tableName}"`);

    const columns = extractColumns(block);
    for (const [columnName, expectedType] of Object.entries(expectation.columns)) {
      assert(columns.has(columnName), `Missing "${tableName}"."${columnName}"`);
      assert(
        columns.get(columnName) === expectedType,
        `"${tableName}"."${columnName}" expected ${expectedType}, got ${columns.get(columnName)}`
      );
    }

    const extraColumns = [...columns.keys()].filter(columnName => !(columnName in expectation.columns));
    assert(
      extraColumns.length === 0,
      `"${tableName}" has unexpected columns: ${extraColumns.join(', ')}`
    );
  }
}

function assertSyncObjectContract(sql) {
  const block = extractCreateTableBlock(sql, 'syncObjects');
  assert(block.includes('PRIMARY KEY ("ownerKind", "ownerId", "collection", "id")'),
    'syncObjects must use owner/collection/id primary key');
  assert(block.includes('CHECK ("changedT" >= "createdT")'),
    'syncObjects must assert changedT >= createdT');
  assert(block.includes('CHECK ("deletedT" IS NULL OR "deletedT" >= "changedT")'),
    'syncObjects must assert deletedT >= changedT');
  assert(block.includes('"collection" ~ \'^[a-z][A-Za-z0-9]*$\''),
    'syncObjects collection names must be camelCase without underscores');
  assert(block.includes('"codec" IN (\'json\')'),
    'syncObjects MVP codec must be json');
  assert(block.includes('"encryptionMode" IN (\'none\')'),
    'syncObjects MVP encryptionMode must be none');
  assert(block.includes('CHECK ("payloadBytes" IS NULL)'),
    'syncObjects must keep payloadBytes disabled while MVP codec is json');
}

function assertIndexes(sql) {
  for (const [tableName, expectation] of Object.entries(expectedTables)) {
    for (const indexName of expectation.indexes) {
      assert(sql.includes(`CREATE INDEX "${indexName}"`) || sql.includes(`CREATE UNIQUE INDEX "${indexName}"`),
        `Missing expected index ${indexName} for ${tableName}`);
    }
  }
}

function assertRls(sql) {
  for (const tableName of Object.keys(expectedTables)) {
    assert(sql.includes(`ALTER TABLE "${tableName}" ENABLE ROW LEVEL SECURITY;`),
      `Missing RLS enablement for ${tableName}`);
    assert(sql.includes(`'${tableName}'`),
      `Policy loop must include ${tableName}`);
  }

  assert(sql.includes('deny_all_direct_access'), 'Missing deny_all_direct_access policy');
  assert(sql.includes('backend_direct_access'), 'Missing backend_direct_access policy');
  assert(sql.includes('REVOKE ALL ON SCHEMA jobdone_next FROM PUBLIC, anon, authenticated;'),
    'Missing schema revoke for public client roles');
  assert(sql.includes('REVOKE ALL ON ALL TABLES IN SCHEMA jobdone_next FROM PUBLIC, anon, authenticated;'),
    'Missing table revoke for public client roles');
}

function assertMode() {
  assert(['mvp-clean', 'safety'].includes(mode), `Unsupported SCHEMA_MODE=${mode}`);
  if (mode === 'safety') {
    fail('SCHEMA_MODE=safety is reserved for user-preserving migrations and is not implemented during MVP.');
  }
}

function main() {
  assertMode();
  const sql = readSql();

  assert(sql.includes('DROP SCHEMA IF EXISTS jobdone_next CASCADE;'),
    'mvp-clean schema must be explicitly disposable');
  assert(sql.includes('CREATE SCHEMA jobdone_next;'), 'Missing jobdone_next schema creation');

  assertCamelCaseIdentifiers(sql);
  assertTableColumns(sql);
  assertSyncObjectContract(sql);
  assertIndexes(sql);
  assertRls(sql);

  console.log(`Local Replica schema conformance passed (${mode})`);
}

main();
