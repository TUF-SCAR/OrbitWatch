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

## Batch C.2 credential validation and seasonal pilot

Both requested credentials were present in the local `backend/.env`. The existing database connection matched the importer’s production fingerprint. The project URL, absent from the local file, was derived from the verified Supabase pooler username and supplied only to the local validation and import process. Supabase Storage returned HTTP 200 to an authenticated read-only bucket listing. Copernicus authenticated the token and reported an accepted CC BY licence. The local environment file was read without edits.

The Storage adapter now sends a modern Supabase backend secret in `apikey`. Legacy `service_role` JWTs retain both `apikey` and Bearer authentication. Public key formats and legacy JWTs without the service role are rejected locally. Supabase verifies the credential. Both header forms returned HTTP 200 for the modern key on the bucket-listing endpoint tested, so the change follows Supabase’s documented API-key format rather than addressing an observed gateway rejection. The focused regression failed against the original code on the modern Bearer header and public key acceptance and passed with the corrected adapter. [Supabase API-key documentation](https://supabase.com/docs/guides/getting-started/api-keys)

### AWS and production baseline

The deployed workflow targets the existing EC2 instance in `ap-southeast-2` through Systems Manager. The local AWS SDK credential chain returned no identity, the console required sign-in, and the existing SSH path timed out on port 22. The downloaded auto-deploy bundle contained setup instructions and workflow files. No encrypted secret transport was available. The production environment file was left untouched and the credential-provisioning step remains blocked. An authorized AWS session with access to the existing instance and a protected secret-delivery path is required.

FastAPI liveness and database readiness both returned HTTP 200. The notification worker’s production heartbeat was 14 seconds old and had no recorded error. The production frontend returned HTTP 200. The deployed historical coverage endpoint returned HTTP 401 without a session. The genuine historical scene and authenticated production Live weather and events checks require an authorized session.

| Production measurement | Before | After local validation and CDS submission |
| --- | ---: | ---: |
| PostgreSQL database | 14,404,755 bytes | 14,404,755 bytes |
| Nominal headroom under 500 MB | 485,595,245 bytes | 485,595,245 bytes |
| Historical orbital elements | 1,183 | 1,183 |
| Historical weather index | Present, zero snapshots | Present, zero snapshots |
| Historical weather bucket | Absent | Absent |
| Supabase Storage | 0 objects, 0 bytes | 0 objects, 0 bytes |

### CDS job and Time Explorer

The local manifest directory and CDS account jobs were empty at preflight. The existing importer submitted and resumed one grouped ERA5 request for all four 2024 seasons. CDS completed it and returned a 3,651,984-byte GRIB file. The local manifest `backend/.runtime/era5/a5d2212b29e54b1fad536d0f.json` retains the exact job ID, download checksum and request. The persistent provider budget deferred one poll until the cooldown ended. No later year was requested. ecCodes 2.50.0 verified final ERA5 origin and preceding-hour precipitation. All four encoded snapshots contained temperature, dewpoint, cloud fraction, precipitation, humidity, sea-level pressure and both wind components, with zero missing grid nodes in every field. [ERA5 Single Levels dataset](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels?tab=overview)

| Source timestamp | Local snapshot size |
| --- | ---: |
| 2024-01-15 12:00 UTC | 691,333 bytes |
| 2024-04-15 12:00 UTC | 693,806 bytes |
| 2024-07-15 12:00 UTC | 688,273 bytes |
| 2024-10-15 12:00 UTC | 692,613 bytes |

Zero genuine ERA5 snapshots are published. Publication waits for validation of the source and confirmation that the production runtime can read the private objects. Coverage lists dates straight from the production index, so publishing metadata before runtime Storage access would expose dates whose map layers could fail to load. Production therefore has no new seasonal dates to verify on desktop or phone.

### Batch C.2 tests

Commands below use the repository’s Python environment and the local npm entry point. The browser-facing production weather integration remains pending.

| Command | Result |
| --- | --- |
| `backend/.venv/Scripts/python.exe tests/check_historical_weather.py ScientificWeather.test_storage_authentication_headers` | Reproduced both failures on the original adapter. |
| `backend/.venv/Scripts/python.exe -u tests/check_historical_weather.py -v` | All 13 passed, including modern and legacy Storage authentication, public-key rejection, importer job reuse, GRIB validation and FastAPI coverage, snapshot and location behavior. |
| `backend/.venv/Scripts/python.exe -u tests/check_historical_weather_publish.py` | Passed with disposable PostgreSQL bound to loopback. Verified RLS, rejection of corrupt inputs, upload-before-publish and duplicate imports. Stopped the isolated database after the run. |
| `node ../.orbitwatch-tools/npm/bin/npm-cli.js run lint` from `frontend` | Passed. |
| `node ../.orbitwatch-tools/npm/bin/npm-cli.js test` from `frontend` | All 238 passed. |
| `node ../.orbitwatch-tools/npm/bin/npm-cli.js run build` from `frontend` | Passed. Vite reported its bundle-size and plugin timing warnings. |
| Loopback FastAPI replay of the validated 2024 GRIB | Coverage listed all four dates. Snapshot and point routes returned the genuine fields and computed wind values for every date. A timestamp outside the archive returned HTTP 404. Authentication was covered separately by the isolated API tests. |
| Isolated Chrome replay at 1280×900 and 390×844 touch | Both passed. The calendar and archive exposed the four seasons, January switched to April, weather fields and wind flow controls rendered, and point inspection displayed the API’s April temperature. Both sessions returned to Live. Captures are in `.setup-cache/batch-c2-weather-evidence`. |

The loopback and browser replays read the validated local objects and replayed previously verified orbital responses. At this point, publication was pending until EC2 could read the private bucket.

## Batch C.2 production activation

After SSH access was restored, the existing key connected with strict host verification. The host matched the deployed commit and expected Supabase database. The two credentials and verified URL were sent only over encrypted SSH stdin. The update kept a restricted backup and atomically merged the three settings into the existing `0600` environment file. Parsing before and after confirmed the other settings were preserved. The first restart exceeded the initial command timeout and the previous file was restored. The second attempt waited for a new API process within systemd’s shutdown and startup limits and passed liveness, readiness and runtime CDS and Storage authentication. The notification worker stayed running with a healthy heartbeat and valid push configuration.

The checksum-verified 2024 source and manifest were transferred to EC2 and reused by the existing guarded importer. It published all four dates listed above and verified the private objects before exposing the metadata. There were no missing fields or unvalidated timestamps. The production account and orbital archive row counts stayed at 13 and 1,183.

| Production measurement | Before publication | After publication |
| --- | ---: | ---: |
| PostgreSQL database | 14,658,707 bytes | 14,773,395 bytes |
| Nominal headroom under 500 MB | 485,341,293 bytes | 485,226,605 bytes |
| Private historical Storage | Bucket absent | 4 objects, 2,766,025 bytes |
| Published ERA5 snapshots | 0 | 4 |

An independent production inventory confirmed the four dates and private bucket. A process on EC2 called the deployed coverage, snapshot and location handlers against real production PostgreSQL and Storage. Each date returned complete fields, source attribution, precipitation duration and wind derived from archived components. A date outside the archive returned HTTP 404. The test process used an authentication override restricted to that process. The public API health endpoints and Cloudflare Pages both returned HTTP 200. An authenticated browser session on the public deployment remains unverified. The desktop and phone replays above used the same source archive.

No additional CDS job was submitted. An automatic approval review rejected the proposed next four-date request for calendar year 2000, citing the scope and external side effects of expanding the pilot.

## Full 1970–2026 ERA5 campaign

The subsequent brief explicitly authorized 227 exact seasonal dates. The order starts with 2000, 1970, 1980, 1990, 2010 and 2020, followed by the other years. The campaign preserves all four 2024 objects and excludes October 2026. Preflight decoded the four private 2024 objects by checksum and checked the bucket settings and original source manifest. CDS accepted one four-date request for 2000 after the account job history had been checked. The importer recorded the job on EC2 before any further work.

| Measured before the campaign | Used | Allowance or remaining capacity |
| --- | ---: | ---: |
| Supabase PostgreSQL | 14,773,395 bytes | 485,226,605 bytes remaining of 500 MB |
| Supabase Storage, all project buckets | 2,766,025 bytes | 997,233,975 bytes remaining of 1 GB |
| Private ERA5 Storage | Four objects, 2,766,025 bytes | Mean 691,506 bytes, range 688,273–693,806 bytes |
| Historical satellite table and indexes | 950,272 bytes | 1,183 records |
| EC2 staging disk | 3,651,984 bytes of existing ERA5 source | 23,870,750,720 bytes free on a 30,083,776,512-byte volume |

At the pilot mean, the 227 objects would occupy about 157 MB. The campaign budgets about 196 MB with a 25% margin on the remaining snapshot mean and about 29.4 MB of total PostgreSQL usage with 64 KiB per remaining row for data and indexes. These are estimates. The importer checks measured capacity before publishing each complete snapshot, refreshes both figures after each publication, and reconciles the index and private objects after each year. The existing ceilings of 275 MB for PostgreSQL, including its write margin, and 750 MB for all project Storage preserve more than the required 200 MB independently. Unknown object sizes block writes. [Supabase Free allowances](https://supabase.com/docs/guides/platform/billing-on-supabase)

The runner uses the existing importer and provider cooldown. It processes one job at a time and keeps the existing per-year job manifests and the verified index in `backend/.runtime/era5-campaign/progress.json`. Completed years are skipped. An unclear submission or failed scientific validation is recorded for review. A ready year must contain every requested date and every validated field before publication. The source for a newly imported year is removed only after the production backend can read the complete objects and the published state is saved. The original 2024 source is retained.

`backend/.venv/Scripts/python.exe -u tests/check_historical_weather.py -v` passed all 14 targeted checks. `backend/.venv/Scripts/python.exe -u tests/check_historical_weather_publish.py` passed against a disposable loopback PostgreSQL instance, including strict source completeness, verified upload, post-publication measurement and duplicate prevention. The isolated database was stopped after testing.

On the verified EC2 host, inspect the one-shot run and checkpoint with these commands.

```sh
sudo systemctl status orbitwatch-era5-campaign
sudo journalctl -u orbitwatch-era5-campaign -n 25 --no-pager
cat /home/ubuntu/OrbitWatch/backend/.runtime/era5-campaign/progress.json
```

If the run has ended and its checkpoint shows pending work, start a new bounded run using the same deployed code and state. An active unit or an active campaign lock prevents a second worker. Resolve any `stop_reason` or year flagged for review before retrying it.

```sh
sudo systemd-run --unit=orbitwatch-era5-campaign --collect \
  --uid=ubuntu --working-directory=/home/ubuntu/OrbitWatch/backend \
  --property=Nice=10 --property=CPUQuota=40% \
  --property=MemoryHigh=384M --property=MemoryMax=600M \
  --property=RuntimeMaxSec=37h \
  --setenv=OPENBLAS_NUM_THREADS=1 --setenv=OMP_NUM_THREADS=1 \
  /home/ubuntu/OrbitWatch/.venv/bin/python -u historical_weather_campaign.py \
  --expected-target 91629c91746ef7a1 --hours 36
```

### Campaign launch and latest verified checkpoint

The backend deployment for `a6dd4088b162a3cd356852274864a3aa6f9094a0` passed. The transient `orbitwatch-era5-campaign` unit then started on EC2, verified the four 2024 objects through the production backend, and resumed the saved 2000 job. Its checkpoint showed the job as accepted and the guarded end-state projections at 195,523,393 bytes of object storage and 29,387,923 bytes of PostgreSQL. The unit can continue independently of SSH. [Backend deployment](https://github.com/TUF-SCAR/OrbitWatch/actions/runs/45645125900)

On November 25 at 16:15 UTC, the production database still held four unique 2024 timestamps and four matching private objects. There were zero additional publications. PostgreSQL remained at 14,773,395 bytes and total project Storage at 2,766,025 bytes. Copernicus still listed all four 2000 dates as accepted, with 223 approved snapshots remaining. SSH timed out on both checks, so the worker’s process state after that interruption could not be confirmed. The public API readiness endpoint and frontend returned HTTP 200, and a read-only database check found a five-second notification heartbeat, no worker error and 1,183 archived satellite rows. An authenticated production browser session was unavailable for the follow-up.

The five targeted Time Explorer frontend checks passed with `node --test tests/historicalWeather.test.js tests/historicalSatellites.test.js` from `frontend`. They covered exact date matching, the weather field contract and the independent satellite path.
