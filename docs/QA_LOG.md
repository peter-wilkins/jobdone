# QA Log

Complete history of user-facing QA actions. Keep entries even after they are
confirmed so this file can later seed automated tests and pre-launch audit work.

## 2026-05-18 - Issue #39 / commit `a3b164d`

Status: passed by user on 2026-05-18.

1. On production build `a3b164d` or newer, record silence or a very quiet clip and confirm the failed card says `No speech detected. Try recording again.` with `Dismiss`, not `Retry processing`.
2. Record a normal spoken Entry in production and confirm it still processes to review.
3. After the silent-recording check, inspect backend production error logs and confirm the empty transcription case is not reported as an error-level log.

## 2026-05-18 - Issue #37 / report issue diagnostics

Status: passed by user on 2026-05-18.

1. Run the updated `docs/schema.sql` in Supabase before relying on cloud persistence of diagnostic bundles.
2. Open production on the latest build, use Menu -> `Report issue`, type a short issue, and confirm the report preview shows build, screen, backend status, device, recent app events, and excluded private data.
3. Send the typed report while logged in and confirm it appears under `Sent reports`.
4. Record a voice issue report and confirm it transcribes to review, shows the same diagnostic preview, and can be sent or discarded.
5. Confirm the diagnostic preview does not include Entry content, unrelated transcripts, Contact details, shared payload bodies, or audio blobs.
