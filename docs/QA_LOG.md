# QA Log

Complete history of user-facing QA actions. Keep entries even after they are
confirmed so this file can later seed automated tests and pre-launch audit work.

## 2026-05-18 - Issue #39 / commit `a3b164d`

Status: pending user confirmation.

1. On production build `a3b164d` or newer, record silence or a very quiet clip and confirm the failed card says `No speech detected. Try recording again.` with `Dismiss`, not `Retry processing`.
2. Record a normal spoken Entry in production and confirm it still processes to review.
3. After the silent-recording check, inspect backend production error logs and confirm the empty transcription case is not reported as an error-level log.
