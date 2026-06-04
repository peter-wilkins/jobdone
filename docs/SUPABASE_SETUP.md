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
# Optional; defaults to jobdone
SUPABASE_DB_SCHEMA=jobdone
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
3. On confirm, POST to `/api/sync/save` with the job data
4. Entry saves to Supabase cloud

## What's Stored

JobDone stores app data in the `jobdone` schema:

- `entries`
- `context_clues`
- `locations`
- `contacts`
- `tag_categories`, `tags`, `tag_vocabulary`
- `entry_locations`, `entry_contacts`, `entry_tags`
- `queries`
- `feedback`

Each Entry record contains:
- `user_id` — authenticated Supabase user id
- `transcript` — raw audio transcription
- `summary` — Claude-generated summary
- `created_at` — when the job was logged
- `synced_at` — when it was saved to cloud

## Querying Jobs

Via Supabase dashboard:
1. **Table Editor** → choose schema `jobdone`
2. Click `entries`
3. See all your data
4. Filter by user_id to see specific user's jobs

Via SQL:

```bash
. ~/.profile
psql "$SUPABASE_DB_URL" -c "select id, summary, created_at from jobdone.entries order by created_at desc limit 10;"
```

## Next: Frontend Sync Integration

See `/frontend/README.md` for wiring the frontend to call `/api/sync/save` when confirming jobs.
