-- Explicit additive account migration; never run on application startup.
BEGIN;
CREATE TABLE IF NOT EXISTS account_notification_inbox (
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	owner_id INTEGER NOT NULL,
	slot SMALLINT NOT NULL,
	kind VARCHAR(12) NOT NULL,
	target_id VARCHAR(120) NOT NULL,
	title VARCHAR(120) NOT NULL,
	message VARCHAR(400) NOT NULL,
	location_id UUID,
	location_name VARCHAR(80),
	source_at TIMESTAMP WITH TIME ZONE NOT NULL,
	expires_at TIMESTAMP WITH TIME ZONE,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	read_at TIMESTAMP WITH TIME ZONE,
	dismissed_at TIMESTAMP WITH TIME ZONE,
	dedup_key VARCHAR(64) NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT ck_account_inbox_target CHECK (kind IN ('satellite','celestial','event') AND length(target_id) BETWEEN 1 AND 120),
	CONSTRAINT ck_account_inbox_text CHECK (length(title) BETWEEN 1 AND 120 AND length(message) BETWEEN 1 AND 400),
	CONSTRAINT ck_account_inbox_bounds CHECK (length(dedup_key)=64 AND slot BETWEEN 1 AND 200),
	CONSTRAINT uq_account_inbox_dedup UNIQUE (owner_id, dedup_key),
	CONSTRAINT uq_account_inbox_slot UNIQUE (owner_id, slot),
	FOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE CASCADE,
	FOREIGN KEY(location_id) REFERENCES account_observation_locations (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_account_inbox_recent ON account_notification_inbox (owner_id, created_at, id);
ALTER TABLE account_notification_inbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_notification_inbox FROM PUBLIC;
COMMIT;
