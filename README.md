# JobDone

JobDone is a mobile-first, local-first voice log for self-employed tradespeople.
It captures what happened on a job, turns it into a confirmed Timeline Entry,
and uses Locations, Contacts, Tags, and Recall to surface operational memory
when it is needed.

## Source Of Truth

- [CONTEXT.md](./CONTEXT.md) — product language, domain model, current behaviour, and platform decisions.
- [docs/adr](./docs/adr) — architectural decisions and tradeoffs.
- [docs/schema.sql](./docs/schema.sql) — clean Supabase schema for the current cloud sync model.
- [AGENTS.md](./AGENTS.md) — repo-specific agent workflow rules.
- [docs/agents](./docs/agents) — issue tracker, triage labels, and domain-doc conventions for agents.

Keep the README short. If product behaviour, data ownership, platform strategy,
or domain language changes, update `CONTEXT.md` or an ADR first and link from
here only when needed.

## Current Shape

- Frontend: React + Vite PWA in [frontend](./frontend).
- Backend: Fastify API in [backend](./backend).
- Local data: IndexedDB is the current-device source of truth.
- Cloud sync: Supabase is the cross-device sync replica.
- Audio: Deepgram transcription and Claude summarisation/classification support.
- Recall: Entry summaries are embedded with Voyage AI and searched through Supabase/pgvector.
- Deploy target: Vercel frontend and backend projects.

For the exact domain rules, see [CONTEXT.md](./CONTEXT.md). In particular:

- Captures stay local until Confirmation.
- Confirmed Entries are immutable.
- Locations, Contacts, and Tags are first-class Entry structure.
- Foreground app-open retry is the canonical sync mechanism.
- Android Chrome is the primary PWA/share-target platform for now.

## Development

Install dependencies per workspace:

```bash
npm --prefix frontend install
npm --prefix backend install
```

Run the frontend:

```bash
npm --prefix frontend run dev
```

Run the backend:

```bash
npm --prefix backend run dev
```

The frontend defaults to `http://localhost:3000` for the backend. Set
`VITE_API_URL` in `frontend/.env.local` if needed.

Backend environment variables for real API usage:

```text
DEEPGRAM_API_KEY
ANTHROPIC_API_KEY
VOYAGE_API_KEY
SUPABASE_URL
SUPABASE_KEY
```

Use `USE_MOCK_APIS=true` in `backend/.env` for mock transcription,
summarisation, and embeddings during local development.

## Common Commands

```bash
npm run build:frontend
npm run test:backend
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix backend test
npm run logs:backend -- --level error --since 2h
```

## Deployment

Production deploy scripts live at the repo root:

```bash
npm run deploy:backend
npm run deploy:frontend
npm run deploy:prod
```

These scripts run `vercel build --prod` before
`vercel deploy --prebuilt --prod --yes`. Do not run a prebuilt deploy from stale
`.vercel/output`.

Frontend changes should be deployed with:

```bash
vercel --cwd frontend build --prod
vercel --cwd frontend deploy --prod --prebuilt --yes
```

Then verify the live build id at:

```bash
curl -L https://frontend-jobdone1.vercel.app/
```

Backend health:

```bash
curl -L https://jobdone-gamma.vercel.app/health
```
