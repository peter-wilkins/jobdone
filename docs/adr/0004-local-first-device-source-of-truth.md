# Local IndexedDB is the device source of truth

JobDone treats local IndexedDB as the source of truth for the current device experience, with Supabase acting as a sync replica for cross-device continuity. This was chosen over server-first persistence because the product must keep capture, review, and confirmed Timeline access usable on job sites with poor signal.

## Consequences

A confirmed Entry exists locally immediately and syncs later. New devices seed their local Timeline from Supabase, but the server does not edit immutable Entries after Confirmation.
