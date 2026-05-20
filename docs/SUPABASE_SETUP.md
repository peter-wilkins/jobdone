# Supabase Setup for JobDone

This guide walks through setting up Supabase for cloud storage and sync.

## 1. Create a Supabase Project

1. Go to https://supabase.com
2. Sign up / log in
3. Click "New Project"
4. Choose a name, password, region
5. Wait for it to provision (~2 min)

## 2. Create the JobDone schema

Apply the checked-in migration with the shared Supabase pooler URL from
`~/.profile`:

```bash
. ~/.profile
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260520123000_create_jobdone_schema.sql
```

This is the same schema-per-prototype workflow used by Continuum.

Manual dashboard fallback:

1. Go to **SQL Editor** (left sidebar)
2. Click **New Query**
3. Paste the migration from [../supabase/migrations/20260520123000_create_jobdone_schema.sql](../supabase/migrations/20260520123000_create_jobdone_schema.sql)
4. Click **Run**
5. Should see "Success" message

The SQL creates a dedicated `jobdone` schema for app tables and functions.
Expose that schema to the API:

1. Go to **Settings** → **API**
2. Add `jobdone` to **Exposed schemas**
3. Keep `public` exposed if Supabase requires it for project defaults

## 3. Get Your Credentials

1. Go to **Settings** → **API**
2. Copy these:
   - **Project URL** → `SUPABASE_URL`
   - **anon public** key → `SUPABASE_KEY`

Example:
```
SUPABASE_URL=https://abcdef123456.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## 4. Add to Backend

```bash
cd backend
cat >> .env << 'EOF'
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=eyJhbG...
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

No error about Supabase means it's connected.

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

Via API:
```bash
curl "https://your-project.supabase.co/rest/v1/entries?user_id=eq.USER_ID" \
  -H "Accept-Profile: jobdone" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

## Next: Frontend Sync Integration

See `/frontend/README.md` for wiring the frontend to call `/api/sync/save` when confirming jobs.
