SET search_path TO jobdone, public, extensions;

CREATE TABLE IF NOT EXISTS farm_datasets (
  farm_id       TEXT        NOT NULL,
  dataset_kind  TEXT        NOT NULL,
  payload       JSONB       NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by    TEXT,
  PRIMARY KEY (farm_id, dataset_kind)
);

CREATE INDEX IF NOT EXISTS farm_datasets_updated_at_idx
  ON farm_datasets(updated_at DESC);

ALTER TABLE farm_datasets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'jobdone'
      AND tablename = 'farm_datasets'
      AND policyname = 'deny_all_direct_access'
  ) THEN
    CREATE POLICY deny_all_direct_access
      ON jobdone.farm_datasets
      FOR ALL
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'jobdone'
      AND tablename = 'farm_datasets'
      AND policyname = 'backend_direct_access'
  ) THEN
    CREATE POLICY backend_direct_access
      ON jobdone.farm_datasets
      FOR ALL
      TO jobdone_backend
      USING (true)
      WITH CHECK (true);
  END IF;
END;
$$;

REVOKE ALL ON farm_datasets FROM PUBLIC, anon, authenticated;
GRANT ALL ON farm_datasets TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON farm_datasets TO jobdone_backend;
