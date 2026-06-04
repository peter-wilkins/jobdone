# JobDone Frontend

React + Vite PWA for JobDone's mobile-first capture, review, Timeline, Recall,
Inbox, Contacts, Locations, login, and share-target flows.

## Source Of Truth

- [../README.md](../README.md) - repo overview, common commands, deployment.
- [../CONTEXT.md](../CONTEXT.md) - product language, domain model, platform rules.
- [../docs/adr](../docs/adr) - architecture decisions.
- [../AGENTS.md](../AGENTS.md) - repo workflow rules for agents.

Keep this file brief. Update `CONTEXT.md` or an ADR first when product behavior,
domain language, data ownership, or platform strategy changes.

## Run

```bash
npm install
npm run dev
```

The app runs at `http://localhost:5173`. It defaults to backend
`http://localhost:3000`; set `VITE_API_URL` in `.env.local` when needed.

## Commands

```bash
npm run lint
npm run build
npm run test
npm run preview
```

## Deployment

Frontend deploys through Vercel from `frontend/`. From repo root:

```bash
vercel --cwd frontend build --prod
vercel --cwd frontend deploy --prod --prebuilt --yes
```

Then verify the live build id at `https://jobdone-frontend-production.vercel.app/`.
