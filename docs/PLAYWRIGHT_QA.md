# Playwright QA

This is a small disposable QA surface, not the permanent production test suite.

Keep it tiny:

- `frontend/qa/smoke/` should have one or two release smoke tests.
- Do not build page-object frameworks or broad acceptance coverage here.
- Run smoke tests before production releases, when requested, or when a change
  touches multiple core flows.
- Do not run them for every small change by default.

## Release Smoke

Run against a local frontend:

```bash
npm --prefix frontend run qa:smoke
```

Run against production:

```bash
QA_BASE_URL=https://frontend-jobdone1.vercel.app npm --prefix frontend run qa:smoke
```

The config uses installed Google Chrome by default because this lab machine's
current Linux release is ahead of Playwright's managed Chromium support. Set
`QA_BROWSER_CHANNEL` if you want a different installed browser channel.

Some restricted agent sandboxes cannot launch Chrome because crashpad/socket
setup is blocked. In that case, treat the smoke command as a manual/local
release check rather than a blocker for the code change.

The current smoke tests cover anonymous app load and anonymous feedback submit.
They intentionally avoid login.

## Disposable Feature Spikes

For fresh feature work, agents may add a focused Playwright spike under:

```text
frontend/qa/spikes/
```

Rules:

- Write only the smallest end-to-end check for the feature just changed.
- Use it while the implementation is fresh.
- If it starts failing because the product moved on, disable or delete it rather
  than maintaining it forever.
- If disabled, leave a short note in this doc or the issue describing what it
  used to cover, so it can inform the future production suite.

Run current spikes explicitly:

```bash
npm --prefix frontend run qa:spikes
```

Current spikes:

- `crash-report-spike.spec.js` seeds a pending crash report, verifies the app
  auto-posts it to `/api/crash-reports`, checks the red status bar appears, and
  checks the sent diagnostic excludes private storage/auth dumps.

When JobDone exits MVP mode, replace these disposable spikes with a deliberate
stable acceptance suite.
