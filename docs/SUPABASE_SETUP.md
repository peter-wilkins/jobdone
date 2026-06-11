# Supabase Setup for JobDone

This guide walks through setting up Supabase Auth plus direct Postgres cloud
storage and sync.

## 1. Create a Supabase Project

1. Go to https://supabase.com
2. Sign up / log in
3. Click "New Project"
4. Choose a name, password, region
5. Wait for it to provision (~2 min)

## 2. Create the JobDone schema

Apply the checked-in disposable schema with the shared Supabase pooler URL from
`~/.profile`:

```bash
. ~/.profile
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f docs/schema.sql
```

This is the same schema-per-prototype workflow used by Continuum.

Manual dashboard fallback:

1. Go to **SQL Editor** (left sidebar)
2. Click **New Query**
3. Paste the schema from [schema.sql](./schema.sql)
4. Click **Run**
5. Should see "Success" message

The SQL creates a dedicated `jobdone` schema for app tables and functions.
JobDone app data uses direct Postgres via the pooler URL, so the Supabase
REST/Data API does not need to expose the `jobdone` schema.

## 3. Get Your Credentials

For login, go to **Settings** → **API** and copy:
   - **Project URL** → `SUPABASE_URL`
   - **anon public** key → `SUPABASE_KEY`

For app data, use the Supabase pooler connection string from `~/.profile`:

- `SUPABASE_DB_URL`

Example:
```
SUPABASE_URL=https://abcdef123456.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_DB_URL=postgresql://postgres.project-ref:password@aws-0-region.pooler.supabase.com:5432/postgres
```

## 4. Add to Backend

```bash
cd backend
cat >> .env << 'EOF'
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=eyJhbG...
SUPABASE_DB_URL=postgresql://postgres.project-ref:password@aws-0-region.pooler.supabase.com:5432/postgres
# Local Replica DB.
LOCAL_REPLICA_DB_URL=$SUPABASE_DB_URL
LOCAL_REPLICA_SCHEMA=jobdone
EOF
```

## 6. Test Connection

```bash
npm run dev
```

You should see:
```
🚀 JobDone server running at http://localhost:3000
```

No error about Postgres means cloud sync is connected.

## 7. Wire Frontend to Sync

Once backend is set up, frontend will:
1. Record audio locally
2. Get transcript + summary
3. On Confirmation, queue a Local Replica Sync Intent
4. Push/pull through `/api/local-replica/*`
5. Materialize accepted Sync Objects back into IndexedDB

## What's Stored

JobDone stores syncable app data through Local Replica tables:

- `syncObjects`
- `syncIntents`
- `syncTransactions`
- `syncOwnerAccess`

Each sync object contains owner scope, collection, Server T fields, tombstone
fields, codec/encryption metadata, and the typed collection payload.

## Querying Jobs

Via Supabase dashboard:
1. **Table Editor** → choose the `jobdone` schema
2. Click `syncObjects`
3. See all your data
4. Filter by `collection = 'entries'`

Via SQL:

```bash
. ~/.profile
psql "$SUPABASE_DB_URL" -c "select id, \"payloadJson\"->>'text', \"createdAt\" from jobdone.\"syncObjects\" where collection = 'entries' order by \"createdT\" desc limit 10;"
```
