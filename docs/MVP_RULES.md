# MVP Rules

JobDone is currently in MVP mode. These rules are engineering defaults for
moving quickly without confusing the product/domain model in `CONTEXT.md`.

## Goal

Maximise learning speed while keeping the core loop reliable:

```text
capture -> confirmation -> timeline -> recall -> feedback
```

Prefer small, testable changes over broad platform work.

## Data And Infrastructure

- Use the shared Supabase lab project for MVP prototypes.
- Keep JobDone-owned database objects in the `jobdone` PostgreSQL schema.
- Do not create JobDone app tables in `public`.
- App data uses direct Postgres via `SUPABASE_DB_URL`; do not depend on
  Supabase REST/Data API schema exposure.
- Supabase Auth is separate from app data access and may continue using the
  Supabase client.
- Use `docs/schema.sql` as the current disposable schema snapshot; do not keep
  migration history yet.
- Prototype data is disposable while explicitly in MVP mode.
- Destructive schema rewrites are acceptable when they keep the code and schema
  cleaner.
- Prefer one clean canonical payload shape over compatibility normalization.
  Old local drafts, stale IndexedDB rows, and disposable prototype data can be
  cleared while there are no real users.

When JobDone exits MVP mode, this flips: data preservation, careful migrations,
and backwards compatibility become mandatory.

## Product Defaults

- Build the core loop before settings, admin surfaces, onboarding, or polish.
- Keep logged-out and logged-in app behaviour as similar as practical; auth is
  mainly for identity linking and cross-device continuity.
- Preserve local-first behaviour. The current device should stay responsive even
  when network, backend, or sync is unavailable.
- Prefer foreground retry and simple recovery paths over background complexity.
- Do not silently discard user-entered or captured information.
- Until JobDone has real users, dogfooding/debug instrumentation may be enabled
  by default when it speeds learning. Move it behind explicit flags before
  public use.

## Testing Defaults

- Test on real mobile devices early, especially Android Chrome PWA flows.
- When testing on Peter's day-to-day phone, do not wipe the device, clear broad
  personal data, uninstall unrelated apps, or delete user content. Keep tests
  scoped to JobDone app data and ask before destructive device actions.
- Do not run the full release/acceptance smoke suite for every small change.
- Run targeted checks for the current change.
- Run broader release smoke checks before production releases, when explicitly
  requested, or when a change touches multiple core flows.
- Keep Playwright checks disposable during MVP; prefer one or two smoke tests and
  short-lived feature spikes over a large brittle suite.

## Agent Defaults

- Keep MVP/process rules here, not in `CONTEXT.md`.
- Keep product language and domain model in `CONTEXT.md`.
- Capture side quests as issues unless the user explicitly reprioritises.

## Change Workflow Modes

Use the lightest workflow that fits the risk:

- **Commit Directly**: work on `main`, make small bisectable commits, push, and
  deploy when needed. This is the default while JobDone is in MVP mode and has no
  users.
- **Feature PR**: use one ready-for-review PR for a coherent risky change, with
  small commits inside it. Do not make it draft once checks pass and it is ready
  for Peter to review.
- **Spike Draft PR**: use a draft PR for experiments, investigations, and
  branches that should not be reviewed or merged yet.

Branch protection and stricter review return when real users or durable data
make safety more important than speed.
