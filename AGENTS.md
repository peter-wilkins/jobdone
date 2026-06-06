## Agent skills

### Before implementation

Always check `git status --short` before starting implementation work. If the
tree is dirty, stop and confirm with the user before changing files. The user
prefers everything committed before new implementation work starts.

### Scope control

If the user starts a side quest while a feature is in progress, challenge the
scope shift. Prefer capturing the side quest as one or more GitHub issues, then
return to the current feature unless the user explicitly reprioritizes.

### Junior and senior agent roles

Junior/Spark agents should use the `junior-issue-worker` skill: work one issue
on a branch, open a draft PR, and stop. They must not approve, merge, deploy,
apply remote SQL, mutate production env vars, or close issues.

Approve-and-merge work should use the `senior-review-merge` skill and requires a
GPT-5.5 reviewer. If the current model is not GPT-5.5, or the model is unknown,
stop instead of approving or merging.

### Issue tracker

Issues live in GitHub Issues (`peter-wilkins/jobdone`). See `docs/agents/issue-tracker.md`.

Before closing an issue, reconcile it with what actually shipped: update stale
titles/bodies/acceptance criteria, check off completed criteria, record notable
implementation notes or deviations, then close it as completed.

After implementation, include a short `QA` section in the final response. Do not
maintain or repeat a long-running QA queue.

Always include:

- `Frontend-visible diff`: what should look or behave differently in the app, or
  `None`.
- `Automated checks run`: tests, builds, API smoke checks, database verification,
  targeted Playwright checks, or other checks actually run.
- `Suggested manual checks`: only the smallest useful set for the current
  change.

Do not run the full release/acceptance smoke suite for every change. Run it only
before production releases, when the user asks, or when a change touches multiple
core flows. Backend-only changes should prefer API/database smoke checks over
broad UI testing. Frontend-visible changes should include a targeted visual
spot-check when practical.

For UI errors, keep the message close to the action that triggered it. Button,
input, picker, lookup, and form-specific failures should render beside or just
below that control. Use page-level banners only for whole-screen conditions such
as initial load failure, stale/offline state, or broad sync/backend availability.

Playwright QA lives under `frontend/qa/` and is intentionally disposable during
MVP. Keep release smoke coverage to one or two tests. Feature-specific
end-to-end spike tests may be written while a change is fresh, but if they become
stale, disable or delete them rather than maintaining a brittle framework.

If the work needs a critical non-visual check that the agent cannot perform, such
as running new SQL, testing a PWA install/share target on a real device, or
checking another logged-in device, include it under `Suggested manual checks`.
Do not write these checks to `docs/QA_LOG.md` unless the user explicitly asks for
a historical QA audit log.

### Triage labels

Default label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo — one `CONTEXT.md` and `docs/adr/` at the root. See `docs/agents/domain.md`.
Keep MVP/process rules in `docs/MVP_RULES.md`; keep `CONTEXT.md` focused on the
JobDone domain model, product language, and durable platform decisions.

### Deployment gate

Production deploys should go through staging first:

```bash
npm run deploy:staging
npm run deploy:check:staging
npm run qa:staging
npm run deploy:promote
npm run deploy:check:production
```

`npm run deploy:release` runs that whole sequence. Do not promote to production
before staging Playwright smoke unless the user explicitly asks for an emergency
hotfix.
