import pg from 'pg';

const { Pool } = pg;

function quoteIdent(value) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(String(value || ''))) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
  return `"${value}"`;
}

function tableRef(schema, table) {
  return `${quoteIdent(schema)}.${quoteIdent(table)}`;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toIso(value) {
  if (value instanceof Date) return value.toISOString();
  return String(value || new Date().toISOString());
}

function normalizeSyncObject(row = {}) {
  return {
    id: row.id,
    ownerKind: row.ownerKind,
    ownerId: row.ownerId,
    collection: row.collection,
    createdT: toNumber(row.createdT),
    changedT: toNumber(row.changedT),
    deletedT: row.deletedT == null ? null : toNumber(row.deletedT),
    createdAt: toIso(row.createdAt),
    changedAt: toIso(row.changedAt),
    deletedAt: row.deletedAt == null ? null : toIso(row.deletedAt),
    codec: row.codec || 'json',
    encryptionMode: row.encryptionMode || 'none',
    payloadJson: row.payloadJson || {},
    payloadBytes: null,
    payloadHash: row.payloadHash,
    schemaVersion: toNumber(row.schemaVersion, 1),
  };
}

function intentResult({ intentId, status, t = null, objectId = null, reason = null }) {
  return { intentId, status, t, objectId, reason };
}

export function createLocalReplicaStore({ connectionString, schema = 'jobdone_next', pool = null } = {}) {
  const ownedPool = pool ? null : connectionString ? new Pool({ connectionString }) : null;
  return new LocalReplicaStore({ pool: pool || ownedPool, schema, ownsPool: Boolean(ownedPool) });
}

export class LocalReplicaStore {
  constructor({ pool, schema = 'jobdone_next', ownsPool = false } = {}) {
    this.pool = pool;
    this.schema = schema;
    this.ownsPool = ownsPool;
  }

  get configured() {
    return Boolean(this.pool);
  }

  async close() {
    if (this.ownsPool && this.pool) await this.pool.end();
  }

  table(tableName) {
    return tableRef(this.schema, tableName);
  }

  async push({ actorUserId, actorEmail = null, actorDeviceId = null, request }) {
    if (!this.pool) throw new Error('Local Replica database not configured');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [`${this.schema}:localReplicaPush`]);

      const results = [];
      const objects = [];

      for (const intent of request.intents) {
        const outcome = await this.applyIntent(client, {
          actorUserId,
          actorEmail,
          actorDeviceId,
          replicaEpoch: request.replicaEpoch,
          baseT: request.baseT,
          intent,
        });
        results.push(outcome.result);
        if (outcome.object) objects.push(outcome.object);
      }

      const toT = await this.currentT(client);
      await client.query('COMMIT');
      return {
        replicaEpoch: request.replicaEpoch,
        baseT: request.baseT,
        toT,
        results,
        objects,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async pull({ actorUserId, request }) {
    if (!this.pool) throw new Error('Local Replica database not configured');
    const client = await this.pool.connect();
    try {
      const toT = await this.currentT(client, request.sinceT);
      const scopes = await this.accessibleScopes(client, actorUserId);
      if (!scopes.length) {
        return {
          replicaEpoch: request.replicaEpoch,
          fromT: request.sinceT,
          toT,
          hasMore: false,
          objects: [],
        };
      }

      const limit = Math.max(1, Math.min(Number(request.limit || 100), 1000));
      const { clause, values } = scopeWhereClause(scopes, 4);
      const result = await client.query(`
        SELECT *
        FROM ${this.table('syncObjects')}
        WHERE "changedT" > $1
          AND "changedT" <= $2
          AND (${clause})
        ORDER BY "changedT" ASC, "ownerKind" ASC, "ownerId" ASC, "collection" ASC, "id" ASC
        LIMIT $3
      `, [request.sinceT, toT, limit + 1, ...values]);

      const rows = result.rows.slice(0, limit);
      return {
        replicaEpoch: request.replicaEpoch,
        fromT: request.sinceT,
        toT,
        hasMore: result.rows.length > limit,
        objects: rows.map(normalizeSyncObject),
      };
    } finally {
      client.release();
    }
  }

  async applyIntent(client, { actorUserId, actorEmail, actorDeviceId, replicaEpoch, baseT, intent }) {
    const existingIntent = await this.findIntent(client, intent.id);
    if (existingIntent) {
      return this.existingIntentOutcome(client, existingIntent);
    }

    const hasAccess = await this.hasOwnerAccess(client, actorUserId, intent);
    if (!hasAccess) {
      return this.persistIntentResult(client, {
        actorUserId,
        actorDeviceId,
        replicaEpoch,
        baseT,
        intent,
        result: intentResult({
          intentId: intent.id,
          status: 'rejected',
          objectId: intent.objectId || null,
          reason: 'ownerAccessDenied',
        }),
      });
    }

    if (!['createObject', 'updateObject', 'deleteObject'].includes(intent.action)) {
      return this.persistIntentResult(client, {
        actorUserId,
        actorDeviceId,
        replicaEpoch,
        baseT,
        intent,
        result: intentResult({
          intentId: intent.id,
          status: 'rejected',
          objectId: intent.objectId || null,
          reason: 'unsupportedAction',
        }),
      });
    }

    if (!intent.objectId) {
      return this.persistIntentResult(client, {
        actorUserId,
        actorDeviceId,
        replicaEpoch,
        baseT,
        intent,
        result: intentResult({
          intentId: intent.id,
          status: 'rejected',
          reason: 'objectIdRequired',
        }),
      });
    }

    const current = await this.findObject(client, intent);

    if (intent.action === 'createObject') {
      if (!current) {
        const t = await this.createTransaction(client, { replicaEpoch, actorUserId, actorEmail, actorDeviceId });
        const object = await this.insertObject(client, { intent, t });
        return this.persistIntentResult(client, {
          actorUserId,
          actorDeviceId,
          replicaEpoch,
          baseT,
          intent,
          committedT: t,
          result: intentResult({ intentId: intent.id, status: 'accepted', t, objectId: intent.objectId }),
          object,
        });
      }

      const object = normalizeSyncObject(current);
      const status = current.payloadHash === intent.payloadHash ? 'idempotent' : 'conflict';
      return this.persistIntentResult(client, {
        actorUserId,
        actorDeviceId,
        replicaEpoch,
        baseT,
        intent,
        committedT: status === 'idempotent' ? object.changedT : null,
        result: intentResult({
          intentId: intent.id,
          status,
          t: object.changedT,
          objectId: intent.objectId,
          reason: status === 'conflict' ? 'objectAlreadyExists' : null,
        }),
        object,
      });
    }

    if (!current || current.deletedT != null) {
      return this.persistIntentResult(client, {
        actorUserId,
        actorDeviceId,
        replicaEpoch,
        baseT,
        intent,
        result: intentResult({
          intentId: intent.id,
          status: current?.deletedT != null ? 'idempotent' : 'conflict',
          t: current?.changedT == null ? null : toNumber(current.changedT),
          objectId: intent.objectId,
          reason: current ? null : 'objectMissing',
        }),
        object: current ? normalizeSyncObject(current) : null,
      });
    }

    const currentT = toNumber(current.changedT);
    if (intent.baseObjectT !== currentT) {
      return this.persistIntentResult(client, {
        actorUserId,
        actorDeviceId,
        replicaEpoch,
        baseT,
        intent,
        result: intentResult({
          intentId: intent.id,
          status: 'conflict',
          t: currentT,
          objectId: intent.objectId,
          reason: 'staleBaseObjectT',
        }),
        object: normalizeSyncObject(current),
      });
    }

    const t = await this.createTransaction(client, { replicaEpoch, actorUserId, actorEmail, actorDeviceId });
    const object = intent.action === 'deleteObject'
      ? await this.deleteObject(client, { intent, t })
      : await this.updateObject(client, { intent, t, current });
    return this.persistIntentResult(client, {
      actorUserId,
      actorDeviceId,
      replicaEpoch,
      baseT,
      intent,
      committedT: t,
      result: intentResult({ intentId: intent.id, status: 'accepted', t, objectId: intent.objectId }),
      object,
    });
  }

  async currentT(client, fallback = 0) {
    const result = await client.query(`SELECT coalesce(max("t"), $1)::bigint AS "toT" FROM ${this.table('syncTransactions')}`, [fallback]);
    return toNumber(result.rows[0]?.toT, fallback);
  }

  async createTransaction(client, { replicaEpoch, actorUserId, actorEmail, actorDeviceId }) {
    const result = await client.query(`
      INSERT INTO ${this.table('syncTransactions')}
        ("replicaEpoch", "actorUserId", "actorEmail", "actorDeviceId", "source")
      VALUES ($1, $2, $3, $4, 'syncPush')
      RETURNING "t"
    `, [replicaEpoch, actorUserId, actorEmail, actorDeviceId]);
    return toNumber(result.rows[0].t);
  }

  async accessibleScopes(client, actorUserId) {
    const result = await client.query(`
      SELECT "ownerKind", "ownerId"
      FROM ${this.table('syncOwnerAccess')}
      WHERE "userId" = $1
        AND "revokedT" IS NULL
    `, [actorUserId]);
    const scopes = [{ ownerKind: 'user', ownerId: actorUserId }];
    for (const row of result.rows) {
      scopes.push({ ownerKind: row.ownerKind, ownerId: row.ownerId });
    }
    return uniqueScopes(scopes);
  }

  async hasOwnerAccess(client, actorUserId, intent) {
    if (intent.ownerKind === 'user' && intent.ownerId === actorUserId) return true;
    const result = await client.query(`
      SELECT 1
      FROM ${this.table('syncOwnerAccess')}
      WHERE "ownerKind" = $1
        AND "ownerId" = $2
        AND "userId" = $3
        AND "revokedT" IS NULL
      LIMIT 1
    `, [intent.ownerKind, intent.ownerId, actorUserId]);
    return result.rowCount > 0;
  }

  async findIntent(client, intentId) {
    const result = await client.query(`SELECT * FROM ${this.table('syncIntents')} WHERE "id" = $1`, [intentId]);
    return result.rows[0] || null;
  }

  async existingIntentOutcome(client, row) {
    const result = row.resultJson?.result || intentResult({
      intentId: row.id,
      status: row.status,
      t: row.committedT == null ? null : toNumber(row.committedT),
      objectId: row.objectId || null,
    });
    const object = row.objectId ? await this.findObject(client, {
      ownerKind: row.ownerKind,
      ownerId: row.ownerId,
      collection: row.collection,
      objectId: row.objectId,
    }) : null;
    return {
      result,
      object: object ? normalizeSyncObject(object) : null,
    };
  }

  async findObject(client, intent) {
    const result = await client.query(`
      SELECT *
      FROM ${this.table('syncObjects')}
      WHERE "ownerKind" = $1
        AND "ownerId" = $2
        AND "collection" = $3
        AND "id" = $4
    `, [intent.ownerKind, intent.ownerId, intent.collection, intent.objectId]);
    return result.rows[0] || null;
  }

  async insertObject(client, { intent, t }) {
    const result = await client.query(`
      INSERT INTO ${this.table('syncObjects')}
        ("id", "ownerKind", "ownerId", "collection", "createdT", "changedT",
         "createdAt", "changedAt", "payloadJson", "payloadHash", "schemaVersion")
      VALUES ($1, $2, $3, $4, $5, $5, $6, $6, $7::jsonb, $8, 1)
      RETURNING *
    `, [
      intent.objectId,
      intent.ownerKind,
      intent.ownerId,
      intent.collection,
      t,
      intent.createdAt,
      JSON.stringify(intent.payloadJson || {}),
      intent.payloadHash || `missing:${intent.id}`,
    ]);
    return normalizeSyncObject(result.rows[0]);
  }

  async updateObject(client, { intent, t, current }) {
    const result = await client.query(`
      UPDATE ${this.table('syncObjects')}
      SET "changedT" = $5,
          "changedAt" = $6,
          "deletedT" = NULL,
          "deletedAt" = NULL,
          "payloadJson" = $7::jsonb,
          "payloadHash" = $8,
          "schemaVersion" = 1
      WHERE "ownerKind" = $1
        AND "ownerId" = $2
        AND "collection" = $3
        AND "id" = $4
      RETURNING *
    `, [
      intent.ownerKind,
      intent.ownerId,
      intent.collection,
      intent.objectId,
      t,
      intent.createdAt,
      JSON.stringify(intent.payloadJson || current.payloadJson || {}),
      intent.payloadHash || current.payloadHash,
    ]);
    return normalizeSyncObject(result.rows[0]);
  }

  async deleteObject(client, { intent, t }) {
    const result = await client.query(`
      UPDATE ${this.table('syncObjects')}
      SET "changedT" = $5,
          "changedAt" = $6,
          "deletedT" = $5,
          "deletedAt" = $6
      WHERE "ownerKind" = $1
        AND "ownerId" = $2
        AND "collection" = $3
        AND "id" = $4
      RETURNING *
    `, [
      intent.ownerKind,
      intent.ownerId,
      intent.collection,
      intent.objectId,
      t,
      intent.createdAt,
    ]);
    return normalizeSyncObject(result.rows[0]);
  }

  async persistIntentResult(client, {
    actorUserId,
    actorDeviceId,
    replicaEpoch,
    baseT,
    intent,
    result,
    committedT = null,
    object = null,
  }) {
    await client.query(`
      INSERT INTO ${this.table('syncIntents')}
        ("id", "replicaEpoch", "baseT", "actorUserId", "actorDeviceId",
         "ownerKind", "ownerId", "collection", "action", "objectId",
         "baseObjectT", "payloadJson", "payloadHash", "status", "resultJson",
         "committedT", "createdAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15::jsonb, $16, $17)
    `, [
      intent.id,
      replicaEpoch,
      baseT,
      actorUserId,
      actorDeviceId,
      intent.ownerKind,
      intent.ownerId,
      intent.collection,
      intent.action,
      intent.objectId || null,
      intent.baseObjectT ?? null,
      JSON.stringify(intent.payloadJson || {}),
      intent.payloadHash || null,
      result.status,
      JSON.stringify({ result }),
      committedT,
      intent.createdAt,
    ]);
    return { result, object };
  }
}

function uniqueScopes(scopes) {
  const seen = new Set();
  return scopes.filter(scope => {
    const key = `${scope.ownerKind}:${scope.ownerId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scopeWhereClause(scopes, firstParamIndex) {
  const values = [];
  const clauses = scopes.map((scope, index) => {
    const base = firstParamIndex + index * 2;
    values.push(scope.ownerKind, scope.ownerId);
    return `("ownerKind" = $${base} AND "ownerId" = $${base + 1})`;
  });
  return { clause: clauses.join(' OR '), values };
}
