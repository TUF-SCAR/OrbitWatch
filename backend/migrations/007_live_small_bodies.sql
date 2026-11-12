BEGIN;
CREATE TABLE IF NOT EXISTS public.small_body_orbits (
 body_id varchar(24) PRIMARY KEY CHECK (body_id IN ('ceres','pluto','eris','haumea','makemake','vesta','pallas','hygiea','eros','bennu','apophis','psyche')),
 designation varchar(12) NOT NULL UNIQUE,
 spk_id varchar(12) NOT NULL UNIQUE,
 solution_id varchar(80) NOT NULL,
 elements jsonb NOT NULL CHECK (jsonb_typeof(elements)='object' AND octet_length(elements::text)<3000),
 retrieved_at double precision NOT NULL,
 checked_at double precision NOT NULL
);
CREATE TABLE IF NOT EXISTS public.small_body_refresh_state (
 id integer PRIMARY KEY CHECK (id=1),
 lease_token varchar(36), lease_until double precision NOT NULL DEFAULT 0,
 next_at double precision NOT NULL DEFAULT 0,
 failures integer NOT NULL DEFAULT 0 CHECK (failures BETWEEN 0 AND 8),
 day_start double precision NOT NULL DEFAULT 0,
 day_calls integer NOT NULL DEFAULT 0 CHECK (day_calls BETWEEN 0 AND 24),
 object_errors jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(object_errors)='object' AND octet_length(object_errors::text)<3000)
);
INSERT INTO public.small_body_refresh_state(id) VALUES(1) ON CONFLICT(id) DO NOTHING;
ALTER TABLE public.small_body_orbits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.small_body_refresh_state ENABLE ROW LEVEL SECURITY;
-- No browser roles/policies: existing authenticated FastAPI owns reads/acquisition.
COMMIT;
