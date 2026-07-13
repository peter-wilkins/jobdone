# JobDone Backend

Fastify API for JobDone cloud sync, Recall, query history, feedback, structure
prediction, and location lookup.

## Source Of Truth

- [../README.md](../README.md) - repo overview, common commands, deployment.
- [../CONTEXT.md](../CONTEXT.md) - product language, domain model, platform rules.
- [../docs/schema.sql](../docs/schema.sql) - current Supabase schema.
- [../docs/adr](../docs/adr) - architecture decisions.
- [../AGENTS.md](../AGENTS.md) - repo workflow rules for agents.

Keep this file brief. Update `CONTEXT.md`, `docs/schema.sql`, or an ADR first
when product behavior, data ownership, schema, or platform strategy changes.

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

Server runs at `http://localhost:3000`.

Use `USE_MOCK_APIS=true` in `.env` for local/demo runs without external API
calls.

## Environment

```text
VOYAGE_API_KEY
OPENAI_API_KEY
SHINY_IMAGE_PROVIDER
SHINY_IMAGE_MODEL
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
SUPABASE_URL
SUPABASE_KEY
SUPABASE_DB_URL
USE_MOCK_APIS
```

`SHINY_IMAGE_PROVIDER` defaults to `openai`. Use `local-emboss-filter` for a
fast deterministic embossed preview. Use `cloudflare-flux-2-dev` or
`cloudflare-sd15-img2img` with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`
to test Workers AI image generation.

`SUPABASE_URL`/`SUPABASE_KEY` are for Supabase Auth. App data uses direct
Postgres via `SUPABASE_DB_URL`; it does not require Supabase REST/Data API
schemas.

## Commands

```bash
npm run dev
npm start
npm test
```

## Key Endpoints

- `GET /health`
- `POST /api/sync/save`
- `GET /api/sync/entries`
- `POST /api/queries`
- `POST /api/feedback/save`
- `POST /api/crash-reports`
- `GET /api/feedback/triage`
- `POST /api/feedback/triage/:id/issue-draft`
- `POST /api/structure/predict`
- `GET /api/locations/lookup`

## Deployment

Backend deploys through Vercel from `backend/`. From repo root:

```bash
vercel --cwd backend build --prod
vercel --cwd backend deploy --prod --prebuilt --yes
```

Backend health: `https://jobdone-gamma.vercel.app/health`.
