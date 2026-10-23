# Deployment prerequisites and outage behavior

Validated locally 23 October 2026. No hosting provider has been selected and no
production deployment, schema change or account change was made by this batch.

## Repeatable setup

Use CPython 3.12 and the pinned runtime environment:

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r backend/requirements.lock
npm ci --prefix frontend
```

`backend/requirements.txt` lists the direct dependencies and extras;
`requirements.lock` pins the tested transitive environment (not a hash-verified
artifact lock). Revalidate wheels and the lock on the target OS. Do not copy a
developer virtual environment into deployment. TestClient currently emits an
upstream httpx deprecation warning; production does not use TestClient.

Backend configuration comes from process variables first. `backend/.env` is an
optional local convenience and cannot override injected deployment variables.
See `backend/.env.example`; never publish the real file or put private secrets in
`VITE_*` variables (those are public build-time values).

- `DATABASE_URL`: PostgreSQL URL using `postgresql+psycopg://...`; enable verified
  TLS according to the provider's CA/hostname requirements. The example's
  `sslmode=require` encrypts transport; use `verify-full` with the appropriate
  trust configuration when supported. Do not expose credentials in shell history.
- `JWT_SECRET_KEY`: long randomly generated persistent secret, the same for all
  API workers; rotation invalidates existing tokens. Never use the placeholder.
- `CORS_ALLOWED_ORIGINS`: comma-separated exact frontend origins, including
  scheme and optional port; no wildcard, paths, credentials or trailing routes.
  Defaults are local5173 only. CORS is not authentication.
- `ORBITWATCH_INGESTION_ENABLED`: explicitly true on one ingestion host; false
  on every other independent host. Same-host processes elect one scheduler using
  the existing OS lease. Disabled ingestion does not acquire that lease.
- Space-Track credentials stay backend-only. Preserve `backend/.runtime` on the
  ingestion host across restarts/releases: its existing SQLite provider budgets
  must not be replaced with an empty ephemeral directory. Monitor disk access,
  circuit state and provider authorization out of band; do not reset cooldowns.

Run the API without development reload in production, for example from backend:

```powershell
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2
```

Size workers against database capacity: each process has at most five pooled DB
connections, no overflow, a3sec pool wait and3sec connection timeout. PostgreSQL
statement timeout is8sec via connection startup options. Verify that the chosen
direct/session-pool endpoint supports those options; transaction-pool endpoints
must be checked before deployment. Two workers can use ten connections.

## Schema safety

API startup never runs `metadata.create_all`, migrations or schema upgrades.
Readiness performs SELECT-only probes against the existing three tables.
An unavailable or absent schema leaves readiness503 and liveness200; it does
not cause the application to create tables in Supabase.

`backend/init_schema.py --create-schema` is an explicit **operator-only** tool
for an independently authorized empty target. Do not run it on the current
production database as part of startup/deploy. It is not a migration system and
does not alter existing columns. Future schema changes require a reviewed,
versioned migration and backup/rollback plan. None were run in this batch.

## Liveness, readiness and recovery

- `GET /health/live`:200 if the API can serve requests; no database or provider
  dependency. Use this for process liveness, not readiness.
- `GET /health/ready`:200 only after read-only database/schema verification;
  otherwise503 with `code: database_unavailable` and Retry-After5. Successful
  results are cached for5sec; failures back off5/10/20/40/60sec plus0-1sec jitter.
  One process performs at most one concurrent recovery probe. A failed actual
  transaction opens the same gate. Pool pre-ping replaces stale connections;
  interrupted transactions/writes are never automatically replayed.
- Each API worker has its own gate; scale is bounded by worker count. Health
  checks do not call orbital providers. Missing required configuration fails
  fast; missing network/database availability does not block ASGI startup.
- Ingestion runs in a background task, independently of API readiness. Database
  checks happen before provider retrieval. Failed refresh jobs wait with bounded
  exponential backoff/jitter (up to15min); existing provider reservations,
  cooldowns and same-host refresh ownership still apply after recovery/restart.
  In-flight thread operations finish under their connection/provider timeouts.

Valid JWTs still require database user validation for protected endpoints. A warm
SGP4 cache does not authorize bypassing the database: outages return503. No cached
user records are used to authenticate requests. Invalid/expired JWTs return401
before attempting database validation; deleted users return401 after recovery.

The frontend retains credentials through network/timeout/5xx failures, but a
saved session remains unverified until `/api/auth/me` succeeds. It retries with
bounded delays (up to30sec) or user retry/online events, and cancels pending checks
on logout/unmount. Confirmed401 clears only the request's current token; a late
old401 cannot clear a newer login. Login/register keep editable form values and
show safe errors. Existing cinematic success transitions remain unchanged.

Already loaded scientific tracks are retained during failures within their
existing approved sample coverage; expired positions freeze/disclose stale state.
No trajectory extrapolation window or renderer was changed. Orbital feed status
becomes unavailable/offline, data age keeps increasing, and retained telemetry
keeps its original sample timestamp. Existing15/30/60sec bounded lifecycle/status
cadences remain; there is no automatic replay of registration or other writes.

Responses/log messages never include raw infrastructure exception strings, SQL,
bound parameters or tracebacks. Expected validation/auth/not-found responses stay
meaningful; unexpected failures are500 with safe text and type-only internal logs.
Do not enable SQL echo/debug exception pages or capture Authorization/body secrets
in a deployment proxy's logs.

## Frontend and final release checks

Build with the intended **public HTTPS** `VITE_API_BASE_URL` (no trailing `/api`),
then `npm run build --prefix frontend`. An explicitly empty value selects
same-origin `/api` through your reverse proxy. Omitting the variable retains the
local8000 default, so verify it in the actual production build. Configure exact
API CORS origins. Terminate HTTPS at a trusted proxy and avoid mixed content.

Serve `frontend/dist` with SPA fallback for `/login` and `/register`, and preserve
Cesium Workers/Assets/Widgets/ThirdParty, GLBs, textures, photos, media and Draco
paths. Serve real assets as files (missing assets must not return index.html).
Use correct content types, bounded caching and cache-busting for index releases.
The existing Vite Cesium plugin copies required Cesium resources into dist.
Configure origin-restricted Cesium/CARTO keys and retain provider attribution.
Unconfigured CARTO is disabled; account/network rights require target-host checks.

Before submission: staging login/register/restore/expiry, DB failure/recovery,
tracking refresh/coverage, Focus/Follow, Earth/celestial return, both modes,
provider failure/fallback and logout cleanup; TLS, SPA routes, assets, readiness,
DB connection count, persistent budget ownership and backup recovery. Use test
accounts/storage, never deliberately disconnect the existing production database.

Remaining larger work: login/register abuse limits at the trusted proxy or app
(rate limiting is not implemented here); historical schema/source coverage;
secret rotation/monitoring/backup policy; hosted end-to-end verification and final
submission demo. The localStorage JWT model remains unchanged (protect against
XSS with reviewed dependencies and an appropriate deployed CSP). No claim of a
complete security audit or production certification is made.

Implementation references: [SQLAlchemy2.0 disconnect handling](https://docs.sqlalchemy.org/en/20/core/pooling.html#disconnect-handling-pessimistic)
explains that pre-ping does not rescue an interrupted transaction;
[FastAPI lifespan](https://fastapi.tiangolo.com/advanced/events/) and
[error handlers](https://fastapi.tiangolo.com/tutorial/handling-errors/) underpin
startup ownership and safe HTTP responses. Application-specific behavior above
is verified by the repository's isolated tests, not inferred from those guides.

## Live weather runtime

See [Weather](WEATHER.md) for NOAA/Open-Meteo contracts, terms, quota limits and
upstream GFSv17 lifecycle risk. No weather database migration is needed. The
updated Python lock adds ecCodes2.50.0. A fresh Windows CPython3.12 install,
`python -m eccodes selfcheck`, `pip check` and real GRIB decoding were verified.
Linux/macOS use pinned non-Windows eccodeslib; qualify its wheel, OS/architecture
and real decoding on the chosen host before deployment.

Persist `backend/.runtime/weather` (or `ORBITWATCH_WEATHER_CACHE_DIR`) on one
weather API host. Its workers share local SQLite/OS locks and budgets. Independent
containers/hosts with separate volumes multiply quotas; route `/api/weather/*`
to that designated host. A network SQLite share is not a distributed lease.
`ORBITWATCH_WEATHER_PROVIDER_REQUESTS=false` serves only usable cache; true is the
normal setting. No startup weather download occurs. DB availability gates all
external refreshes. Check target-host NOMADS/Open-Meteo access, noncommercial
terms, attribution and actual raster/Google compatibility on staging.

### Weather startup troubleshooting

Use the explicitly installed pinned Python runtime and `python -m eccodes
selfcheck`; do not assume a random PATH Python has the application/decoder.
The first authenticated global request returns202 while one background job runs.
503 with a weather `cooldown` state has a real `Retry-After`/UTC deadline. Preserve
that state across restarts: never delete cache/gates or edit next_at to force HTTP.
`/api/weather/status` is protected and reads safe phase/failure category/status/
count and cache freshness without provider access. `decoder_unavailable` is a
local dependency problem, checked before NOAA quota is spent. Raw errors/secrets
are never returned. A missing field remains visibly pending/unavailable even if
its layer checkbox is enabled. See [normal-app follow-up](WEATHER.md).


### Natural report operation (configuration only; no deployment performed)

Route protected `/api/events` and `/api/events/{id}` to the designated API host.
Persist `backend/.runtime/events` (or `ORBITWATCH_EVENTS_CACHE_DIR`) with existing
weather/orbital budgets. Three provider sub-stores have independent process
leases, single-flight jobs and gates. `ORBITWATCH_EVENT_PROVIDER_REQUESTS=false`
serves retained snapshots only; true is normal read-only external operation.
No startup fetches or production database tables/records are created. A provider
outage must not block other sources. No multi-host quota coordination is claimed.

The global model download is now grouped16MB-bound/five required instantaneous
components rather than temperature-only; existing NOAA budgets remain unchanged.
FIRMS is not enabled; do not put MAP_KEY in frontend/Vite variables. Consult
[Natural events](NATURAL_EVENTS.md) for source terms, scope/freshness/limits and
future optional key qualification. Event reports are not an emergency service.
