## Agent skills

### Before implementation

Always check `git status --short` before starting implementation work. If the
tree is dirty, stop and confirm with the user before changing files. The user
prefers everything committed before new implementation work starts.

### Scope control

If the user starts a side quest while a feature is in progress, challenge the
scope shift. Prefer capturing the side quest as one or more GitHub issues, then
return to the current feature unless the user explicitly reprioritizes.

### Issue tracker

Issues live in GitHub Issues (`peter-wilkins/jobdone`). See `docs/agents/issue-tracker.md`.

Before closing an issue, reconcile it with what actually shipped: update stale
titles/bodies/acceptance criteria, check off completed criteria, record notable
implementation notes or deviations, then close it as completed.

After implementing an issue, tell the user what QA actions they should take to
confirm the shipped behavior. Keep the QA list practical and specific to the
issue, including any database/schema steps, device/PWA checks, or production
smoke tests that cannot be fully verified by automated checks.

When there are QA actions for the user, make them hard to miss: trigger a local
terminal bell if available and clearly label the final section `QA actions`.
Do not save QA queue state to the repo or GitHub. Send QA actions to ntfy
instead, using `NTFY_TOPIC` or `NTFY_URL` from the local environment. Only say
the notification was sent if the ntfy request actually succeeded. If ntfy is not
configured or fails, say so and include the QA actions in the final response.

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
