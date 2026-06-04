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

When `QA_BASE_URL` is unset, Playwright starts JobDone's Vite dev server on
`127.0.0.1:5174` by default. Set `QA_PORT` if that port is busy.

Run against production:

```bash
QA_BASE_URL=https://jobdone-production.vercel.app npm --prefix frontend run qa:smoke
```

The config uses installed Google Chrome by default because this lab machine's
current Linux release is ahead of Playwright's managed Chromium support. Set
`QA_BROWSER_CHANNEL` if you want a different installed browser channel.

Some restricted agent sandboxes cannot launch Chrome because crashpad/socket
setup is blocked. In that case, treat the smoke command as a manual/local
release check rather than a blocker for the code change.

The current smoke tests cover anonymous app load and anonymous feedback submit.
They intentionally avoid login.

QA runs are text-first: assertions, request payloads, logs, and feedback records.
Screenshots, videos, traces, and HTML reports are disabled by default because
they create noisy artifacts that are unlikely to be reviewed during MVP.

QA tests enable `jobdone-debug-logs` before app load and should assert the happy
path emitted the expected `[JobDone debug]` console logs. Normal production
sessions stay quiet unless that debug flag is explicitly set. Local smoke tests
may stub backend writes; production smoke with `QA_BASE_URL` set should hit the
real backend.

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
