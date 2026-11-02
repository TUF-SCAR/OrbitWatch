-- Explicit additive migration 005. No application startup DDL.
BEGIN;
CREATE TABLE IF NOT EXISTS account_push_devices (
	id UUID DEFAULT gen_random_uuid() NOT NULL, 
	owner_id INTEGER NOT NULL, 
	slot INTEGER NOT NULL, 
	endpoint_hash VARCHAR(64) NOT NULL, 
	encrypted_subscription TEXT NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_push_endpoint UNIQUE (endpoint_hash), 
	CONSTRAINT uq_push_slot UNIQUE (owner_id, slot), 
	CONSTRAINT ck_push_bounds CHECK (slot BETWEEN 1 AND 5 AND length(endpoint_hash)=64), 
	FOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE CASCADE
);
ALTER TABLE account_push_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_push_devices FROM PUBLIC;
CREATE TABLE IF NOT EXISTS notification_runner_state (
	id SERIAL NOT NULL, 
	token VARCHAR(36), 
	lease_until TIMESTAMP WITH TIME ZONE, 
	started_at TIMESTAMP WITH TIME ZONE, 
	last_success_at TIMESTAMP WITH TIME ZONE, 
	last_error VARCHAR(40), 
	mode VARCHAR(16), 
	cursor_owner INTEGER DEFAULT '0' NOT NULL, 
	evaluated INTEGER DEFAULT '0' NOT NULL, 
	generated INTEGER DEFAULT '0' NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_notification_runner_singleton CHECK (id=1 AND cursor_owner>=0)
);
ALTER TABLE notification_runner_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON notification_runner_state FROM PUBLIC;
CREATE TABLE IF NOT EXISTS account_notification_delivery (
	id UUID DEFAULT gen_random_uuid() NOT NULL, 
	owner_id INTEGER NOT NULL, 
	dedup_key VARCHAR(64) NOT NULL, 
	kind VARCHAR(12) NOT NULL, 
	target_id VARCHAR(120) NOT NULL, 
	category VARCHAR(32) NOT NULL, 
	subscription_id UUID, 
	location_id UUID, 
	inbox_id UUID, 
	latitude FLOAT NOT NULL, 
	longitude FLOAT NOT NULL, 
	opportunity_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	source_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	source_url VARCHAR(1500), 
	severity FLOAT, 
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	state VARCHAR(24) NOT NULL, 
	devices JSON NOT NULL, 
	next_attempt_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_delivery_dedup UNIQUE (owner_id, dedup_key), 
	CONSTRAINT ck_delivery_identity CHECK (kind IN ('satellite','celestial','event') AND length(dedup_key)=64), 
	FOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(subscription_id) REFERENCES account_alert_subscriptions (id) ON DELETE SET NULL, 
	FOREIGN KEY(location_id) REFERENCES account_observation_locations (id) ON DELETE SET NULL, 
	FOREIGN KEY(inbox_id) REFERENCES account_notification_inbox (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_delivery_owner_expiry ON account_notification_delivery (owner_id, expires_at);
CREATE INDEX IF NOT EXISTS ix_delivery_pending ON account_notification_delivery (state, next_attempt_at);
ALTER TABLE account_notification_delivery ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_notification_delivery FROM PUBLIC;
COMMIT;
