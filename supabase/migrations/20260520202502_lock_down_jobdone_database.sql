-- Lock down JobDone's private schema.
--
-- The app uses direct Postgres from the backend. Browser-facing Supabase roles
-- should not have direct table/function access to JobDone data.

DO $$
DECLARE
  policy_record RECORD;
BEGIN
  FOR policy_record IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'jobdone'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
  END LOOP;
END;
$$;

DO $$
DECLARE
  table_record RECORD;
BEGIN
  FOR table_record IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'jobdone'
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I.%I FOR ALL USING (false) WITH CHECK (false)',
      'deny_all_direct_access',
      'jobdone',
      table_record.tablename
    );
  END LOOP;
END;
$$;

REVOKE ALL ON SCHEMA jobdone FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA jobdone TO service_role;

REVOKE ALL ON ALL TABLES IN SCHEMA jobdone FROM PUBLIC, anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA jobdone TO service_role;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA jobdone FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA jobdone TO service_role;

ALTER FUNCTION jobdone.increment_tag_vocabulary(TEXT, UUID)
  SET search_path = jobdone, extensions, public;

ALTER FUNCTION jobdone.match_entries(TEXT, extensions.vector(1024), INT, DOUBLE PRECISION)
  SET search_path = jobdone, extensions, public;

CREATE INDEX IF NOT EXISTS tag_vocabulary_tag_id_idx ON jobdone.tag_vocabulary(tag_id);
