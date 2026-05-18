# Tags, Locations, and Contacts are Entry structure

JobDone uses Locations, Contacts, and Tags as the primary retrieval structure for Entries, while Entry content remains narrative memory. Filterable operational structure such as materials, labour time, follow-ups, possible future work, invoicing status, and similar workflow flags should be represented as Tags or Tag Categories rather than dedicated Entry columns.

## Considered Options

- **Dedicated columns for extracted workflow fields** — rejected because it makes the product drift toward job-management/accounting/task software and hard-codes one vertical's taxonomy into the core Entry model.
- **One generic tags table for everything** — rejected because Locations and Contacts refer to real-world things with identity, evidence, and deduplication needs beyond a string label.
- **Separate Task/Reminder model** — rejected for MVP because reminder-like workflows can be Recall/query views over Entries.

## Consequences

The AI prediction flow builds a bounded Prediction Candidate Set from Context Clues, domain template Tags, and the user's Tag Vocabulary. Locations and Contacts use the same pill/filter UX as Tags but remain separate entities underneath. Confirmed associations are immutable in MVP; corrections are made by submitting a new Entry.
