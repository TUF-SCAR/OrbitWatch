# Submission gaps — updated 23 October 2026

Current agreed scope and weighted assessment are in [completion assessment](COMPLETION_ASSESSMENT.md).
The reliability pass adds outage-safe startup, read-only readiness, bounded DB
recovery, safe errors, saved-session retry, pinned dependencies and environment/CORS
configuration. See [deployment prerequisites](DEPLOYMENT.md). Startup no longer
creates schema or waits for ingestion. No production migration or deployment has
been performed. Historical satellite data and real weather are still missing.
Historical NASA imagery is scheduled for removal in the separate Time batch and
is not a required final deliverable. The older detailed investigation below is
retained for module/source context; its release-configuration findings are
superseded by those two current documents.

Deadline: **1 November 2026**. Based on current `main` at `7bf88c7` plus the preserved
working tree. This is implementation scoping, not a claim that absent features
are complete. The two-mode frontend/map/navigation batch is implemented. Weather ingestion, historical satellite storage/propagation and deployment remain separate development batches.

| Area | Implemented | Partial | Missing / next dependency |
| --- | --- | --- | --- |
| Live Earth weather | Earth maps, terrain, geographic labels, place search; weather-satellite catalog | Reusable Earth layer lifecycle | Real weather ingestion, controls, measurements/overlays, freshness and provider errors |
| Time Explorer satellites | Date/time controls, 15-object tracked selection, paused clock; explicit unavailable state, current positions/telemetry suppressed | Existing scientific renderer ready for genuine epoch-aware samples | Historical element archive, as-of API, time-aware requests/telemetry, coverage response |
| Time Explorer celestial | Shared Sun+8-planet Orbit Map, travel/recenter/return, LOD/slider, selected-time positions and local frames; Live 47 unchanged | Approximate J 2000 model, not precision historical ephemerides | Define defensible long-range scientific validity; precision history only if required |
| Earth imagery | Live gallery, actual-active status, Google retry/fallback, NASA reference; Time runtime GIBS metadata, exact advertised daily dates, gap/future reference | Provider availability depends on network/account; imagery has swath/cloud gaps | CARTO restricted browser key and target-host provider smoke tests |
| Integration/deployment | Production frontend builds; JWT/auth, PostgreSQL repository, orbital provider fallback, local checks | Local launch/testing documentation | Reproducible backend install/migrations, hosted configuration, release/health checks and deployed smoke test |

## Weather

Relevant code: [App](../frontend/src/App.jsx), [OrbitGlobe](../frontend/src/components/OrbitGlobe.jsx),
[baseMap](../frontend/src/services/baseMap.js), [MapSettings](../frontend/src/components/MapSettings.jsx),
[placeSearch](../frontend/src/services/placeSearch.js).
The “Weather” category represents spacecraft, not surface weather. No weather
service, API route or measurement layer exists.  The unused `LiveModePage.jsx` contains planned
layer controls; the real entry is `main.jsx → AuthRoot → App → OrbitGlobe`.

Scope the first batch around a real location-based weather panel and explicitly
chosen overlay(s), with units, observation/forecast time and stale/error states.
Provider coverage, quota, attribution, credentials and whether it supplies global
tiles versus point data must be settled before promising a globe overlay. Reuse
the current Viewer; keep any private provider key server-side. No provider has
been selected or validated by this inspection.

## Time Explorer

Relevant code: [TimeDock](../frontend/src/components/TimeDock.jsx), App's telemetry
effect, OrbitGlobe's clock/trajectory effects, [orbitwatchApi](../frontend/src/services/orbitwatchApi.js),
[satellite routes](../backend/routes/satellites.py), [tracker](../backend/services/satellite_tracker.py).
The six protected satellite endpoints are `/catalog`, `/data-status`,
`POST /trajectories`, `/{id}/position`, `/{id}/trajectory`, `/{id}/orbit` under
`/api/satellites`. None accepts an as-of/start timestamp. Propagation starts at
current UTC. The frontend now deliberately disables those current trajectory,
position and telemetry requests in Time Explorer. The selected date and tracked
IDs survive mode changes/travel; reference mission media remains available.
This is an honest unavailable state, not implemented historical propagation.

The [history table](../backend/models/satellite_orbital_data.py) has **NORAD ID as
its sole primary key**. [Archive writes](../backend/repositories/satellite_orbital_data.py)
overwrite that row; [ingestion](../backend/services/orbital_data_service.py) purges
history older than two hours by fetch time. It is a fallback snapshot, not an
archive. Both orbital providers request latest elements only. Historical scope
requires a multi-epoch schema/migration, licensed/available historical source,
coverage policy, epoch-keyed propagation/cache and timezone-aware as-of APIs.
Current TLE extrapolation far into the past must not be labeled historical truth.

[Celestial ephemerides](../frontend/src/data/solarSystemEphemeris.js) evaluate
scene time with approximate J 2000 elements. Time now shares the existing Viewer,
Sun/eight-planet System map (no Catalog), local inertial camera, travel/recenter,
LOD and240 AU slider. Live keeps all 47 destinations, moons, rings and models.
Paused center caches invalidate if asynchronous ICRF readiness changes the frame.
Tests cover dates 2000/2030 and browser checks2024/2040; these are functional
checks, not precision-ephemeris accuracy certification. Moon/small-body
approximations remain disclosed. The unused SBDB loader has no callers.

Time Earth uses NASA MODIS Terra daily archived imagery only for exact advertised
UTC dates, with actual observation-day disclosure and cloud/swath gaps. Future,
uncovered and offline dates use a fixed disclosed reference. See
[Earth imagery](EARTH_IMAGERY.md) for metadata/lifecycle/provider requirements.
No historical weather measurements or Live weather ingestion exists.

## Integration and release

Frontend dependencies are pinned/listed in [package.json](../frontend/package.json)
and its lockfile: React, Cesium 1.144, Motion, Three, Vite. Backend imports require
FastAPI/Uvicorn, SQLAlchemy plus PostgreSQL driver, python-dotenv, PyJWT,
pwdlib/Argon 2, Skyfield and httpx. [Testing docs](TESTING.md) list an isolated
installation, but no backend requirements/lockfile, migration setup, Docker/deploy
configuration or CI workflow was found. The terminal launcher only opens shells.

Production blockers are concrete: API base defaults to loopback8000;
[CORS](../backend/main.py) permits only local5173; database/auth/provider modules
require `backend/.env` and override process environment. Configure hosted origins,
HTTPS/API base and secret loading; serve SPA auth routes, Cesium static assets,
models and media with correct paths. Supply/migrate staging storage separately
from the existing database. Startup runs `create_all` and orbital ingestion;
same-host API workers now elect one lifespan scheduler and coordinate refresh
jobs plus persistent provider budgets. Multiple independent hosts still need
one designated ingestion owner/shared distributed lease. A health/readiness endpoint and repeatable install,
backup/recovery, provider-failure and deployed login/travel/mode checks are missing.

Existing assets have provenance in [ASSETS.md](ASSETS.md); Cesium/map provider
access, geocoder and orbital feeds still need target-host smoke tests.
The build's large-chunk warning is known, not a build failure. Current checks:86 frontend tests, lint/build, isolated 39-request backend contracts, prior read-only 1/6/12/24/44 API batches and 44 orbits, and final dual-style 1/6/12/24/44 native GPU cases (900 frames). The authenticated large-load browser network
check remains limited by intermittent test-bridge fetch failures; do not conflate
that with the successful GPU/SGP4 checks.

Suggested batch order before submission: establish staging/install configuration
and historical-source coverage early; then bounded Weather and historical-satellite batches with acceptance tests; reserve the final days for hosted end-to-end
verification, scientific disclosures and the submission runbook. Optional orbit
cosmetics are closed. Historical data availability and date coverage are the
largest unresolved dependencies, not frontend styling.

Removal audit: no dedicated abandoned-mode UI/service/route/style/test remains.
Eight surviving terminology matches are spacecraft scientific mission/type
metadata in `frontend/src/data/spaceObjects.js` and its matching backend catalog,
not feature implementation. These shared descriptions are deliberately retained.
The dedicated dock and exclusive event service were deleted; no dedicated backend
feature, asset or package dependency was found. The removal did not affect shared backend catalog metadata. Later precise
orbital responses and provider safeguards are documented in
[ORBIT_INVESTIGATION](ORBIT_INVESTIGATION.md) and [API_USAGE](API_USAGE.md).
