# QA Queue

Open QA tasks the user has not yet confirmed as complete.

1. [x] Run updated `docs/schema.sql` in Supabase; the previous `cannot change return type of existing function` error should be gone.
2. [ ] Create and confirm a normal Entry in production and verify sync still works.
   - One phone works.
   - One phone fails constantly during processing; diagnose before marking complete.
3. [ ] Log in on another device and confirm Entries still load.
4. [ ] Check production frontend shows build `3baab01` or newer.
5. [ ] Watch for any sync error mentioning `context_clues`.
