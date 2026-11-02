-- Explicit additive account migration; never run on application startup.
BEGIN;
CREATE TABLE IF NOT EXISTS account_alert_subscriptions (
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	owner_id INTEGER NOT NULL,
	kind VARCHAR(12) NOT NULL,
	target_id VARCHAR(64) NOT NULL,
	target_name VARCHAR(120) NOT NULL,
	slot SMALLINT NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT ck_account_subscription_target CHECK ((kind='satellite' AND target_id IN ('20580','25544','25867','25989','25994','26407','27424','27663','28054','28190','28376','28474','28485','28874','28890','28912','29479','29486','29522','29601','32260','32275','32276','32384','32393','32395','32711','32958','33053','33320','33321','33446','35491','35681','35683','35752','35951','36111','36112','36402','36585','37867','37868','37869','38358','38833','39084','39166','39533','39634','39741','40105','40294','40534','40544','40545','40697','40715','40716','40717','40730','40732','40890','41174','41175','41335','41549','41550','41752','41836','41859','41860','41861','41862','41866','41882','41917','41918','41919','41920','41921','41922','41923','42063','43001','43002','43010','43013','43055','43056','43057','43058','43107','43108','43207','43208','43226','43245','43246','43435','43437','43564','43565','43566','43567','43581','43582','43613','43689','43823','44057','44058','44059','44060','44061','44062','44387','45131','45132','45133','45134','45136','45137','45138','45139','45140','45141','48274','49008','49260','49809','51850','54234','54743','54754','58990','59051','60133','61049','67232','69589','69590','69591')) OR (kind='celestial' AND target_id IN ('jupiter','mars','mercury','moon','neptune','saturn','uranus','venus')) OR (kind='event' AND target_id IN ('cyclone','drought','dust','earthquake','flood','landslide','other','snow_ice','storm','temperature_extreme','volcano','water_color','wildfire'))),
	CONSTRAINT ck_account_subscription_slot CHECK ((kind='satellite' AND slot BETWEEN 1 AND 20) OR (kind='celestial' AND slot BETWEEN 1 AND 8) OR (kind='event' AND slot BETWEEN 1 AND 13)),
	CONSTRAINT uq_account_subscription_target UNIQUE (owner_id, kind, target_id),
	CONSTRAINT uq_account_subscription_slot UNIQUE (owner_id, kind, slot),
	FOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE CASCADE
);

ALTER TABLE account_alert_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_alert_subscriptions FROM PUBLIC;
COMMIT;
