# Submission gaps — inspected 10 October 2026

Deadline: **1 November 2026**. Based on current `main` at `f42512b` plus the preserved
working tree. This is implementation scoping, not a claim that absent features
are complete. No Weather/Time/Disaster/deployment code was implemented in this pass.

| Area | Implemented | Partial | Missing / next dependency |
| --- | --- | --- | --- |
| Live Earth weather | Earth maps, terrain, geographic labels, place search; weather-satellite catalog | Reusable Earth layer lifecycle | Real weather ingestion, controls, measurements/overlays, freshness and provider errors |
| Time Explorer satellites | Date/time input, ±10m/±1h, Now, separate 15-object limit, paused scene clock | Existing SGP4 and timestamped track renderer | Historical element archive, as-of API, time-aware requests/telemetry and coverage UI |
| Time Explorer celestial | 47-body scene-time approximate orbital calculations and correct local frames | Renderer can evaluate other dates | Time-mode celestial navigation, defined/validated date range; precision history if required |
| Disaster Lab | EONET open-event points; four layer toggles; Earth 2D/3D | Presentation and reusable scene | Scenario engine, hazard evolution, player actions, outcomes/scoring, restart/replay |
| Integration/deployment | Production frontend builds; JWT/auth, PostgreSQL repository, orbital provider fallback, local checks | Local launch/testing documentation | Reproducible backend install/migrations, hosted configuration, release/health checks and deployed smoke test |

## Weather

Relevant code: [App](../frontend/src/App.jsx), [OrbitGlobe](../frontend/src/components/OrbitGlobe.jsx),
[baseMap](../frontend/src/services/baseMap.js), [MapSettings](../frontend/src/components/MapSettings.jsx),
[placeSearch](../frontend/src/services/placeSearch.js).
The “Weather” category represents spacecraft, not surface weather. No weather
service, API route or measurement layer exists. EONET storm locations also do not
provide wind, rain or forecasts. The unused `LiveModePage.jsx` contains planned
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
current UTC. Changing `selectedTime` updates the clock but does not request a
historical trajectory; selected-object telemetry still polls current position.
Out-of-coverage tracks clamp and disclose staleness, so the time selector cannot
currently produce a genuine historical satellite view.

The [history table](../backend/models/satellite_orbital_data.py) has **NORAD ID as
its sole primary key**. [Archive writes](../backend/repositories/satellite_orbital_data.py)
overwrite that row; [ingestion](../backend/services/orbital_data_service.py) purges
history older than two hours by fetch time. It is a fallback snapshot, not an
archive. Both orbital providers request latest elements only. Historical scope
requires a multi-epoch schema/migration, licensed/available historical source,
coverage policy, epoch-keyed propagation/cache and timezone-aware as-of APIs.
Current TLE extrapolation far into the past must not be labeled historical truth.

[Celestial ephemerides](../frontend/src/data/solarSystemEphemeris.js) already
evaluate scene time with approximate J2000 orbital elements. Moon/small-body
approximations remain disclosed. System navigation is hidden in Time mode and
App rejects celestial selection outside Live. `solarSystemData.js`'s SBDB loader
has no callers; it is not an integrated historical ephemeris service. Wire the
existing renderer to Time navigation and test bounded dates first; historical
textures are static reference assets, not date-varying observations.

## Disaster Lab

Relevant code: [DisasterDock](../frontend/src/components/DisasterDock.jsx),
[eonetApi](../frontend/src/services/eonetApi.js), OrbitGlobe's disaster effect.
The browser fetches NASA EONET `status=open&limit=200`, then renders each event's
latest coordinate as a colored point/label. Layers reload on mode/toggle changes;
there is no periodic freshness UI, scenario state, evolving footprint, decision
loop or game result. Backend registers only auth and satellite routers.

The smallest functional next batch is one bounded hazard scenario with explicit
inputs, deterministic time steps, meaningful player decisions, visible consequences,
score/end conditions and reset/replay. Keep real event context separate from
educational simulation outputs. Hazard rules/calibration and the intended game
objective must be specified; a live event feed alone is not a predictive model.
Reuse the single Viewer; add persistence/API routes only if scenario requirements
need saved runs or shared scores.

## Integration and release

Frontend dependencies are pinned/listed in [package.json](../frontend/package.json)
and its lockfile: React, Cesium 1.144, Motion, Three, Vite. Backend imports require
FastAPI/Uvicorn, SQLAlchemy plus PostgreSQL driver, python-dotenv, PyJWT,
pwdlib/Argon2, Skyfield and httpx. [Testing docs](TESTING.md) list an isolated
installation, but no backend requirements/lockfile, migration setup, Docker/deploy
configuration or CI workflow was found. The terminal launcher only opens shells.

Production blockers are concrete: API base defaults to loopback8000;
[CORS](../backend/main.py) permits only local5173; database/auth/provider modules
require `backend/.env` and override process environment. Configure hosted origins,
HTTPS/API base and secret loading; serve SPA auth routes, Cesium static assets,
models and media with correct paths. Supply/migrate staging storage separately
from the existing database. Startup runs `create_all` and orbital ingestion;
multiple API workers would each start a refresh loop, so worker ownership needs
an explicit deployment policy. A health/readiness endpoint and repeatable install,
backup/recovery, provider-failure and deployed login/travel/mode checks are missing.

Existing assets have provenance in [ASSETS.md](ASSETS.md); Cesium/map provider
access, geocoder, EONET and orbital feeds still need target-host smoke tests.
The build's large-chunk warning is known, not a build failure. Current checks:
66 frontend tests, lint/build, actual read-only 1/6/12/24/44 API batches and44 orbits,
24/44 concurrent native GPU cases. The authenticated large-load browser network
check remains limited by intermittent test-bridge fetch failures; do not conflate
that with the successful GPU/SGP4 checks.

Suggested batch order before submission: establish staging/install configuration
and historical-source coverage early; then bounded Weather, Time and one-hazard
Disaster batches with acceptance tests; reserve the final days for hosted end-to-end
verification, scientific disclosures and the submission runbook. Optional orbit
cosmetics are closed. Historical data availability and simulation scope are the
largest unresolved dependencies, not frontend styling.
