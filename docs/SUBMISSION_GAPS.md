# Submission gaps — 23 October 2026

Deadline: **1 November 2026**. Current baseline `55bb762` plus the uncommitted Live
Weather batch. See [weighted assessment](COMPLETION_ASSESSMENT.md) (78%, moderate
confidence ±5), [Weather](WEATHER.md), [deployment](DEPLOYMENT.md) and
[API usage](API_USAGE.md). Exactly two modes remain: Live and Time Explorer.
Disaster Lab stays permanently removed. No production schema/accounts changed.

| Area | Implemented | Partial / qualification | Missing / next dependency |
| --- | --- | --- | --- |
| Live Earth weather | Genuine NOAA GFS1° global2m temperature, eight Open-Meteo location values, protected API, valid/init/retrieval metadata, legend/opacity/toggle, quotas/cache/stale/error, native Cesium integration | Clean Windows ecCodes verified; target OS/provider rights need deployment checks; Google3D explicitly unsupported with user Esri choice | No blocking local feature defect; monitor proposed GFSv17 product retirement; certify deployed operation |
| Time satellites | Date/time controls,15-object selection, paused clock and honest unavailable state | Scientific renderer can consume future epoch-aware samples | Licensed historical source/coverage, multi-epoch archive/migration, as-of API and time-aware telemetry/cache |
| Time celestial | Shared Sun/eight-planet navigation, travel/return, LOD/slider, selected-time calculations | Approximate J2000 model, not precision historical ephemerides | Defensible scientific validity/coverage policy; precision history only if required |
| Earth maps | Live provider gallery/fallback/credits; existing Time NASA metadata/exact advertised days/reference fallback | Network/key/account availability; CARTO key absent | Target-host rights/smoke tests; agreed fixed Time reference replacement in next batch |
| Integration / release | JWT/PostgreSQL, precise orbital propagation, persistent provider protections, outage recovery, pinned backend install/config/readiness runbook | Local isolated/native verification, no hosted certification | Trusted release configuration, abuse limits, migrations/backup/monitoring, deployed acceptance/demo |

## Weather — local feature complete

Backend: `backend/routes/weather.py`, `services/weather.py`, `weather_grid.py`,
`weather_cache.py`; protected `/api/weather/temperature`, `/location`, `/status`.
Frontend: `WeatherPanel`, `temperatureGrid`, `temperatureLayer`, `useLiveWeather`,
plus narrow App/OrbitGlobe/dock/API/baseMap integration. One Viewer, no orbit
geometry/shader/SGP4/provider-budget changes. No weather in Time or off Earth.

Actual1° global data and three public locations were verified in four weather
HTTP calls total; provider traffic is disabled for recorded-data browser testing
and mocked for stress. Native checks cover raster/Google compatibility,
selection/Follow, opacity, stale/error, Earth→Mars→Earth, Time gating, mobile and
cleanup. See [Weather](WEATHER.md) for exact units/times/quota/evidence limits.

Remaining qualifications are operational: target-host ecCodes wheel/runtime,
persistent same-host weather cache/budgets, noncommercial Open-Meteo terms and
future NOAA feed transition. Do not add optional weather layers before submission
or claim historical weather without a separately verified source.

## Time Explorer — next implementation batch

Relevant: `TimeDock.jsx`, App telemetry/date effects, OrbitGlobe clock/trajectory
ownership, `orbitwatchApi.js`, `backend/routes/satellites.py`,
`services/satellite_tracker.py`. Current protected routes are `/catalog`,
`/data-status`, `POST /trajectories`, `/{id}/position`, `/{id}/trajectory`,
`/{id}/orbit` under `/api/satellites`. None accepts as-of/start time. Propagation
starts at current UTC; Time deliberately suppresses those current fixes.

`SatelliteOrbitalDataHistory` uses NORAD ID as its sole key. Repository writes
replace the row; ingestion purges snapshots older than two hours by fetch time.
Both providers request latest elements. Genuine historical tracking needs a
licensed/available multi-epoch source, explicit date coverage, a separately
approved migration, epoch-keyed propagation/cache and UTC-aware APIs. Current
TLEs extrapolated far into the past are not historical truth.

`solarSystemEphemeris.js` evaluates approximate J2000 elements at scene time.
Time uses Sun/eight planets, shared Viewer, local inertial frames, travel/recenter
and240AU slider; Live keeps47 destinations. Functional date tests are not precision
accuracy certification. Moon/small-body approximations remain disclosed.

Current NASA MODIS Time imagery is **unchanged** in this batch. Its planned removal
and fixed-reference replacement belong to the next Time task. It is not a required
historical imagery deliverable. Historical weather remains conditional on real
source/coverage feasibility and is not included in current Weather credit.

## Integration and release

`backend/requirements.txt` and `requirements.lock` provide pinned CPython3.12
installation; `core/config.py` respects injected environment, `main.py` supplies
liveness/readiness/CORS/safe errors without startup DDL/ingestion blocking.
Readiness and auth preserve outage semantics. See [deployment](DEPLOYMENT.md).
There is still no versioned migration chain or completed hosted demo.

Choose staging storage separately from production; configure public HTTPS API
base/exact origins, secrets, SPA auth fallback and Cesium/GLB/media asset paths.
Verify map keys/attribution/terms. Keep one satellite ingestion owner and persistent
provider state; route weather requests to one designated host with its shared
local cache. Independent replicas are not coordinated by local file locks.

Add trusted-proxy/app auth abuse limits, monitoring and backup/restore procedure.
Rehearse login/session expiry, DB/provider outages, satellite refresh/Focus/Follow,
Earth/celestial return, both modes, weather and logout on the deployed host.
No production records/schema should be modified by local verification.

Latest local checks:94 frontend tests, lint/build, weather decode/cache/quota/
protected contracts,39 existing API contracts,26 reliability route cases plus40
concurrent outage calls, worker/availability and persistent four-process provider
budgets. Earlier approved Orbit Trace GPU evidence remains valid; this batch
preserves its implementation. Local tests are not hosted production certification.

Next sequence: historical source/Time scope; staging qualification; submission
rehearsal. Optional orbit/background/general UI cosmetics remain closed.
