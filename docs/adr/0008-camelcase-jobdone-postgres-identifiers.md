# JobDone-owned PostgreSQL identifiers use camelCase

JobDone-owned tables and columns in the `jobdone` schema use camelCase identifiers to match the frontend, API, and Local Replica data shape end-to-end. This deliberately trades the usual Postgres snake_case convention for fewer mapping layers and fewer sync bugs while JobDone is still in MVP mode and staging data is disposable. Checked-in SQL must double-quote mixed-case identifiers; external/provider-owned schemas are not covered by this rule.

Sync tables should use canonical contract names directly: `userId`, `teamId`, `entryId`, `createdAt`, `createdT`, `changedAt`, `changedT`, `deletedAt`, and `deletedT`. Snake_case in JobDone-owned sync tables should fail schema conformance checks unless a specific backend-only exception has been documented.

The intended allowlist is deliberately tiny. Postgres role names such as `jobdone_backend`, extension-owned objects, and provider schemas are outside the app data contract. JobDone-owned tables, columns, indexes, and functions should otherwise prefer canonical camelCase names, even where Postgres convention would normally use snake_case.

## Consequences

Repository and migration code should not introduce snake_case/camelCase adapters for JobDone-owned data. SQL is a boundary where quoted camelCase is expected, while Supabase/Auth/provider payloads may still need explicit adapters.
