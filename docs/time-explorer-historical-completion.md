# Time Explorer historical coverage

Batch C began on `main` at `442802d8862940fca3e0983d3d147204570b9df4`. The audit reused the ERA5 importer, codec, private Storage adapter, authenticated history routes, and Space-Track archive and SGP4 paths. The production measurements below came from a read-only PostgreSQL transaction on the importer’s expected project fingerprint.

## Initial production inventory

| Item | Measured before imports |
| --- | ---: |
| PostgreSQL database | 14,240,915 bytes |
| Nominal headroom under 500 MB | 485,759,085 bytes |
| Historical satellite table and indexes | 917,504 bytes |
| Historical orbital elements | 1,134 across 15 identities |
| Historical weather index | Present, zero snapshots |
| Historical weather bucket | Absent |
| Supabase Storage objects | 0 objects, 0 bytes |
| Local source cache | Nine saved Space-Track archives. Zero ERA5 source downloads or job manifests. |
| Local archive disk free | 120,661,643,264 bytes |

The initial orbital records cover discrete January windows in 2000, 2010, 2020 and 2022, June 1–2 in 2024, January 1–7 and 14–15 in 2025, and April 14–15 in 2026. The June 2, 2024 16:00 UTC example was recalculated from the production rows and returned valid archived trajectories for 13 identities, including all four defaults. TESS and Galileo had no valid element at that instant. Stored weather at that instant was empty.

The historical provider budget had zero local reservations in the prior hour and no blocked or cooling Space-Track historical gate. The Space-Track username and password were configured. The audited local backend and supported CDS configuration files contained no CDS personal access token and no Supabase Storage service credential. SSH to the previously supplied EC2 address timed out on port 22. The remote host's credential availability and job manifests could therefore not be inventoried. [Copernicus API access and dataset terms](https://cds.climate.copernicus.eu/how-to-api)

## Final coverage and source results

| Campaign stage | Years or dates | Stored weather | Result |
| --- | --- | ---: | --- |
| Phase 1 | 2024, 2000, 1970 · Jan, Apr, Jul, Oct | 0 / 12 | Missing CDS and Storage authorization locally. No job submitted. |
| Phase 2 | 1980, 1990, 2010, 2020 · four seasons each | 0 / 16 | Pilot prerequisite pending. |
| Phase 3 | Remaining 50 years · Jan 1970 through Jul 2026, excluding Phases 1 and 2 | 0 / 199 | Representative-year prerequisite pending. |
| **Total** | **1970 through July 2026** | **0 / 227** | **No genuine weather demonstration available.** |

The grouped weather request still requires final ERA5 and exact seasonal timestamps at 12:00 UTC, equal to 17:30 IST. October 2026 is outside this campaign’s 227-date target and failed the current 95-day final-data gate. The astronomy calendar and legacy GRIB validation retain their previous ranges. A valid source archive can contain partial fields or a missing season. Verified slices remain publishable, and the importer reports unvalidated timestamps. Retrieval probes the fingerprinted database first, excludes already stored dates, checks the existing database and Storage limits, and resumes the saved CDS job instead of automatically submitting a duplicate. The `plan` command reads metadata and saved job manifests in the specified phase order. [ERA5 final and near-real-time product documentation](https://confluence.ecmwf.int/pages/viewpage.action?pageId=388499682)

The only new source retrieval was the existing Space-Track importer for January 14, 2024 12:00 UTC through January 15 12:00 UTC. The manifest records 51 GP_HISTORY records, 49 unique element sets, and SHA-256 `7c8022f361e09a20ebdcbd4816119fdc08ac4f41238d9a4efb192d4ee6ca4ffc`. Those 49 were imported transactionally. The lossless archive `46c597cf963fe6e0a0378beb.json.gz` and its capacity audit remain in the local `.runtime/history` volume. It consumed one login and one GP_HISTORY request. Zero CDS reservations or jobs were created from this workspace.

| Capacity item | Before | After |
| --- | ---: | ---: |
| Production PostgreSQL | 14,240,915 bytes | 14,273,683 bytes |
| Nominal database headroom | 485,759,085 bytes | 485,726,317 bytes |
| Satellite table and indexes | 917,504 bytes | 950,272 bytes |
| Satellite element sets | 1,134 | 1,183 |
| Supabase Storage objects and bytes | 0 / 0 | 0 / 0 |

The shared database guard enforces the 275 MB operating target with its existing write margin. The historical archive cap and weather Storage reserve remain in force.

## Demonstration scenes

| UTC instant | India time | Verified Space-Track GP_HISTORY identities (NORAD) | ERA5 variables |
| --- | --- | --- | --- |
| 2024-06-02 16:00 | 2024-06-02 21:30 | 25544, 20580, 48274, 39084, 25867, 25994, 27424, 39634, 40697, 41866, 41752, 26407, 44057 | None stored |
| 2024-01-15 12:00 | 2024-01-15 17:30 | 25544, 20580, 48274, 39084, 25994, 27424, 39634, 40697, 41866, 41752, 26407, 40544, 44057 | None stored |
| 1970-01-15 12:00 | 1970-01-15 17:30 | No stored elements at this time | None stored |

The deployed historical and weather routes returned JSON 401 without a session. The same FastAPI handlers in the isolated integration process returned real production-derived coverage and SGP4 trajectories for the two 2024 dates. The isolated process used a local authentication override. An authenticated request to the deployed host was unavailable. The coverage handler had zero weather snapshots, and the local snapshot and location handlers both returned 404 for January 15 with the production database. SGP4 reconstructs trajectories within each element's 24-hour window. [Space-Track source](https://www.space-track.org/)

## Time Explorer changes

- Available History combines exact weather timestamps with inclusive per-satellite validity windows. It browses verified dates by year, displays UTC and local time, and offers the June example when covered. Calendar dots indicate that a dataset is available at some time on that day. The draft status reports availability at the exact time.
- Applying an archive shortcut loads existing eligible satellite selections or up to four valid defaults. Weather turns on only for an exact stored snapshot. Seasonal tabs expose the seasons present for the year. Switching seasons keeps the weather controls open, releases camera tracking and fences off the preceding weather planes.
- The location inspector calculates meteorological wind direction from the stored eastward and northward components and leaves calm direction unavailable. The quarter-degree source and 1° display-grid provenance, hourly precipitation and independent field checks continue through the existing codec.

## Verification

| Check | Result |
| --- | --- |
| `tests/check_historical_weather.py` | 12 passed. Includes grouped CDS job reuse, duplicate-season skipping, missing-season isolation, exact API dates, wind direction, scientific metadata and Storage safeguards. |
| `tests/check_historical.py` | Passed in disposable PostgreSQL. Replayed all ten genuine saved archives, inserted 1,183 unique rows, and reimported zero. Checked 13 valid June identities and zero separation between the equivalent OMM and TLE test states. |
| `tests/check_historical_weather_publish.py` | Passed in disposable PostgreSQL. Checked migration idempotence, RLS, upload-before-publish, rejected corruption and duplicate import. |
| `tests/check_notification_delivery.py` | Passed, including 31 isolated HTTP checks. |
| Frontend lint and relevant tests | ESLint and all 19 targeted cases passed. An earlier full run passed 237 of 238 cases. Its sole failure expected date changes to clear all satellite selections. The updated assertion checks that behavior for manual date changes and checks the new verified-shortcut path separately. It passed the targeted rerun. |
| Production frontend build | Passed. Vite reported its large-bundle warning. |
| Browser with production orbital response replay | 390×844 touch and 1280×900 desktop. Chose the featured date, loaded the four default archived tracks, confirmed zero weather snapshot requests at the uncovered instant, and returned to Live. The phone also switched to Time Explorer with the Live Natural Events layer enabled and verified its canvas was hidden. |

The 844×390 emulated phone exercised labeled weather fixtures. January → April made an exact new snapshot request, the fields and wind controls could be changed, and the inspector requested April values at the selected view center. The scale remained visible with clearance above the date dock. The isolated section is a UI and renderer test. See `.setup-cache/time-explorer-evidence` for the browser captures. Physical Android performance remains unmeasured.
