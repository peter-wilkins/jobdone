-- Keep pgvector out of the exposed public schema.

CREATE SCHEMA IF NOT EXISTS extensions;

ALTER EXTENSION vector SET SCHEMA extensions;

ALTER FUNCTION jobdone.match_entries(TEXT, extensions.vector(1024), INT, DOUBLE PRECISION)
  SET search_path = jobdone, extensions, public;
