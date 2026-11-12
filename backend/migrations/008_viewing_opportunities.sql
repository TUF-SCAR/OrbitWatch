-- Additive; existing inbox, accounts and encrypted subscriptions remain intact.
BEGIN;
CREATE TABLE IF NOT EXISTS account_viewing_opportunities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), identity varchar(64) NOT NULL,
 owner_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 location_id uuid NOT NULL REFERENCES account_observation_locations(id) ON DELETE CASCADE,
 subscription_id uuid NOT NULL REFERENCES account_alert_subscriptions(id) ON DELETE CASCADE,
 kind varchar(12) NOT NULL CHECK(kind IN ('satellite','celestial')), target_id varchar(64) NOT NULL,
 source_key varchar(64) NOT NULL, location_version integer NOT NULL, preference_version integer NOT NULL,
 warning_minutes integer NOT NULL CHECK(warning_minutes IN(10,30,60)),
 start_at timestamptz NOT NULL, peak_at timestamptz NOT NULL, end_at timestamptz NOT NULL,
 advance_due_at timestamptz NOT NULL, visible_due_at timestamptz NOT NULL,
 calculated_at timestamptz NOT NULL, refresh_at timestamptz NOT NULL,
 status varchar(16) NOT NULL DEFAULT 'scheduled' CHECK(status IN('scheduled','invalidated','ended')),
 advance_state varchar(16) NOT NULL DEFAULT 'pending',visible_state varchar(16) NOT NULL DEFAULT 'pending',
 details jsonb NOT NULL CHECK(jsonb_typeof(details)='object' AND octet_length(details::text)<16000),
 CONSTRAINT uq_viewing_identity UNIQUE(owner_id,identity),CHECK(start_at<end_at AND peak_at BETWEEN start_at AND end_at),
 CHECK(advance_state IN('pending','sent','suppressed','missed') AND visible_state IN('pending','sent','suppressed','missed'))
);
CREATE INDEX IF NOT EXISTS ix_viewing_due ON account_viewing_opportunities(status,advance_due_at,visible_due_at);
CREATE INDEX IF NOT EXISTS ix_viewing_owner_end ON account_viewing_opportunities(owner_id,end_at);
CREATE INDEX IF NOT EXISTS ix_viewing_visible_due ON account_viewing_opportunities(visible_due_at) WHERE status='scheduled' AND visible_state='pending';
CREATE TABLE IF NOT EXISTS visibility_plan_cache (
 key varchar(64) PRIMARY KEY,expires_at timestamptz NOT NULL,
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<48000)
);
CREATE INDEX IF NOT EXISTS ix_visibility_plan_cache_expires_at ON visibility_plan_cache(expires_at);
ALTER TABLE account_notification_delivery ADD COLUMN IF NOT EXISTS alert_stage varchar(16) NOT NULL DEFAULT 'advance';
ALTER TABLE account_notification_delivery ADD COLUMN IF NOT EXISTS opportunity_id uuid;
ALTER TABLE account_notification_delivery ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_opportunity_stage ON account_notification_delivery(owner_id,opportunity_id,alert_stage) WHERE opportunity_id IS NOT NULL;
ALTER TABLE notification_runner_state ADD COLUMN IF NOT EXISTS last_planned_at timestamptz;
ALTER TABLE account_viewing_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE visibility_plan_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_viewing_opportunities,visibility_plan_cache FROM PUBLIC;
-- No browser policies. Existing FastAPI/worker table owner enforces account scope.
COMMIT;
