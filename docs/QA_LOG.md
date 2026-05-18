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

## 2026-05-18 - Issue #30 / Tags

Status: pending user confirmation.

1. Run the updated `docs/schema.sql` in Supabase before relying on cloud sync for Tags.
2. On production build for this issue or newer, create a normal note, enter comma-separated Tags on the review screen, confirm it, and check the Timeline card shows Tag pills.
3. Try an unsafe Tag such as `<script>` or a multi-line value and confirm the app blocks it before Confirmation.
4. Create a normal note with Tags left blank, confirm it, and check the Entry still appears and syncs normally.
5. While logged in, create an Entry with Tags on one device, then open another logged-in device and confirm the Entry and Tag pills appear after sync.

## 2026-05-18 - Tag prompt-injection validation

Status: passed by user on 2026-05-18.

1. On production build for this fix or newer, try to confirm an Entry with an unsafe Tag such as `<script>` and confirm the UI blocks it.
2. Try a multi-line Tag and confirm the UI blocks it.
3. Confirm a normal safe Tag such as `Boiler Service` still saves and syncs.

## 2026-05-18 - Issue #32 / Prediction Candidate Set pipeline

Status: pending user confirmation.

1. Create or reuse a production account with at least one confirmed Location, Contact, and Tag.
2. Confirm backend health is OK at `https://jobdone-gamma.vercel.app/health`.
3. After the next prediction-review UI slice, confirm review suggestions are bounded and separated into Location, Contact, and Tags rather than showing the whole vocabulary.

## 2026-05-18 - Issue #33 / Predicted structure review UX

Status: pending user confirmation.

1. On production build for this issue or newer, create a ready-for-review note while logged in and confirm Location and Contact appear as primary pills above Tags.
2. Confirm `+ Location` and `+ Contact` are visible when no prediction is selected, and that removing a selected pill does not block Confirmation.
3. Confirm predicted Tags appear grouped by category and the `+ Custom Tag` input is always visible without horizontal scrolling.
4. Confirm an Entry with no Location and no Contact still confirms successfully.
5. Confirm selected Location, Contact, and Tags display on the confirmed Timeline card and are not editable there.

## 2026-05-18 - Share Target direct route 404

Status: pending user confirmation.

1. On production build for this fix or newer, share a Contact from Android to JobDone and confirm the app opens the share review screen instead of browser 404.
2. Confirm the shared Contact can still be approved or rejected from the review screen.
3. Confirm opening `https://frontend-jobdone1.vercel.app/share-target?id=capture-test` returns the JobDone app shell, not a Vercel 404.

## 2026-05-18 - Local Contact prediction

Status: pending user confirmation.

1. On production build for this fix or newer, create or reuse a local Contact with a full display name.
2. Record a note that says the Contact's complete name and confirm the Contact pill is preselected on the review screen.
3. Remove the Contact pill and confirm the Entry can still be saved without a Contact.

## 2026-05-18 - Contact sync regression

Status: pending user confirmation.

1. On production build for this fix or newer, share a Contact from Android to JobDone while logged in and approve it.
2. Confirm the Contact remains in local Contacts after approval.
3. Reload or open JobDone on a second logged-in device and confirm the Contact appears after sync.
4. Confirm approving a Contact without phone/email details does not create duplicate local Contact rows or break subsequent sync.
