# JobDone-owned PostgreSQL identifiers use camelCase

JobDone-owned tables and columns in the `jobdone` schema use camelCase identifiers to match the frontend, API, and Local Replica data shape end-to-end. This deliberately trades the usual Postgres snake_case convention for fewer mapping layers and fewer sync bugs while JobDone is still in MVP mode and staging data is disposable. Checked-in SQL must double-quote mixed-case identifiers; external/provider-owned schemas are not covered by this rule.

## Consequences

Repository and migration code should not introduce snake_case/camelCase adapters for JobDone-owned data. SQL is a boundary where quoted camelCase is expected, while Supabase/Auth/provider payloads may still need explicit adapters.
