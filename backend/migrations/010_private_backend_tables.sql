BEGIN;

-- Only the backend owns these tables. Apply default-deny RLS without forcing it
-- on the existing table owner, which serves the authenticated API and workers.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.satellite_orbit_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.satellite_orbit_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.users, public.satellite_orbit_data, public.satellite_orbit_history
    FROM PUBLIC, anon, authenticated;

COMMIT;
