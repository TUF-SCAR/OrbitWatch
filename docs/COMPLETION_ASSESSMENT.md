# Scope and completion assessment —24October2026 IST

Initial Weather baseline: `55bb762`. Current expansion preserves main `ac36865`
and the pending normal-cache reliability fixes.
Deadline: **1 November 2026**. Scores assess working requirements, not commit size,
UI presence or test counts. The same category weights are retained. Disaster Lab
is permanently excluded. Existing Time imagery is unchanged; its planned removal
belongs to the next Time batch, not this Weather scope.

| Category | Weight | Before expansion | After expansion | Weighted before / after |
| --- | ---: | ---: | ---: | ---: |
| Live tracking / Solar System / maps / Orbit Trace / UI |45%|92%|92%|41.40 /41.40 |
| Core Python / auth / satellite APIs |15%|90%|90%|13.50 /13.50 |
| Real Live Earth weather and natural reports |15%|90%|93%|13.50 /13.95 |
| Time Explorer with genuine historical tracking |15%|35%|35%|5.25 /5.25 |
| Deployment / reliability / submission |10%|45%|45%|4.50 /4.50 |
| **Overall** |100%|**78.15% ≈78%**|**78.60% ≈79%**| |

Confidence remains moderate, about±5percentage points; the decimal arithmetic is
not a claim of measurement precision. Core temperature/local weather had already
received90% credit. This expansion adds verified global clouds/precipitation/static
wind, reversible sunlit readability and real bounded multi-provider event reports;
it raises that category conservatively to93%. No Time, historical archive, hosted
release or production-operation credit is added. Initial pre-Weather assessment
was64.65%; the preceding temperature/reliability batch reached78.15%.

Remaining Weather qualifications: upstream lifecycle/availability, target-host
native decoder and deployed operation; bounded reported events are not globally
complete warnings. FIRMS hotspots and GIBS observed cloud imagery are not enabled
and are not credited. Same-host quotas are not distributed-host coordination.

## Evidence and limitations

| Feature | Current assessment |
| --- | --- |
| Live authentication/SGP4 | Existing JWT/Argon2, PostgreSQL repository, precise TEME propagation and outage recovery retained. Isolated checks pass; production failover is not certified. |
| Orbit Trace | Approved `satelliteOrbitMaterial.js`, `orbitVisuals.js`, `stableOrbitCollection.js`, `satelliteOrbitState.js` unchanged. Weather adds imagery ownership only. |
| Celestial / UI |47 Live destinations, one Viewer, explicit travel, approximate ephemerides and scientific disclosures retained. Loader/dock/font/auth/idle systems remain. |
| Live weather | Implemented in `backend/services/weather*.py`, `routes/weather.py`, `temperatureGrid.js`, `temperatureLayer.js`, `WeatherPanel.jsx`, `useLiveWeather.js`. Genuine NOAA1° temperature/cloud coverage/instant liquid-equivalent precipitation/static10m wind plus eight Open-Meteo location variables and EONET/GDACS/USGS reports; valid/init/retrieval metadata, legend, controls, explicit Google incompatibility, shared bounded storage/quotas. See [Weather](WEATHER.md). |
| Weather validation | Latest expansion:5dataHTTP,3savedmetadata downloads;102frontend tests, lint/build, groupedGRIB/event/budget/recovery and existing backend suites pass. Normal authenticated app/existingDB/nativeWebGL verifies all four fields,671reports/cyclone,Follow,picking,Earth-Mars-Earth,Time isolation,mobile and logout. Earlier isolated temperature evidence remains separately documented. No production DB/account/schema change. |
| Earth maps | Existing provider lifecycle/fallback/credits retained; weather works on raster imagery. Google3D explicitly unsupported for this overlay, with a user-controlled Esri choice. Target-host account/network rights remain. |
| Time controls/celestial | Existing paused date, shared Viewer, Sun/eight planets, calculated scene-time positions. Existing date-dependent imagery untouched. This is not genuine historical satellite tracking. |
| Historical satellites | Missing multi-epoch source/archive and as-of APIs. Current history table has one row per NORAD, overwritten/purged by fetch time: fallback snapshot, not an archive. Requires licensed source/coverage, migration and epoch-aware propagation/cache. |
| Historical weather | Not implemented; conditional on verified source/coverage feasibility. Live weather is never shown in Time. |
| Reliability / deployment | Outage-safe startup/readiness, bounded DB recovery, persistent satellite budgets, pinned dependencies and environment/CORS runbook implemented. Hosted TLS/assets/auth/provider smoke tests, rate limits, monitoring and restore rehearsal remain. |

## Remaining risks

- Historical satellite source, licensing and epoch coverage are unresolved; current
  TLE extrapolation must not be represented as historical observations.
- NOAA proposes1°/0.5° product/filter retirement with GFSv17, without an
  implementation date in its published notice. The actual1° feed worked on
 23October2026. Track that change and requalify a supported field when scheduled.
- Weather ecCodes installation is clean-tested on Windows CPython3.12; Linux/macOS
  binary markers are pinned but require runtime qualification on the chosen host.
  Same-host cache locks are not independent-replica quota coordination.
- Before public release: trusted-proxy/app login/register abuse limits, reviewed
  CSP/dependencies for existing localStorage bearer tokens, versioned schema
  migration policy, target-host keys/origins/TLS, monitoring and backup restore.
- Existing Time NASA network access can fail and use its disclosed reference;
  Time imagery and its planned replacement remain separate work. Existing build
  chunk-size and TestClient deprecation advisories are not new Weather defects.

## Next priorities (not implemented in this batch)

1. Resolve genuine historical satellite source/coverage and complete the scoped
   **Time Explorer** archive/API/UI batch; replace the agreed Time imagery there.
2. Qualify target hosting: clean native decoder install, one persistent weather
   API host, satellite ingestion ownership, secrets/origins/TLS/assets and limits.
3. Run deployed end-to-end/failure/restore checks and a reproducible submission
   demo/runbook before1November. Keep optional orbit cosmetics closed.

The expanded local Weather/events batch is complete and ready for manual review. No commit or deployment was
performed. Stop implementation here pending the next separately scoped task.

The normal-application follow-up fromac36865 now verifies protected temperature/
location200 and real Cesium rendering against the existing database and normal
cache. Cold async preparation, real cooldown scheduling, persisted safe failure
categories and held-location freshness were corrected. No historical feature or
hosted-deployment credit is added; that preceding follow-up score was78.15%; the current expansion reassessment above is78.60%. See
[Weather](WEATHER.md) for the confirmed empty-cache/cooldown diagnosis and the
explicitly unknown original exception category.
