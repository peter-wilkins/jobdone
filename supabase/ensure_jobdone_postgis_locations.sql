CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
ALTER EXTENSION postgis SET SCHEMA extensions;

ALTER TABLE jobdone.locations
  ADD COLUMN IF NOT EXISTS geo extensions.geography(Point, 4326),
  ADD COLUMN IF NOT EXISTS "accuracyMeters" DOUBLE PRECISION;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'jobdone'
      AND table_name = 'locations'
      AND column_name = 'latitude'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'jobdone'
      AND table_name = 'locations'
      AND column_name = 'longitude'
  ) THEN
    UPDATE jobdone.locations
    SET geo = extensions.ST_SetSRID(extensions.ST_MakePoint(longitude, latitude), 4326)::extensions.geography
    WHERE geo IS NULL
      AND latitude IS NOT NULL
      AND longitude IS NOT NULL
      AND latitude BETWEEN -90 AND 90
      AND longitude BETWEEN -180 AND 180;
  END IF;
END;
$$;

DROP INDEX IF EXISTS jobdone.locations_geo_gist_idx;
CREATE INDEX locations_geo_gist_idx ON jobdone.locations USING GIST (geo);

ALTER TABLE jobdone.locations
  DROP COLUMN IF EXISTS latitude,
  DROP COLUMN IF EXISTS longitude;
