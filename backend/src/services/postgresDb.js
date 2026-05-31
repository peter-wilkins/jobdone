import { readFileSync } from 'node:fs';
import pg from 'pg';

const { Pool } = pg;
const SUPABASE_CA_CERT_PATH = new URL('../../certs/supabase-root-2021-ca.pem', import.meta.url);

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

export function normalizeRecallText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const RECALL_STOP_WORDS = new Set([
  'a',
  'about',
  'an',
  'and',
  'at',
  'did',
  'do',
  'for',
  'i',
  'job',
  'jobs',
  'last',
  'latest',
  'me',
  'most',
  'recent',
  'show',
  'the',
  'time',
  'to',
  'what',
  'when',
  'where',
  'with',
  'work',
  'worked',
]);

export function recallQueryTerms(query) {
  return Array.from(new Set(
    normalizeRecallText(query)
      .split(' ')
      .filter(term => term.length > 1 && !RECALL_STOP_WORDS.has(term))
  ));
}

export function isRecencyRecallQuery(query) {
  return /\b(last time|latest|most recent|recent|last visit)\b/i.test(String(query || ''));
}

function normalizedSql(expression) {
  return `btrim(regexp_replace(lower(coalesce(${expression}, '')), '[^[:alnum:]]+', ' ', 'g'))`;
}

function safeLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 10;
  return Math.max(1, Math.min(Math.trunc(parsed), 50));
}

export function buildSqlFirstRecallQuery({
  schema = 'jobdone',
  userId,
  query = '',
  terms = recallQueryTerms(query),
  limit = 10,
  recencyIntent = isRecencyRecallQuery(query),
} = {}) {
  const entries = tableRef(schema, 'entries');
  const entryContacts = tableRef(schema, 'entry_contacts');
  const contacts = tableRef(schema, 'contacts');
  const entryLocations = tableRef(schema, 'entry_locations');
  const locations = tableRef(schema, 'locations');
  const entryTags = tableRef(schema, 'entry_tags');
  const tags = tableRef(schema, 'tags');
  const normalizedQuery = normalizeRecallText(query);
  const values = [userId, normalizedQuery, terms, safeLimit(limit), Boolean(recencyIntent)];
  const labelMatches = labelsColumn => `
    coalesce((
      select array_agg(label order by label)
      from unnest(${labelsColumn}) as label
      where ${normalizedSql('label')} <> ''
        and (
          ($2 <> '' and position((' ' || ${normalizedSql('label')} || ' ') in (' ' || $2 || ' ')) > 0)
          or exists (
            select 1
            from unnest($3::text[]) as term
            where position((' ' || term || ' ') in (' ' || ${normalizedSql('label')} || ' ')) > 0
          )
        )
    ), array[]::text[])
  `;
  const reasonsFor = (column, kind, score) => `
    coalesce((
      select jsonb_agg(jsonb_build_object('kind', '${kind}', 'label', label, 'score', ${score}) order by label)
      from unnest(${column}) as label
    ), '[]'::jsonb)
  `;

  const sql = `
    with base as (
      select
        e.id,
        e.user_id,
        e.capture_id,
        e.transcript,
        e.summary,
        e.created_at,
        coalesce((
          select array_agg(distinct c.display_name order by c.display_name)
          from ${entryContacts} ec
          join ${contacts} c on c.id = ec.contact_id and c.user_id = ec.user_id
          where ec.user_id = e.user_id
            and ec.entry_id = e.id
            and c.status = 'confirmed'
            and c.display_name <> ''
        ), array[]::text[]) as contact_labels,
        coalesce((
          select array_agg(distinct label order by label)
          from ${entryLocations} el
          join ${locations} l on l.id = el.location_id and l.user_id = el.user_id
          cross join lateral (values (l.display_name), (l.place_text), (l.address_text)) as labels(label)
          where el.user_id = e.user_id
            and el.entry_id = e.id
            and l.status = 'confirmed'
            and label <> ''
        ), array[]::text[]) as location_labels,
        coalesce((
          select array_agg(distinct t.label order by t.label)
          from ${entryTags} et
          join ${tags} t on t.id = et.tag_id and t.user_id = et.user_id
          where et.user_id = e.user_id
            and et.entry_id = e.id
            and t.status = 'confirmed'
            and t.label <> ''
        ), array[]::text[]) as tag_labels
      from ${entries} e
      where e.user_id = $1
    ),
    normalized as (
      select
        base.*,
        ${normalizedSql('base.summary')} as summary_norm
      from base
    ),
    matched as (
      select
        normalized.*,
        ${labelMatches('contact_labels')} as matched_contacts,
        ${labelMatches('location_labels')} as matched_locations,
        ${labelMatches('tag_labels')} as matched_tags,
        coalesce((
          select array_agg(term order by term)
          from unnest($3::text[]) as term
          where position((' ' || term || ' ') in (' ' || summary_norm || ' ')) > 0
        ), array[]::text[]) as matched_summary_terms,
        ($2 <> '' and position((' ' || $2 || ' ') in (' ' || summary_norm || ' ')) > 0) as matched_summary_phrase
      from normalized
    ),
    scored as (
      select
        matched.*,
        (
          cardinality(matched_contacts) * 4.0 +
          cardinality(matched_locations) * 4.0 +
          cardinality(matched_tags) * 2.0 +
          cardinality(matched_summary_terms) * 1.0 +
          case when matched_summary_phrase then 1.5 else 0 end
        ) as lexical_score
      from matched
    ),
    ranked as (
      select
        scored.*,
        case
          when $5::boolean and lexical_score > 0
            then greatest(0, 0.5 - ((dense_rank() over (order by created_at desc) - 1) * 0.05))
          else 0
        end as recency_score
      from scored
    )
    select
      id,
      user_id,
      capture_id,
      transcript,
      summary,
      created_at,
      (lexical_score + recency_score)::float as recall_score,
      (lexical_score + recency_score)::float as similarity,
      lexical_score::float as lexical_score,
      recency_score::float as recency_score,
      ${reasonsFor('matched_contacts', 'contact', '4.0')} ||
      ${reasonsFor('matched_locations', 'location', '4.0')} ||
      ${reasonsFor('matched_tags', 'tag', '2.0')} ||
      ${reasonsFor('matched_summary_terms', 'summary', '1.0')} ||
      case
        when matched_summary_phrase
          then jsonb_build_array(jsonb_build_object('kind', 'summary_phrase', 'label', $2, 'score', 1.5))
        else '[]'::jsonb
      end ||
      case
        when recency_score > 0
          then jsonb_build_array(jsonb_build_object('kind', 'recency', 'label', created_at, 'score', recency_score))
        else '[]'::jsonb
      end as match_reasons
    from ranked
    where lexical_score > 0
    order by recall_score desc, created_at desc, id asc
    limit $4
  `;

  return [sql, values];
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
    ssl: sslConfigForConnection(connectionString),
    max: Number(process.env.DB_POOL_MAX || 5),
  });

  return new JobDoneDb(pool, schema);
}

export function sslConfigForConnection(connectionString) {
  if (!connectionString?.includes('supabase.com')) return undefined;

  const ca = process.env.SUPABASE_DB_CA_CERT?.replace(/\\n/g, '\n') ||
    readFileSync(SUPABASE_CA_CERT_PATH, 'utf8');

  return {
    rejectUnauthorized: true,
    ca,
  };
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

  async recallEntriesSql({ userId, query = '', limit = 10 } = {}) {
    try {
      const result = await this.pool.query(...buildSqlFirstRecallQuery({
        schema: this.schema,
        userId,
        query,
        limit,
      }));
      return { data: result.rows, error: null };
    } catch (error) {
      return { data: [], error: normalizePgError(error) };
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
