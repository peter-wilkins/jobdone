-- Least-privilege DB role for the JobDone backend.
--
-- Passwords are environment-specific and must not be checked in. This migration
-- creates the role and grants only the JobDone schema access the backend needs.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jobdone_backend') THEN
    CREATE ROLE jobdone_backend NOLOGIN;
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA extensions TO jobdone_backend;
GRANT USAGE ON SCHEMA jobdone TO jobdone_backend;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA jobdone TO jobdone_backend;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA jobdone TO jobdone_backend;

ALTER DEFAULT PRIVILEGES IN SCHEMA jobdone
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO jobdone_backend;

ALTER DEFAULT PRIVILEGES IN SCHEMA jobdone
  GRANT EXECUTE ON FUNCTIONS TO jobdone_backend;

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
      'DROP POLICY IF EXISTS %I ON %I.%I',
      'backend_direct_access',
      'jobdone',
      table_record.tablename
    );

    EXECUTE format(
      'CREATE POLICY %I ON %I.%I FOR ALL TO %I USING (true) WITH CHECK (true)',
      'backend_direct_access',
      'jobdone',
      table_record.tablename,
      'jobdone_backend'
    );
  END LOOP;
END;
$$;
