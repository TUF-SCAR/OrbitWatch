-- Explicit historical archive pilot migration; never run during API startup.
BEGIN;
CREATE TABLE IF NOT EXISTS satellite_historical_elements (
    record_id varchar(64) PRIMARY KEY,
    norad_id integer NOT NULL CHECK (norad_id IN (25544,20580,48274,39084,25867,25994,27424,39634,40697,43435,41866,41752,26407,40544,44057)),
    epoch timestamptz NOT NULL,
    object_name varchar(255) NOT NULL,
    object_id varchar(50) NOT NULL,
    launch_date date,
    decay_date date,
    source varchar(40) NOT NULL,
    source_record_id varchar(80),
    element_format varchar(4) NOT NULL CHECK (element_format IN ('OMM','TLE')),
    elements json NOT NULL,
    imported_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_historical_norad_epoch ON satellite_historical_elements (norad_id, epoch);
-- Browser clients use the protected FastAPI API; no Supabase client policies.
ALTER TABLE satellite_historical_elements ENABLE ROW LEVEL SECURITY;
COMMIT;
