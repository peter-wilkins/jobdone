-- Expose JobDone's schema through Supabase PostgREST/Data API.
-- Keep shared MVP schemas visible; do not move JobDone tables back to public.

ALTER ROLE authenticator
  SET pgrst.db_schemas = 'public,storage,graphql_public,continuum,jobdone';

NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
