# Scope and completion assessment — 23 October 2026

Baseline: clean main `2bfb9f0`, before the reliability changes in this working tree.
Deadline1 November. This assesses requirements and actual code, not commit size,
test counts, UI presence or previous completion percentages. Disaster Lab is
permanently excluded. Historical NASA imagery is not a required final deliverable;
its planned removal belongs to the upcoming Time Explorer batch. Historical
weather is conditional on verified feasibility, not an invented data integration.

| Category | Weight | Before | After hardening | Weighted before / after |
| --- | ---: | ---: | ---: | ---: |
| Live tracking / Solar System / maps / Orbit Trace / UI |45%|92%|92%|41.40 /41.40 |
| Core Python / auth / satellite APIs |15%|80%|90%|12.00 /13.50 |
| Real Live Earth weather |15%|0%|0%|0 /0 |
| Time Explorer with genuine historical tracking |15%|35%|35%|5.25 /5.25 |
| Deployment / reliability / submission |10%|25%|45%|2.50 /4.50 |
| **Overall** |100%|**61.15% →61%**|**64.65% →65%**| |

Confidence: moderate, approximately±5 percentage points. The modest increase is
for demonstrated outage/auth/recovery behavior and executable release
prerequisites. No weather/history/hosted-delivery credit was added. Local tests
and synthetic browser transport are not production authenticated certification.

## Feature evidence

| Feature | Assessment and actual modules |
| --- | --- |
| Live authentication/SGP4 | Real FastAPI JWT/Argon2, user validation and PostgreSQL-backed records in `backend/routes/auth.py`, `core/security.py`, models/repository and `services/satellite_tracker.py`; precise TEME/vector propagation retained. Production storage availability not certified by isolated tests. |
| Orbit Trace | Complete approved geometry/material/state in `satelliteOrbitMaterial.js`, `orbitVisuals.js`, `stableOrbitCollection.js`, `satelliteOrbitState.js`; unchanged in this pass. |
| Celestial/Live UI | Implemented in App/OrbitGlobe, solarSystemLayer/solarSystemLod, celestialBodies/solarSystemEphemeris;47 destinations, one Viewer, explicit selection/travel, scientific disclosures, completed loader/dock/font/auth/idle work. Approximate ephemerides are not precision history observations. |
| Earth maps | Provider lifecycle/fallback/attribution in baseMap/earthMapProviders/googleEarth and MapSettings. Target-host keys/network/license rights still need verification; absent CARTO key is not working coverage. |
| Live weather | Missing: no weather API/service/measurements/globe layer. The Weather spacecraft category and unused LiveModePage controls are not weather integration. |
| Historical time controls/celestial | Implemented TimeDock/date state and paused scene-time celestial navigation, shared Viewer and modes. Existing imagery remains untouched pending separate removal. |
| Historical satellites | Missing: routes accept no as-of time; Time deliberately suppresses current fixes. SatelliteOrbitalDataHistory has one row per NORAD ID, overwritten and purged by fetch time. It is a fallback snapshot, not a multi-epoch archive. Requires verified source/license, coverage policy, schema migration and epoch-aware APIs/cache. |
| Historical weather | Missing; feasibility/source/coverage not selected. Do not present current weather as history. |
| Provider protection | Implemented persistent local budgets, Retry-After/manual circuits and same-host locks; outage checks confirm no provider use before a failed DB check. Independent hosts still require one designated ingestion host/persistent budget volume. |
| Reliability/release | Before: startup DDL blocked DB outages; temp session failures erased credentials; raw exceptions leaked; local-only config/no dependency spec/health. After: these scoped defects are fixed, isolated outage/recovery checks run; deployment runbook, pinned environment and explicit schema tool exist. No hosted demo/TLS/monitoring/backup restoration has been verified. |

The initial five priorities were: this reliability pass; bounded real weather;
historical source/archive/Time integration; reproducible staging/deployed checks;
submission demo and scientific documentation. The first is now completed within
its defined local scope; hosting and data-source dependencies remain.

## Larger risks retained, not silently implemented

- **High before public release:** login/register lack abuse rate limits. Add at
  the trusted proxy or as a focused app change; do not trust arbitrary forwarded
  client-IP headers. Existing passwords/JWT validation were not bypassed.
- **High for historical scope:** no historical orbital archive/source coverage.
  Current TLE extrapolation must not be labeled historical observations.
- **Medium:** localStorage bearer tokens remain subject to XSS risk; deploy
  appropriate CSP and review dependencies. No cookie/auth architecture rewrite.
- **Medium:** no versioned database migration chain, hosted TLS/origin/assets
  smoke test, production monitoring/backup restore or independent-replica lease.
  The empty-schema tool is deliberately not an automatic migration system.
- Existing map account/network restrictions and bundle-size advisory remain.

## Next three priorities

1. Implement bounded source-backed **Live weather**, with units/time/attribution,
   freshness/failure behavior and verified provider quota/coverage.
2. Resolve **historical satellite source and coverage** immediately; implement a
   multi-epoch archive/API/Time pipeline only for genuinely supported intervals,
   and replace date-dependent Earth imagery with the agreed fixed reference.
3. Complete **staging and submission rehearsal**: authorized storage/schema,
   secrets/TLS/origins/ingestion ownership, rate limits, real deployed end-to-end
   checks and a reproducible demo/runbook before November1.
