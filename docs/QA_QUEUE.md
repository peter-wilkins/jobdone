# QA Queue

Open QA tasks the user has not yet confirmed as complete.

1. [ ] On production build `a3b164d` or newer, record silence or a very quiet clip and confirm the failed card says `No speech detected. Try recording again.` with `Dismiss`, not `Retry processing`.
2. [ ] Record a normal spoken Entry in production and confirm it still processes to review.
3. [ ] After the silent-recording check, inspect backend production error logs and confirm the empty transcription case is not reported as an error-level log.
