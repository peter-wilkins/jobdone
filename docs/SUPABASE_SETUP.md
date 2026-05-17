# Supabase Setup for JobDone

This guide walks through setting up Supabase for cloud storage and sync.

## 1. Create a Supabase Project

1. Go to https://supabase.com
2. Sign up / log in
3. Click "New Project"
4. Choose a name, password, region
5. Wait for it to provision (~2 min)

## 2. Create the Jobs Table

In the Supabase dashboard:

1. Go to **SQL Editor** (left sidebar)
2. Click **New Query**
3. Paste the schema from [docs/schema.sql](./schema.sql)

4. Click **Run**
5. Should see "Success" message

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
EOF
```

## 5. Test Connection

```bash
npm run dev
```

You should see:
```
🚀 JobDone server running at http://localhost:3000
```

No error about Supabase means it's connected.

## 6. Wire Frontend to Sync

Once backend is set up, frontend will:
1. Record audio locally
2. Get transcript + summary
3. On confirm, POST to `/api/sync/save` with the job data
4. Job saves to Supabase cloud

## What's Stored

Each job record contains:
- `user_id` — anonymous session ID or authenticated user
- `transcript` — raw audio transcription
- `summary` — Claude-generated summary
- `materials` — array of materials used
- `labour_minutes` — time spent (or null)
- `follow_ups` — array of follow-up tasks
- `possible_future_work` — text about future opportunities
- `created_at` — when the job was logged
- `synced_at` — when it was saved to cloud

## Querying Jobs

Via Supabase dashboard:
1. **Table Editor** → Click `jobs`
2. See all your data
3. Filter by user_id to see specific user's jobs

Via API:
```bash
curl "https://your-project.supabase.co/rest/v1/jobs?user_id=eq.anon-123" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

## Next: Frontend Sync Integration

See `/frontend/README.md` for wiring the frontend to call `/api/sync/save` when confirming jobs.
