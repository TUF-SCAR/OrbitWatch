-- Explicit account foundation migration. Never invoked by application startup.
-- Review/apply with the backend's database role, not a public browser role.
BEGIN;
CREATE TABLE IF NOT EXISTS account_observation_locations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slot smallint NOT NULL,
    name varchar(80) NOT NULL,
    latitude numeric(9,6) NOT NULL,
    longitude numeric(10,6) NOT NULL,
    timezone varchar(64) NOT NULL,
    is_default boolean NOT NULL DEFAULT false,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_account_location_slot CHECK (slot BETWEEN 1 AND 5),
    CONSTRAINT ck_account_location_coordinates CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180),
    CONSTRAINT ck_account_location_text CHECK (length(name) BETWEEN 1 AND 80 AND length(timezone) BETWEEN 1 AND 64),
    CONSTRAINT ck_account_location_version CHECK (version > 0),
    CONSTRAINT uq_account_location_slot UNIQUE (owner_id, slot),
    CONSTRAINT uq_account_location_coordinates UNIQUE (owner_id, latitude, longitude)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_location_default ON account_observation_locations(owner_id) WHERE is_default;

CREATE TABLE IF NOT EXISTS account_notification_preferences (
    owner_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    notifications_enabled boolean NOT NULL DEFAULT false,
    satellite_alerts boolean NOT NULL DEFAULT false,
    celestial_alerts boolean NOT NULL DEFAULT false,
    natural_event_alerts boolean NOT NULL DEFAULT false,
    advance_warning_minutes smallint NOT NULL DEFAULT 30,
    event_radius_km smallint NOT NULL DEFAULT 100,
    quiet_hours_enabled boolean NOT NULL DEFAULT false,
    quiet_start time,
    quiet_end time,
    quiet_timezone_mode varchar(16) NOT NULL DEFAULT 'default_location',
    quiet_timezone varchar(64),
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_account_warning CHECK (advance_warning_minutes IN (10,30,60)),
    CONSTRAINT ck_account_radius CHECK (event_radius_km BETWEEN 1 AND 2000),
    CONSTRAINT ck_account_quiet_source CHECK (quiet_timezone_mode IN ('default_location','explicit')),
    CONSTRAINT ck_account_quiet_timezone CHECK (NOT quiet_hours_enabled OR quiet_timezone_mode <> 'explicit' OR (quiet_timezone IS NOT NULL AND length(quiet_timezone) BETWEEN 1 AND 64)),
    CONSTRAINT ck_account_quiet_hours CHECK (NOT quiet_hours_enabled OR (quiet_start IS NOT NULL AND quiet_end IS NOT NULL AND quiet_start <> quiet_end)),
    CONSTRAINT ck_account_preferences_version CHECK (version > 0)
);
-- Private API access only, following migration 001. No browser-client policies.
ALTER TABLE account_observation_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_notification_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_observation_locations, account_notification_preferences FROM PUBLIC;
COMMIT;
