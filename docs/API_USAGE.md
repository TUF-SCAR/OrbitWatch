# External API usage — inspected 13 October 2026

## Actual request ownership

Frontend catalog/status/position/trajectory/orbit calls go to OrbitWatch FastAPI.
Those endpoints read cached records and compute SGP4 locally; they never retrieve
Space-Track/CelesTrak elements. Four bounded full-orbit workers, <=24-ID trajectory
batches, fifteen-second lifecycle checks, coverage margins and per-ID cooldowns
remain. Visual style changes use resident data, without a provider/API request.
Only backend startup/the scheduled refresh worker performs external GP ingestion.

Previously every backend process had its own startup attempt and in-memory
cooldown. Now `refresh_owner()` is an OS file lock held through refresh; one elected lifespan scheduler plus atomic
SQLite reservations under ignored `backend/.runtime` survive worker restarts.
The local store contains timestamps/costs/circuit state, **no credentials or
provider content**, and does not change Supabase tables. Forced refresh does not
bypass the budget. Failed data retrieval preserves existing orbital records.

Deploy one ingestion host. Same-host processes are coordinated and tested;
independent replicas with separate filesystems need a shared distributed lease
or a dedicated ingestion service. Do not deploy independent refresh owners
using the same account. This batch adds no database migration/deployment platform.

## Orbital provider policies and budgets

[Space-Track official documentation](https://www.space-track.org/documentation):
less than 30/minute and 300/hour; current GP at most hourly, randomized minute;
bulk IDs rather than per-object queries; GP_HISTORY is archival retrieval rather
than continual polling. OrbitWatch reserves one hourly bulk attempt plus30–180s
jitter, conservatively budgeting login+query as two calls. Persistent counters
also enforce the general ceilings.429 honors Retry-After (seconds or HTTP-date),
with exponential backoff/jitter;401/403 opens a manual circuit. Failed login
clients are closed; automatic redirects are disabled to avoid hidden requests.
No historical GP endpoint is called.

[CelesTrak usage policy](https://celestrak.org/usage-policy.php) and
[GP format FAQ](https://celestrak.org/NORAD/documentation/gp-data-formats.php):
GP source checks occur every two hours; machine clients must stop after non-200
responses for human investigation, including obsolete redirects/errors.
OrbitWatch uses one existing Active-list bulk fallback, filters locally and
reserves >=2h+jitter. No per-satellite downloads. Redirects are not followed;
any HTTP failure opens a persistent manual circuit. Network failures back off.
A human must investigate service/configuration errors before clearing a circuit.
Clear only the `blocked` flag in the local reservation store; preserve `next_at`
so fixing configuration does not bypass the minimum interval/Retry-After.
No actual orbital-provider requests were made by this batch's stress tests.

## Earth imagery

[Cesium content/attribution guide](https://cesium.com/learn/ion/content-usage-and-attribution-guide/)
and [Google Map Tiles policies](https://developers.google.com/maps/documentation/tile/policies)
require attribution and respecting returned cache headers; no arbitrary offline
storage, extraction or bulk prefetch. Existing runtime caches/LOD/request
scheduler and visible-view fetching are retained; hidden/departure preload is
already off. Google endpoint failures have explicit retry/fallback, no recurring
background retries. Browser HTTP caching remains provider-controlled. No
custom proxy, disk tile archive, image analysis of Google content or quota
circumvention is added. Quotas depend on the user's account; monitor its dashboard
and restrict the browser token to approved origins/assets.

[NASA GIBS access documentation](https://nasa-gibs.github.io/gibs-api-docs/access-basics/)
defines advertised dates/matrices. No numeric public quota is assumed here.
Metadata has one-hour successful cache and in-flight deduplication; failures
back off60s→15min (+up to15s jitter) and respect seconds/HTTP-date Retry-After. Time commits coalesce300ms;
changing hour within the same UTC imagery day retains the layer/provider. Root
validation precedes atomic replacement, stale requests cancel, and successful
browser cache headers are respected. Testing used one capabilities read and six
256px root images in the dedicated year probe, with normal limited application
views; no global tile download/grid sweep. No nearest date is relabeled exact.

[OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/)
requires visible attribution, valid Referer and HTTP-cache compliance; no bulk
prefetch/download, scraping or offline use. This browser client uses standard
visible-view requests/cache; it does not force no-cache or strip Referer.
[Esri tile documentation](https://developers.arcgis.com/rest/services-reference/enterprise/map-tile/)
and [Esri terms](https://www.esri.com/en-us/legal/terms/full-master-agreement)
govern Esri imagery; credits remain, requests are only for the active view, and
no invented universal free-use quota is promised. Confirm target-host/account
rights before deployment. [CARTO Basemaps keys](https://www.carto.com/basemaps/apikey/index.html)
are mandatory and origin-restricted; unconfigured styles make no tile requests.
Authorized real-key testing remains blocked until the user supplies the key.
All map gallery options and attribution remain; no access bypass was implemented.

## Measured isolated workload

Ten simulated minutes with six tracked satellites, one selected, actual protected
TestClient routes and temporary accounts/storage: catalog1,status10,telemetry40,
trajectory batches3,full-orbit calls12 = **66 local API requests**. Including the
standard39-request contract suite:105. Tests fast-forward the calculation clock,
not real-provider traffic. Real external orbital-provider requests: **0**.

Production-provider functions with mocked HTTP transports over ten minutes:
Space-Track login 1 + bulk GP 1; CelesTrak bulk 1; no real provider HTTP. The
provider tests exercise each budget independently. Normal successful Space-Track
ingestion does not also request CelesTrak; CelesTrak is the fallback.
Concurrent reservations and four independent subprocesses share exactly one reservation.
Additional tests cover restart/force-style calls,429 Retry-After and persistent
CelesTrak non-200 circuit. These tests measure the protected request architecture;
actual tile counts vary with viewport/camera/provider cache/account and must be
monitored on the deployed host. Existing local read-only bridge accessed Supabase
records, without writes; it never started ingestion/auth account changes.

## Live weather — 23 October2026

Protected `/api/weather/temperature`, `/location` and `/status` use the existing
JWT/DB checks. Weather never changes satellite provider budgets. See
[Weather](WEATHER.md) for scientific metadata, official source terms and cache
semantics. Browser users never contact weather providers directly.

NOAA receives one global1° TMP2m field request, not a full GFS model file. Shared
persisted minimum30min spacing (+jitter),4/hour and32/day caps apply. Open-Meteo
uses2s spacing (+jitter),60/hour and500/day caps, comfortably below published free
noncommercial limits. Failed requests consume reservations; exponential backoff
and Retry-After survive restarts. One OS lease serializes weather HTTP across
same-host workers. No automatic HTTP retries/redirects, startup downloads,
mouse-driven requests or per-user global ingestion exists.

Two global fields and256 point keys form the bounded cache. Point coordinates
round to0.1° and reuse15min records. Browser global polling10min/error30s and
manual30s checks cannot bypass provider gates. Status never downloads. Use one
weather API host with persistent local storage; independent stores multiply
quotas and are not coordinated by a same-host file lock.

**Real weather-data HTTP total:4 (NOAA2, Open-Meteo2).** Each Open-Meteo call
batched three public locations: six location-equivalent calls total. Initial
probes and final NOAA production decode/cache verified genuine contracts. All
stress traffic was mocked; browser used genuine recorded weather through actual
isolated protected APIs with providers disabled. No production account/Supabase
access. Documentation/package downloads are not weather-data API requests. Map
visible-view tiles keep their existing policies and are counted separately.

### Weather cold-start/retry correction (ac36865 follow-up)

Global cold misses now start one background job and return202 plus safe phase and
retry interval, instead of blocking behind a download longer than the frontend's
10s general timeout. No-field cooldown503 responses include the actual shared
provider deadline; frontend timers/reopen/manual checks honor it. Active jobs are
normally checked after3s, healthy fields after10min, offline transport after60s.
The existing NOAA/Open-Meteo spacing/budgets/backoff remain unchanged; safe local
activity diagnostics do not reset gates, call history or fields. Local decoder
preflight occurs before spending a NOAA reservation.

This follow-up made exactly **two new weather-data HTTP requests: NOAA1 and
Open-Meteo1**. The normal cache's cumulative counters moved NOAA1→2 and
Open-Meteo5→6 (earlier calls include the user's own activity). These are separate
from the original isolated batch's4 calls. Repeated UI requests and a backend
restart reused normal data without another download. Failure/stress cases used
only mocks/disposable caches. See [Weather](WEATHER.md) for evidence and the
explicitly unknown original historical failure category.


## Global fields and natural reports (23 October expansion)

`GET /api/weather/fields` is protected, with the same202 preparation /503 safe
cooldown envelope and Retry-After contract as temperature. A200 includes the
original temperature plus instant cloud %, precipitation mm/h and east/north10m
wind arrays in `fields`; valid/init/retrieval metadata is shared. One grouped
NOAA request; existing NOAA/Open-Meteo budgets are unchanged. No Time requests.

`GET /api/events` is protected and read-only.200 supplies usable provider caches
(including legitimate empty results); `state` is available/partial, each provider
has its own freshness/failure/deadline/count/limitation.202 means no cache yet and
jobs preparing;503 means no usable provider cache.401 and database503 retain the
normal auth/DB contract. Response has `events`, `providers`, `generated_at`,
`optional_sources`, `disclaimer`; generated time is not a provider retrieval time.

`GET /api/events/{event_id}` returns a cached normalized report and provider
status, or404 if absent/hard-expired; it does **zero** upstream HTTP. IDs use
`eonet:EONET_…`, `gdacs:TC:…`, `usgs:…`, validated to180safe characters. List already
contains all supported details; clicks do not fan out to source detail services.
All endpoints return private,no-store. No arbitrary URL, bbox, pagination or
provider credential can be supplied by a client. See [contracts and budgets](NATURAL_EVENTS.md).
