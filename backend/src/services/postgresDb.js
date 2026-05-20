import pg from 'pg';

const { Pool } = pg;

function quoteIdent(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
  return `"${value}"`;
}

function quoteColumn(value) {
  return String(value)
    .split('.')
    .map(quoteIdent)
    .join('.');
}

function normalizePgError(error) {
  if (!error) return error;
  return {
    ...error,
    message: error.message,
    code: error.code,
    details: error.detail,
    hint: error.hint,
  };
}

function selectedColumns(selection) {
  if (!selection || selection === '*') return '*';
  if (/locations\(|contacts\(|tags\(|tag_categories\(/.test(selection)) return '*';
  return selection
    .split(',')
    .map(column => quoteIdent(column.trim()))
    .join(', ');
}

function tableRef(schema, table) {
  return `${quoteIdent(schema)}.${quoteIdent(table)}`;
}

function buildWhere(filters, values) {
  if (!filters.length) return '';
  const clauses = filters.map(filter => {
    if (filter.kind === 'eq') {
      values.push(filter.value);
      return `${quoteColumn(filter.column)} = $${values.length}`;
    }
    if (filter.kind === 'neq') {
      values.push(filter.value);
      return `${quoteColumn(filter.column)} <> $${values.length}`;
    }
    if (filter.kind === 'in') {
      values.push(filter.values);
      return `${quoteColumn(filter.column)} = ANY($${values.length})`;
    }
    throw new Error(`Unsupported filter: ${filter.kind}`);
  });
  return ` where ${clauses.join(' and ')}`;
}

function valueForColumn(column, value) {
  if (column === 'embedding' && Array.isArray(value)) {
    return `[${value.join(',')}]`;
  }
  return value ?? null;
}

function rowsFromResult(result, singleMode) {
  if (singleMode === 'single') return result.rows[0] || null;
  return result.rows;
}

export function createJobDoneDb({ connectionString, schema = 'jobdone' } = {}) {
  if (!connectionString) return null;
  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes('supabase.com')
      ? { rejectUnauthorized: false }
      : undefined,
    max: Number(process.env.DB_POOL_MAX || 5),
  });

  return new JobDoneDb(pool, schema);
}

class JobDoneDb {
  constructor(pool, schema) {
    this.pool = pool;
    this.schema = schema;
  }

  from(table) {
    return new QueryBuilder(this.pool, this.schema, table);
  }

  async rpc(name, args = {}) {
    try {
      if (name === 'match_entries') {
        const result = await this.pool.query(
          `select * from ${quoteIdent(this.schema)}.match_entries($1, $2::extensions.vector(1024), $3, $4)`,
          [args.p_user_id, args.p_query_embedding, args.p_match_count, args.p_similarity_floor]
        );
        return { data: result.rows, error: null };
      }

      if (name === 'increment_tag_vocabulary') {
        await this.pool.query(
          `select ${quoteIdent(this.schema)}.increment_tag_vocabulary($1, $2::uuid)`,
          [args.p_user_id, args.p_tag_id]
        );
        return { data: null, error: null };
      }

      throw new Error(`Unsupported RPC: ${name}`);
    } catch (error) {
      return { data: null, error: normalizePgError(error) };
    }
  }
}

class QueryBuilder {
  constructor(pool, schema, table) {
    this.pool = pool;
    this.schema = schema;
    this.table = table;
    this.operation = 'select';
    this.rows = null;
    this.patch = null;
    this.selection = '*';
    this.filters = [];
    this.orders = [];
    this.rowLimit = null;
    this.singleMode = null;
    this.conflictColumns = [];
    this.returnRows = false;
  }

  select(selection = '*') {
    this.selection = selection;
    this.returnRows = true;
    return this;
  }

  insert(rows) {
    this.operation = 'insert';
    this.rows = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  update(values) {
    this.operation = 'update';
    this.patch = values || {};
    return this;
  }

  delete() {
    this.operation = 'delete';
    return this;
  }

  upsert(rows, { onConflict } = {}) {
    this.operation = 'upsert';
    this.rows = Array.isArray(rows) ? rows : [rows];
    this.conflictColumns = String(onConflict || '')
      .split(',')
      .map(column => column.trim())
      .filter(Boolean);
    return this;
  }

  eq(column, value) {
    this.filters.push({ kind: 'eq', column, value });
    return this;
  }

  neq(column, value) {
    this.filters.push({ kind: 'neq', column, value });
    return this;
  }

  in(column, values) {
    this.filters.push({ kind: 'in', column, values: values || [] });
    return this;
  }

  order(column, { ascending = true } = {}) {
    this.orders.push({ column, ascending });
    return this;
  }

  limit(value) {
    this.rowLimit = value;
    return this;
  }

  single() {
    this.singleMode = 'single';
    return this;
  }

  maybeSingle() {
    this.singleMode = 'single';
    return this;
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }

  async execute() {
    try {
      const result = await this.pool.query(...this.toSql());
      return { data: rowsFromResult(result, this.singleMode), error: null };
    } catch (error) {
      return { data: this.singleMode ? null : [], error: normalizePgError(error) };
    }
  }

  toSql() {
    if (this.operation === 'select') return this.selectSql();
    if (this.operation === 'insert') return this.insertSql(false);
    if (this.operation === 'upsert') return this.insertSql(true);
    if (this.operation === 'update') return this.updateSql();
    if (this.operation === 'delete') return this.deleteSql();
    throw new Error(`Unsupported operation: ${this.operation}`);
  }

  selectSql() {
    if (this.table === 'entry_locations' && /locations\(/.test(this.selection)) {
      return this.joinSql('location_id', 'locations', 'locations');
    }
    if (this.table === 'entry_contacts' && /contacts\(/.test(this.selection)) {
      return this.joinSql('contact_id', 'contacts', 'contacts');
    }
    if (this.table === 'entry_tags' && /tags\(/.test(this.selection)) {
      return this.joinSql('tag_id', 'tags', 'tags', true);
    }
    if (this.table === 'tag_vocabulary' && /tags\(/.test(this.selection)) {
      return this.tagVocabularySql();
    }

    const values = [];
    let sql = `select ${selectedColumns(this.selection)} from ${tableRef(this.schema, this.table)}`;
    sql += buildWhere(this.filters, values);
    sql += this.orderLimitSql();
    return [sql, values];
  }

  joinSql(foreignKey, joinedTable, alias, includeCategory = false) {
    const values = [];
    const joinedColumns = includeCategory
      ? `to_jsonb(j.*) || jsonb_build_object('tag_categories', to_jsonb(tc.*))`
      : 'to_jsonb(j.*)';
    let sql = `
      select l.entry_id, l.created_at, ${joinedColumns} as ${quoteIdent(alias)}
      from ${tableRef(this.schema, this.table)} l
      join ${tableRef(this.schema, joinedTable)} j on j.id = l.${quoteIdent(foreignKey)}
      ${includeCategory ? `left join ${tableRef(this.schema, 'tag_categories')} tc on tc.id = j.category_id` : ''}
    `;
    sql += buildWhere(this.filters.map(filter => ({ ...filter, column: `l.${filter.column}` })), values);
    sql += this.orderLimitSql('l');
    return [sql, values];
  }

  tagVocabularySql() {
    const values = [];
    let sql = `
      select v.*, to_jsonb(t.*) || jsonb_build_object('tag_categories', to_jsonb(c.*)) as tags
      from ${tableRef(this.schema, 'tag_vocabulary')} v
      join ${tableRef(this.schema, 'tags')} t on t.id = v.tag_id
      left join ${tableRef(this.schema, 'tag_categories')} c on c.id = t.category_id
    `;
    sql += buildWhere(this.filters.map(filter => ({ ...filter, column: `v.${filter.column}` })), values);
    sql += this.orderLimitSql('v');
    return [sql, values];
  }

  insertSql(upsert) {
    const rows = this.rows || [];
    if (!rows.length) return ['select null where false', []];
    const columns = Array.from(new Set(rows.flatMap(row => Object.keys(row))));
    const values = [];
    const tuples = rows.map(row => {
      const placeholders = columns.map(column => {
        values.push(valueForColumn(column, row[column]));
        return `$${values.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    let sql = `insert into ${tableRef(this.schema, this.table)} (${columns.map(quoteIdent).join(', ')}) values ${tuples.join(', ')}`;
    if (upsert) {
      const conflicts = this.conflictColumns;
      const updates = columns
        .filter(column => !conflicts.includes(column))
        .map(column => `${quoteIdent(column)} = excluded.${quoteIdent(column)}`);
      sql += ` on conflict (${conflicts.map(quoteIdent).join(', ')}) `;
      sql += updates.length ? `do update set ${updates.join(', ')}` : 'do nothing';
    }
    if (this.returnRows) sql += ` returning ${selectedColumns(this.selection)}`;
    return [sql, values];
  }

  updateSql() {
    const values = [];
    const columns = Object.keys(this.patch || {});
    const setSql = columns.map(column => {
      values.push(valueForColumn(column, this.patch[column]));
      return `${quoteIdent(column)} = $${values.length}`;
    }).join(', ');
    let sql = `update ${tableRef(this.schema, this.table)} set ${setSql}`;
    sql += buildWhere(this.filters, values);
    if (this.returnRows) sql += ` returning ${selectedColumns(this.selection)}`;
    return [sql, values];
  }

  deleteSql() {
    const values = [];
    let sql = `delete from ${tableRef(this.schema, this.table)}`;
    sql += buildWhere(this.filters, values);
    return [sql, values];
  }

  orderLimitSql(alias = null) {
    const prefix = alias ? `${alias}.` : '';
    let sql = '';
    if (this.orders.length) {
      sql += ` order by ${this.orders.map(order =>
        `${prefix}${quoteIdent(order.column)} ${order.ascending ? 'asc' : 'desc'}`
      ).join(', ')}`;
    }
    if (this.rowLimit !== null) sql += ` limit ${Number(this.rowLimit)}`;
    return sql;
  }
}
