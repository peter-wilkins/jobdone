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

## 2026-05-18 - Issue #28 / Locations

Status: pending user confirmation.

1. Run the updated `docs/schema.sql` in Supabase before relying on cloud sync for Locations.
2. On production build for this issue or newer, create a normal note, enter a Location on the review screen, confirm it, and check the Timeline card shows the Location pill.
3. Create a normal note with the Location field left blank, confirm it, and check the Entry still appears and syncs normally.
4. While logged in, create an Entry with a Location on one device, then open another logged-in device and confirm the Entry and Location pill appear after sync.
5. Confirm existing Entries created before Locations still appear in Timeline and Recall without errors.

## 2026-05-18 - Confirm-time sync indicator regression

Status: passed by user on 2026-05-18.

1. On production build for this fix or newer, create and confirm a normal Entry while logged in.
2. Confirm the Timeline card changes to the cloud icon immediately after confirm without requiring a reload.
3. Refresh the app and confirm the same Entry still shows the cloud icon.
