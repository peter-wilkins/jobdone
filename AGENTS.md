## Agent skills

### Issue tracker

Issues live in GitHub Issues (`peter-wilkins/jobdone`). See `docs/agents/issue-tracker.md`.

Before closing an issue, reconcile it with what actually shipped: update stale
titles/bodies/acceptance criteria, check off completed criteria, record notable
implementation notes or deviations, then close it as completed.

### Triage labels

Default label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo — one `CONTEXT.md` and `docs/adr/` at the root. See `docs/agents/domain.md`.

### Frontend deployment

When changing the frontend, build and lint it, commit if the build is fine, then
deploy the frontend to production by default. Use the safe Vercel sequence:
`vercel --cwd frontend build --prod` followed by
`vercel --cwd frontend deploy --prod --prebuilt --yes`, then verify the live
build id from `https://frontend-jobdone1.vercel.app/`.
