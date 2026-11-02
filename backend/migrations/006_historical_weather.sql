BEGIN;
CREATE TABLE IF NOT EXISTS public.historical_weather_snapshots (
    timestamp timestamptz NOT NULL,
    version integer NOT NULL CHECK (version > 0),
    provider text NOT NULL CHECK (provider = 'Copernicus CDS / ECMWF'),
    dataset text NOT NULL CHECK (dataset = 'reanalysis-era5-single-levels'),
    product text NOT NULL CHECK (product = 'reanalysis'),
    variables jsonb NOT NULL,
    grid jsonb NOT NULL,
    object_key text NOT NULL UNIQUE CHECK (object_key ~ '^era5/v1/[0-9]{8}T[0-9]{6}Z/[a-f0-9]{64}\.owwx$'),
    sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
    compressed_bytes integer NOT NULL CHECK (compressed_bytes > 0 AND compressed_bytes <= 4194304),
    status text NOT NULL CHECK (status IN ('complete', 'partial')),
    validated_at timestamptz NOT NULL,
    provenance jsonb NOT NULL,
    PRIMARY KEY (timestamp, version),
    CHECK (timestamp >= '1945-01-01T00:00:00Z'),
    CHECK (jsonb_typeof(variables) = 'object' AND jsonb_typeof(grid) = 'object'),
    CHECK (octet_length(provenance::text) < 32768)
);
ALTER TABLE public.historical_weather_snapshots ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated policies: handwritten JWT auth reads through the backend.
COMMIT;
