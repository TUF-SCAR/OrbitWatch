# OrbitWatch — final-day development journal

Only this Markdown file is updated during final-day batches. Entries record
implementation decisions, commands, evidence and remaining limitations without
credentials or private account information.

## Batch 01 — Live Weather Core (November 1, 2026)

Scope: Live Mode weather controls and the shared global model bundle only.
Started with a clean working tree at `6eee32d`. No commits, pushes, production
migrations, historical downloads, Time Explorer changes or Natural Events changes.

### Implementation and files

- `frontend/src/App.jsx`, `components/OrbitGlobe.jsx`: independent `windEnabled`
  (default OFF), memoized wind field and separate renderer visibility. One
  `useLiveWeather` poller supplies all model fields. Observed Clouds + Wind Flow
  activates that same model bundle without changing observed-cloud ownership.
  Primary selection changes leave wind's field/resource identity stable. Master
  Weather, Live/Earth eligibility, opacity and map compatibility still gate it.
  No existing saved wind preference was found in the current settings contract.
- `data/weatherOptions.js`, `data/liveEarthDefaults.js`, `components/WeatherPanel.jsx`,
  `components/WeatherPanel.css`, `public/weather-previews/{humidity,pressure}.svg`:
  five primary cards (Clouds, Precipitation, Temperature, Humidity, Pressure),
  independent labeled Wind Flow checkbox with ON/OFF/paused state, palettes,
  legends, model provenance and explicit Mean Sea-Level Pressure labeling.
  Coordinate entry and the location interface remain intact. Previews are
  decorative local SVGs, not fabricated weather observations.
- `services/weatherFields.js`, `services/weatherPolling.js`: RH/pressure source
  identity, units and bounds validation; reuse the existing node interpolation,
  imagery owner and missing-node transparency. Missing/malformed optional fields
  are isolated instead of discarding valid core fields. An unavailable optional
  selection is labeled unavailable, while other fields remain usable.
- `backend/services/weather.py`, `weather_fields.py`: add RH and PRMSL to the
  existing single NOAA filter, persistent gate and cross-process lease. Cache
  `bundle_version=2` permits one protected upgrade of older cached bundles;
  optional absence in a version-2 bundle does not cause repeated upgrade calls.
  Optional fields must match the core initialization/valid times, exact global
  360×181 1° geography and instantaneous semantics. At least 95% of nodes must be
  valid; missing nodes stay null. RH is bounded to 0–100%; MSL pressure accepts
  800–1200 hPa, with palette saturation outside 900–1100 hPa. Pa is divided by
  100 exactly once and retained as `source_units`. The original 16 MB/16-message
  caps, download deadline, cache limits and provider policies are unchanged.
- Location `pressure_msl` joins the existing Open-Meteo request, not another
  endpoint/poller. Optional invalid pressure/humidity becomes null. User-facing
  wind speed is km/h (including compatible legacy cached m/s responses), with
  source units retained; global U/V and scientific advection remain m/s.
  `windLayer.js`, advection, primitive, quality/physics budgets, reduced-motion,
  visibility/altitude behavior and teardown were not modified.

### Source and real integration evidence

- Verified [NOAA's GFS 1° inventory](https://www.nco.ncep.noaa.gov/pmb/products/gfs/gfs.t00z.pgrb2.1p00.f003.shtml),
  [ecCodes PRMSL identity](https://codes.ecmwf.int/grib/param-db/260074),
  [NOMADS filter](https://nomads.ncep.noaa.gov/gribfilter.php?ds=gfs_1p00) and
  [Open-Meteo GFS variable documentation](https://open-meteo.com/en/docs/gfs-api).
- One actual bounded, quota/lease-protected NOAA GET returned
  `20261101/gfs.t00z.pgrb2.1p00.f006`: **687,607 bytes, 10 GRIB messages**,
  initialized 00:00 UTC and valid 06:00 UTC. No limit increase was necessary.
  ecCodes confirmed `2r / heightAboveGround / 2 / % / instant` and
  `prmsl / meanSea / 0 / Pa / instant`. RH range 7.7–100%; pressure
  951.315–1039.334 hPa; both have 65,160 correctly mapped nodes. Averages are
  ignored. Raw GRIB/checksum/signature and decoding evidence remain locally in
  ignored `backend/.runtime/weather-batch01`; the authentic decoded bundle was
  placed in the normal bounded weather cache for reuse, without redownloading.
- Real authenticated FastAPI `/api/weather/fields` returned both new fields,
  temperature and original clouds/rain/U/V. Four repeated cached reads spent
  zero additional NOAA requests. One protected Open-Meteo request at the public
  test coordinate (0°,0°) returned pressure 1014.3 hPa, humidity 85%, wind
  23.94 km/h (source m/s), valid 08:30 UTC. No auth records were changed.
- Real app smoke, existing signed-in session: Clouds remained selected with one
  observed imagery layer while wind became active. Wind OFF released particles
  and GPU resources without changing the cloud frame; Humidity and Pressure
  each rendered with Wind ON, one primary imagery owner and one wind primitive.
  Master Weather OFF removed both and ON restored both. Atmosphere/lighting
  flags and six existing Live entities remained present. The device requests
  reduced motion, so real browser flow was correctly still; moving advection
  was verified by the existing automated wind tests, not claimed visually.
- Narrow-screen check: 390×844 viewport, document scroll width 390, weather
  panel x=78..378 (300 px), no horizontal overflow; internal panel scrolling
  keeps all five cards, toggle and controls reachable. Viewport reset afterward.

### Commands and validation

- Temporary runtime: `.venv/Scripts/python.exe -m uvicorn main:app --host
  127.0.0.1 --port 8000` from backend, with process-only
  `ORBITWATCH_INGESTION_ENABLED=false`; frontend `npm run dev -- --host 127.0.0.1`.
  Provider/real-API scripts used the same venv and existing environment configuration.
- PASS `python tests/check_weather_fields.py`: real ecCodes-generated GRIBs,
  strict core contracts, RH/PRMSL identity and Pa conversion, longitude/latitude
  mapping, bitmap missing node, optional range/time/duplicate isolation.
- PASS `python tests/check_weather_location.py`: optional location units/ranges,
  humidity preservation, m/s→km/h and legacy-cache conversion without mutation.
- Focused frontend command: `node --test tests/weatherControls.test.js
  tests/weatherFields.test.js tests/weatherUi.test.js tests/weatherPolling.test.js
  tests/weatherVisuals.test.js tests/windLayer.test.js`. Initial result 25/26;
  the new combined-owner test incorrectly compared a renderer to its old
  reference after deliberately toggling OFF/ON. Corrected that test sequence;
  targeted `weatherControls.test.js` rerun **2/2 passed**. All 26 distinct focused
  checks now pass, including reduced/hidden/off cleanup, wind physics/budgets,
  primary-owner preservation, altitude fade, incompatible-map removal, optional
  field handling and poller retry protection. This was not a full frontend suite.
- PASS `npm run lint`, final affected-file ESLint, `npm run build`, Python
  compileall and `git diff --check`. Build retains the existing large-chunk
  warning; no unrelated bundling changes were made.
- `python tests/check_weather.py` did **not** fully pass: geometry/units,
  concurrent persistent quotas, location/cache/failure recovery and DB gates
  passed; cold-worker `pending.result(timeout=5)` then timed out at line 161,
  followed by Windows `download.lock` temporary-directory cleanup failure.
  This same timing/cleanup issue was reported before this batch. No success is
  claimed for its remaining asynchronous section. The failed test's exact
  temporary directory was removed after process completion; no existing backup
  folders or other test data were deleted.

### Handoff

New real model calls for this batch: **NOAA 1; Open-Meteo 1**. Cached API reads
and primary-variable/Wind toggles did not add NOAA requests. Existing observed
cloud polling/cache remains its separate original service. No provider gates
were reset, and no Supabase storage/schema changes were made; weather storage
is the bounded local SQLite cache (measured **5,640,193 → 6,463,489 bytes**,
an 823,296-byte increase). Local source/evidence files occupied about 693 KB,
including the original 687,607-byte GRIB. Temporary verification servers were
stopped and the browser tab closed. Only this approved Markdown file was
created/modified. Next agent: preserve independent wind ownership and optional
field isolation; keep all source/display units explicit. Earth click-to-inspect,
label snapping and location-aware labels are deliberately left for Batch 02.

## Batch 02 — Earth Weather Inspection

Starting tree was clean at `5edc168`. Scope: Live Earth location picking and one
shared location-weather inspector, plus the explicitly requested legacy test fix.
Batch 01's fields, independent Wind Flow and renderer/provider lifecycle remain
intact. No production backend service, migration, historical data, authentication,
Natural Events ingestion, satellite propagation or planetary travel was changed.

### Files and interaction design

- `frontend/src/components/OrbitGlobe.jsx`, `services/earthWeatherPicking.js`:
  extend the existing Cesium LEFT_CLICK handler; no second click handler or
  Viewer. Events, celestial objects and satellites retain priority. Terrain/globe
  ray picking supplies ordinary surface coordinates; depth is accepted only from
  the current Google tileset feature, never a satellite/label/marker. An ellipsoid
  fallback handles missing terrain. Nonfinite/non-Earth heights are rejected.
  Empty space clears the selection. Active satellite Follow is retained for
  surface inspection. View Centre uses this same surface-picking helper.
- The existing pointer tracking suppresses drag, wheel, cancelled/pinch gestures.
  One 350 ms surface-click gate disambiguates mouse double-click/touch double-tap;
  UI gestures, travel/mode eligibility changes and teardown cancel pending clicks.
  Existing celestial double-click behavior remains in its original handler.
- `services/placeLabelLayer.js`, `placeLabelLayout.js`: selectable metadata and
  current screen projection of actually shown, unobscured city labels; snap
  radius 24 CSS px. Countries and hidden labels never snap. The interface accepts
  `state` for the next batch, without adding any state/province dataset. Native
  raster map text has no selectable metadata; ordinary surface coordinates are
  used there rather than guessing which labels the provider rendered.
- `services/weatherLocationMarker.js`: one small depth-tested point entity,
  updated in place and removed on deselection/teardown. It owns no camera or
  click listener and is not treated as satellite geometry.
- `utils/useLocationWeather.js`, `services/locationWeatherSelection.js`,
  `services/orbitwatchApi.js`: one request/selection owner in App. New locations
  clear previous readings immediately; AbortController plus generation checks
  reject superseded responses even if the transport ignores cancellation.
  Responses must match selected coordinates within the backend's 0.1° cache
  rounding. A 250 ms debounce and 2.1 s spacing bound rapid requests. Location
  429/503 Retry-After is retained, with explicit waiting/unavailable UI and
  user-triggered retry. No automatic location poller or NOAA refresh is added.
- `App.jsx`, `components/LocationWeatherCard.jsx`, `components/WeatherPanel.jsx`,
  `components/WeatherPanel.css`, `utils/weatherFormatters.js`: floating card and
  Weather panel read the same owner and content. Removed coordinate editing/GET
  WEATHER; kept View Centre through the shared owner. Card includes condition,
  temperature/feels-like, humidity, km/h wind, expandable cloud/rain/direction/MSL
  pressure, source/UTC validity and missing-value handling. Marker and transient
  requests clear on leaving Live Earth or presentation. Closing Weather preserves
  selection; on compact widths the panel shows the shared reading and closing it
  reveals the independent card. Escape/Close dismiss it. New weather selections
  free the left search/explorer area; the Weather panel stays open. Left weather
  legends temporarily yield their occupied space to the card.

### Legacy test fix and verification

- `tests/check_weather.py`: measured generated GRIB fixture construction at
  1.480 s and decoding at 1.280 s before cache work, making the old five-second
  combined worker deadline fragile under load. Prebuild the fixture outside the
  blocked worker; preserve all cold-response latency, concurrent-one-download,
  quota, failure, cooldown and recovery assertions. Bounded 30 s Future/Event
  synchronization replaces the five-second worker waits; no sleeps were added.
  Workers drain before mocked dependencies are restored, and ExitStack closes
  TestClient/executor/engine before TemporaryDirectory removes Windows files.
  The full affected test **passed twice**, including the final cleanup version;
  HTTP0, no Windows lock-file cleanup failure. Production weather code unchanged.
- Added `frontend/tests/earthWeather.test.js` and `locationWeatherUi.test.js`.
  Final focused command: `node --test tests/earthWeather.test.js
  tests/locationWeatherUi.test.js tests/placeLabels.test.js
  tests/weatherControls.test.js tests/weatherUi.test.js tests/orbitwatchApi.test.js`:
  **22/22 PASS**. Covers raster/Google-depth selection, 24 px city/state versus
  country/hidden labels, object priority/Follow, gesture cancellation, replacement,
  late/mismatched responses, closing/destroy, debounce, Retry-After, marker reuse,
  zero/missing values, km/h/UTC, shared rendered card/panel and removed inputs.
  Existing Batch 01 owner, altitude fade, incompatible-map and auth tests pass.
- Build passed; React purity lint initially rejected clock reads during render.
  Moved event timestamps into owner notifications and retained the effect-driven
  clock. Targeted lint passed after this correction; final full lint/build status
  is recorded below. No rules were disabled.

### Actual runtime evidence and limits

The temporary real FastAPI app ran from `.venv` with process-only ingestion OFF,
and real Vite ran at 127.0.0.1:5173. The existing signed-in session restored Live
Earth, six satellite entities and observed Clouds. Two browser gesture attempts
failed in the automation connection (CDP dispatch/frame-tree timeouts). A fresh
screenshot confirmed no location had been selected. Therefore real click-to-API,
city snapping, Google tiles and mobile input/overflow are **not claimed as
browser-verified**; their focused tests/code checks passed. No fixture was
substituted into the real browser. Responsive bounds and shared-panel behavior
are implemented but still need a real-device smoke check when input is available.

Next agent/reviewer: first run real raster clicks, visible-city snapping,
double-click/drag, replacement and close/panel persistence; then Google depth
and mobile touch. Preserve the shared owner, existing-handler priority and label
metadata interface when adding worldwide states/weather-aware labels in Batch
03. No state dataset or weather measurements on map labels were added here.
Only this Markdown file was modified. No commits or pushes were made.

Final Batch 02 checks: **full ESLint PASS, production build PASS, 22 focused
frontend tests PASS, complete legacy backend weather test PASS, diff whitespace
check PASS**. The existing large-bundle build warning remains. Real browser input
verification is the outstanding limitation described above. The provider audit
stayed NOAA **1 → 1**, Open-Meteo **1 → 1**, with local weather cache unchanged
at **6,463,489 bytes**; no new NOAA/Open-Meteo requests or storage writes were
needed for this batch's checks. Temporary API/Vite servers were stopped and
their ports verified closed; the verification browser tab was closed.

## Batch 03 — Worldwide Weather-Aware Labels

Starting commit: `7feb5ac081219a5932c2e59ff09090f741d0f851`. Completed on
2026-11-01. This batch changes place labels and their existing weather inspector;
historical propagation, satellite collections and Natural Events were not expanded.

### Geographic source, processing and coverage

- Natural Earth public-domain **1:10m Admin-1 Label Points**, linked from the
  [official Cultural Building Blocks page](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-cultural-building-blocks/).
  The portal advertises **5.1.0**, but the actual downloaded archive's
  `ne_10m_admin_1_label_points.VERSION.txt` says **5.0.0-pre9**. Both versions are
  recorded explicitly; the archive is not relabeled as 5.1.0.
- Original ZIP: [Natural Earth NACIS CDN](https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_label_points.zip),
  396,423 bytes, SHA-256
  `d39e236e2a0104427760a41a1a95714f3121a4d04339865a0c3910c3156a4bdb`.
  Cached locally at `backend/.runtime/admin1-source/ne_10m_admin_1_label_points.zip`.
  Bundled runtime data and provenance are in `frontend/src/data/admin1Labels.js`;
  browser label rendering makes no geographic-data requests.
- The stdlib-only `frontend/scripts/prepare_admin1_labels.py` verifies Point
  geometry, WGS84 projection, UTF-8 attributes and matching geometry/record counts.
  It keeps original supplied coordinates, rounded to six decimals, and deduplicates
  `adm1_code` by provider admin-0 scale rank, label scale rank, data rank and record
  ID. No polygon centers, averaged island positions or guessed parents are used.
  Parent names and ISO2 codes are preserved; negative/missing ISO2 values fall back
  to the supplied admin-0 code, rather than merging every such region under `-1`.
- **11,291 raw points → 4,550 unique named subdivisions**, across **221 source
  country/territory codes**, with source scale ranks 2–11 retained. Removed 5,540
  duplicate points, 1,199 raw missing/coded-placeholder name or parent records and
  two uncertain provider IDs. Initial validation caught `+99?` minor-island
  aggregates that did not match their coded name spelling; the importer was
  corrected instead of weakening the data test. Genuine named rank-11 units remain.
- Coverage tests include Telangana, California, Ontario, New South Wales,
  São Paulo, Bayern, Gauteng, Guangdong and Pohnpei, plus an exact California
  source-point regression. These are source administrative units, not 221
  sovereign countries. Natural Earth's reference geography, naming, administrative
  granularity and update age remain limitations; omitted aggregates/microterritories
  are not filled with invented state points. See also its
  [Admin-1 coverage notes](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/).

### Snapping and rendering

- Snapping now measures distance to the measured screen text rectangle, including
  all displayed name/weather/wind rows, with a 24 CSS px outside margin. Actual
  hits win before outside hits, then center distance and stable ID break ties.
  Hidden, occluded, fully offscreen, outside-LOD, suppressed and country labels
  cannot snap, including labels clipped between camera-layout ticks.
  The existing event/celestial/satellite click priority and single gesture gate
  still run before place/surface selection.
- One existing Cesium LabelCollection now owns a reusable pool of at most **45
  three-row slots / 135 Label objects**, with at most **45 visible groups on
  desktop or 28 below 600 px**. Resizing may retain hidden desktop slots. Text is
  measured with Canvas metrics and centered row offsets; collision boxes grow or
  shrink with actual content. Country, city and state font/rank hierarchy, horizon
  occlusion, altitude visibility, deterministic priority and retained-label margins
  limit crowding and jitter. Layout cadence remains 200 ms. No Viewer remount or
  label animation loop is introduced.
- Existing label toggle and native-text suppression remain: Bing labeled/road,
  OSM and Carto labeled basemaps do not get duplicate custom labels. Native imagery
  text is not claimed to be interactive. Google/incompatible maps show no label
  weather; the existing location inspector and compatibility guidance remain.
- Real raster-ocean clicks exposed a Batch 02 bug: a trusted `globe.pick` point
  had height -13,532.64 m from bathymetry/coarse wide-view mesh chord error, and the
  old -1,500 m rejection discarded it. Trusted globe/ellipsoid hits now accept
  finite heights. Only verified current Google-tile depth can be used as depth,
  with invalid high/low tile depth falling back to the globe. Satellite depth is
  never used. Regression tests cover the observed negative-height case.

### Weather ownership, validity and inspector

- `placeLabelWeather.js` reuses validated temperature/model-grid selection and
  interpolation from the existing authenticated GFS bundle. The same single
  `useLiveWeather` owner can supply modeled clouds even when observed IR is the
  primary map. There is no per-label Open-Meteo call, provider or poller.
- Readings are cached by bundle identity, variable, Wind/master/compatibility/mode
  controls and freshness classification. Clock-only frames reuse results; freshness
  boundaries invalidate the cache. Validation and interpolation do not repeat on
  each render. Cache entries are bounded by the fixed bundled place records.
- City/state rows show °C, model cloud %, modeled precipitation **Rate mm/h**,
  humidity % or **MSLP hPa**. Independent Wind adds `hypot(U,V) * 3.6` km/h and
  disappears/reclaims layout when OFF. Missing optional fields/nodes omit their
  rows. Stale rows say `cached`; hard-expired readings disappear. Master OFF,
  incompatible maps, leaving Earth and Time mode suppress weather readings.
  Countries always remain name-only.
- Shared legends/panel disclose GFS, the 1° modeled grid and valid UTC time.
  Cloud percentages are explicitly separate from observed infrared imagery;
  IR brightness is never converted into a percentage. The final wording also
  remains accurate when observed imagery falls back or is unavailable. No claim
  of street-level resolution or improved scientific precision is made.
- State selection retains stable ID, kind, parent and representative coordinate.
  Card/panel identify state/province and country and explain that the reading is
  for the representative point, not an administrative-area average. Location API
  ownership, abort/debounce, cooldown and late-response handling stay unchanged.

### Verification and actual runtime evidence

- Final focused frontend run: `node --test --test-concurrency=1
  tests/placeLabelWeather.test.js tests/earthWeather.test.js tests/placeLabels.test.js
  tests/weatherControls.test.js tests/weatherFields.test.js
  tests/locationWeatherUi.test.js tests/weatherUi.test.js tests/orbitwatchApi.test.js`:
  **33/33 PASS**. Covers geographic validity/classification/ranks, long/multiline
  edge hits and deterministic exclusion, every field's units, independent signed
  U/V wind, optional/missing/stale/expired fallbacks, no label fetches, 300 stable
  cache iterations, bounded slot reuse across 30 pans, narrow collision limits,
  names-only Time mode, state/country inspector markup and existing object/event
  priority, request lifecycle and overlay ownership. The initial source assertion
  failed on uncertain IDs; importer correction and final rerun passed.
  The final offscreen-hit guard was followed by another **7/7** label-test pass
  and full lint/build rerun.
- **Full ESLint PASS; production build PASS** (2,104 modules). Existing >500 kB
  bundle warning remains; one build also reported external-globals plugin timing.
  Rebuilding the data with `.venv/Scripts/python.exe` and the cached ZIP produced
  a byte-identical JS hash: **deterministic rebuild PASS**. No production backend
  code changed; this batch used actual protected API requests rather than rerunning
  unrelated backend suites. Final diff whitespace and Markdown-scope checks passed.
- Actual authenticated IAB session, 1280×720: real ocean click opened
  -2.57°, 71.67° and loaded 28.4 °C; another point replaced it; visible Kolkata
  snapped to 22.57°, 88.37°; Close worked; isolated real drag and true Playwright
  double-click produced no unwanted inspector; HST 20580 selected its satellite
  inspector. These complete the bounded outstanding Batch 02 raster interaction
  smoke. Some later native coordinate inputs/AX reads timed out under host load;
  a recovered DOM/Playwright connection worked. No synthetic browser weather was
  substituted.
- Expanded labels: observed-IR map plus modeled cloud percentages and independent
  wind were displayed (for example Telangana cloud 82%, wind 13 km/h, source valid
  09:00 UTC). Switching to Temperature and Wind OFF removed wind rows. Clicking
  the real globe near the Chhattisgarh label opened **21.80°, 82.31° · India**,
  identified it as a state/province representative point, and loaded **28.9 °C,
  humidity 57%, wind 3.71 km/h, valid 10:15 UTC** through the existing inspector.
  Map-label 1° GFS samples and the separately requested location endpoint are
  different resolutions/valid times and need not be numerically identical.
- Narrow **390×844**: Weather controls opened successfully and document scroll
  width equaled viewport width (390 px). Real Time Explorer switch showed 18
  visible country/city/state labels with **one name row each**, primary/wind
  sampling inactive and zero weather imagery layers. Returned to Live afterward.
  Saved desktop, narrow and state-inspector PNGs in the approved visualization
  workspace. Physical mobile touch/pinch, real Google depth and a real event-marker
  click were not browser-tested; focused owner/priority tests cover those routes.
- Persistent weather cache audit after testing: NOAA **2**, Open-Meteo **7**
  retained calls; two shared global cache rows, 12 location rows; SQLite file
  **7,352,320 bytes**. Current shared bundle valid **2026-11-01 09:00 UTC**, retrieved
  **10:01:18 UTC**, contains all five additional fields. Open-Meteo requests were
  explicit inspector selections, not state-label population. No provider gates or
  history were reset. Later source/network errors retained honestly marked cached
  weather/observation frames; these were not treated as fresh observations.

### Files and handoff

New: `frontend/scripts/prepare_admin1_labels.py`, `frontend/src/data/admin1Labels.js`,
`frontend/src/services/placeLabelWeather.js`, `frontend/tests/placeLabelWeather.test.js`.
Modified: `frontend/src/App.jsx`; components `OrbitGlobe.jsx`, `MapSettings.jsx`,
`WeatherPanel.jsx`, `ObservedClouds.jsx`, `LocationWeatherCard.jsx`; services
`placeLabelLayer.js`, `placeLabelLayout.js`, `earthWeatherPicking.js`,
`weatherFields.js`; tests `earthWeather.test.js`, `locationWeatherUi.test.js`;
and this journal only.

Limits/handoff: data is Natural Earth reference geography with the archive-version
discrepancy above; weather remains a 1° model point sample. Native baked-in labels
do not gain individual interactivity. A physical mobile/touch and Google/events
smoke can be done later without changing the shared owners. Existing stale orbital
feed and intermittent runtime network/IR image errors remain outside this batch.
No Time Explorer weather, notifications or Natural Events expansion was started.
Temporary `.venv` API/Vite servers were stopped, ports 8000/5173 verified closed,
viewport reset and temporary browser tab closed. Only `docs/FINAL_DAY_DEVLOG.md`
was changed among Markdown files. **No commits or pushes. Stop after Batch 03.**

## Batch 04 — Account Notification Foundation

Starting commit `5a3545d10fa1a8d1a4c7b161e5f432327d146b28`; completed 2026-11-01.
This batch adds persistent saved observation locations and future alert
preferences only. Auth implementation, historical propagation, worldwide labels,
shared weather sampling, independent Wind and existing object/event interactions
are preserved. No scheduler, visibility predictions, subscriptions, inbox,
notification delivery or browser push permission flow was implemented.

### Persistence, isolation and API

- Added SQLAlchemy `ObservationLocation` and `NotificationPreferences` in
  `backend/models/account.py`, strict schemas in `backend/schemas/account.py`,
  and authenticated routes in `backend/routes/account.py`. Ownership comes only
  from the existing `get_current_user`; submitted owner IDs/extra fields are
  rejected. Foreign location IDs return the same 404 as missing IDs. Existing
  `models/user.py`, auth routes, security and database/session implementation
  were not edited.
- Endpoints: `GET/POST /api/account/locations`,
  `PUT/DELETE /api/account/locations/{uuid}`, and
  `GET/PUT /api/account/notification-preferences`. Updates require
  `expected_version`; deletion takes that version in the query string. CORS
  adds only PUT and DELETE to existing methods, preserving explicit origins.
  Account responses use `Cache-Control: no-store`.
- Location IDs are backend-generated UUIDs. Names trim to 1–80 characters and
  reject control characters. Coordinates must be finite JSON numbers in inclusive
  ±90/±180 bounds and are stored as fixed six-decimal numerics. IANA timezones
  are validated with `ZoneInfo`; Windows deployment explicitly requires the
  already-locked `tzdata==2026.5`. No timezone, parent or coordinates are guessed.
- A private slot 1–5 plus unique `(owner_id,slot)` enforces five locations in
  the database. Unique owner/coordinate pairs prevent duplicates; an identical
  POST retry returns the existing row (200) without resetting its default.
  A conflicting name/timezone at those coordinates returns 409 for explicit edit.
  A partial unique owner index enforces at most one default. First location
  becomes default automatically; deleting it selects oldest `created_at`, then
  UUID. The current default cannot simply be unchecked; select another instead.
- Mutations lock the existing owner row with PostgreSQL `FOR UPDATE`, serializing
  caps/default changes and preference writes across processes. Versions reject
  stale edits rather than silently overwriting concurrent changes. User foreign
  keys cascade only the new account data when a user is removed. Numeric/rank,
  text length, warning/radius, quiet-hour and version constraints are also in SQL.
- Preference defaults are all OFF; GET returns virtual safe defaults without
  inserting a row. Fields include master, satellite, planet/Moon and natural-event
  categories, 10/30/60-minute warning, bounded event radius, optional local quiet
  times, timezone source and timestamps. Default API radius cap is 500 km;
  `ORBITWATCH_MAX_EVENT_RADIUS_KM` may set 1–2000 km, within the SQL hard ceiling.
  Previously stored values remain visible if the API cap is later tightened,
  but new writes must satisfy the configured cap.
- Quiet hours follow the default saved location timezone or an explicit valid
  IANA timezone. Overnight times may be stored; no evaluator runs yet. Enabled
  quiet hours require different valid start/end times and a usable timezone.
  Deleting the last default-source location disables quiet hours and increments
  preference version; explicit-timezone quiet hours remain independent. Disabled
  quiet hours can retain an incomplete optional draft without guessing a timezone.
- Missing/partially applied account tables produce a sanitized 503
  `account_feature_unavailable`. Account SQL failures are caught before the shared
  database dependency can poison existing auth/Live readiness. No SQL/coordinate
  payloads or credentials are logged by these routes.

### Frontend behavior

`AccountNotificationSettings.jsx`/`.css` integrate into the current Profile &
Settings scrolling panel, with location list, explicit add/edit/default/remove
actions, removal confirmation, four toggles, warning/radius and quiet-hour controls.
The UI explicitly says scheduling/live delivery are not active and these choices
do not grant push permission. No fake unread badge or notification bell was added.

`accountSettings.js` owns single-flight writes, loading/saved/error/unavailable
states, version conflicts and retries. Drafts stay in memory through profile
close/reopen and failed requests; reloading versions merges untouched fields with
server changes while retaining edited fields. In particular, a server-side quiet
hours reset is reflected without discarding an unrelated unsaved preference.
New place/edit intents cannot silently replace an existing editor. Each
authenticated App gets a separate owner via `useAccountSettings.js`; logout
aborts pending work, clears private state and ignores late results. These values
are not stored in browser localStorage. Refresh/login restore them through the API.

The Live weather card's **Save this location** copies the chosen point into the
same account editor, closes the weather card, and requires an explicit timezone
and Save action. It does not persist on globe click. The five-location bound is
shown in the list and also applies to a weather-seeded form. Existing transport
authentication is reused, including preserving valid sessions on feature 503s.

### Migration, production status and storage

Migration: `backend/migrations/002_account_notification_foundation.sql` is explicit,
transactional and idempotent, following migration 001. It creates only the two
new tables/indexes, enables RLS without browser policies and revokes PUBLIC table
privileges. Application startup imports models/routes but executes no DDL and no
`create_all`. Existing auth/satellite/historical tables are neither dropped nor
recreated in production.

**Applied only to disposable local PostgreSQL 17.6**, including repeated runs
before and after fixture data. Verified the Maven Central test-binary SHA-256
`c91d39b6db91cf8811e3b20d941e74a0396e277360873821daab47cdb4c1282c`
(23,239,913-byte archive; [upstream test distribution](https://github.com/zonkyio/embedded-postgres-binaries)).
The fixed loopback cluster/database used port 55434 and `orbitwatch_account_test`;
the harness never loads production `.env`. SQLite checks create only isolated
temporary schemas, not the PostgreSQL migration.

**Production Supabase was not migrated.** A read-only transaction measured
`pg_database_size(current_database())` at **12,979,347 bytes** and confirmed both
new public tables absent. No production test accounts or account-feature writes
were created. The current production database is therefore **not ready for these
new endpoints**; existing auth/Live remain usable and the new UI shows feature
unavailability until deployment.

Disposable PostgreSQL measurements (bytes):

| Stage | Entire test database | Two foundation relations, including indexes |
| --- | ---: | ---: |
| Before migration | 8,244,371 | 0 |
| Empty migration | 8,367,251 | 40,960 |
| Small populated/constraint fixture | 8,424,595 | 98,304 |

The empty migration increased that test database by **122,880 bytes**; the small
fixture's total increase was **180,224 bytes**. For deployment planning, budget
1 MB initially plus a few KiB per account at the five-location maximum; this is
an estimate, not a production migration measurement or an unlimited-growth claim.
Against the published [Supabase Free 500 MB database allowance](https://supabase.com/pricing),
the measured logical production size plus that 1 MB budget would leave roughly
486 MB, comfortably above the required 200 MB reserve. Actual project plan,
dashboard usage and current headroom must still be checked at deployment; no
billing/quota setting was changed.

Required production step: obtain fresh explicit user authorization, verify the
200 MB reserve, apply/review migration 002 using the backend database role, then
deploy backend/frontend (install pinned tzdata if absent) and run authenticated
account CRUD/preferences smoke checks. **Do not run create_all on production.**

### Executed verification

- `.venv/Scripts/python.exe tests/check_account_foundation.py`: **74 HTTP checks
  PASS** against temporary SQLite. Real unmodified registration/login/JWT, two
  independent users, cross-owner 404s, CRUD, defaults/fallback, duplicates, five
  slots, bounds/IANA/name validation, preferences/quiet hours, stale versions,
  foreign keys/cascades, missing-schema isolation, no startup DDL, CORS and absence
  of foundation push/delivery calls were exercised.
- Same harness with `--postgres`: **77 HTTP checks PASS**, plus eight concurrent
  creates yielding exactly five 201s and three 409s, competing default choices
  retaining one default, and competing preference writes yielding one 200/one 409.
  Migration reapplication preserves rows. Direct SQL checks prove database slot,
  coordinate/default uniqueness, bounds, FK/cascade and preference constraints.
  A granted non-owner browser test role sees zero rows under RLS. An initial test
  reporter Decimal serialization error was fixed; a local filesystem-size probe
  later hit its 8 s limit under host load. Only that test metadata probe now has
  a 30 s local timeout; final PostgreSQL run passed. API timeouts are unchanged.
- Existing `tests/check_backend_contract.py`: **39 real API checks PASS**.
  `tests/check_reliability.py`: **26 API checks + 40 concurrent outage requests
  PASS**, including closed-port startup, recovery, preserved auth and sanitized
  errors; external provider calls 0 in that suite. Python compile checks passed.
- Final frontend: `node --test --test-concurrency=1 tests/accountSettings.test.js
  tests/accountSettingsUi.test.js tests/orbitwatchApi.test.js
  tests/locationWeatherUi.test.js tests/placeLabelWeather.test.js
  tests/earthWeather.test.js tests/weatherControls.test.js`: **28/28 PASS**.
  Includes actual account actions/failed drafts/double-submit guards, untouched-field
  reconciliation, logout/late-result isolation, missing-feature transport, rendered
  controls and existing weather/label/object priority regressions.
- **Full ESLint PASS (no warnings); production build PASS**, 2,108 modules.
  Existing large-chunk warning remains; Vite also reports external-globals plugin
  timing. Diff whitespace and Markdown-scope checks passed.
- Genuine browser smoke used real app/auth with the disposable PostgreSQL schema,
  API on 8001 and Vite on a separate **127.0.0.1:5174** origin, preserving the
  production browser session. Existing login as test user one, explicit point
  add/default at synthetic 10°,20°/UTC, preference toggles, 30-minute warning,
  120 km radius, 22:00–07:00 default-zone quiet hours, Save, and browser refresh
  all succeeded and restored saved values. Logout/login as test user two showed
  only that user's five different locations/preferences and a disabled Add button.
  No push prompt or alert was emitted. Saved location/preference screenshots are
  in the approved visualization workspace. No production browser writes occurred.
  Missing-schema UI/failure paths were tested through API, controller and rendered
  component tests; production missing-schema browser interaction is not claimed.

### Changed files and handoff

New: backend `models/account.py`, `schemas/account.py`, `routes/account.py`,
`migrations/002_account_notification_foundation.sql`; frontend
`components/AccountNotificationSettings.jsx`/`.css`, `services/accountSettings.js`,
`utils/useAccountSettings.js`, `tests/accountSettings.test.js`,
`tests/accountSettingsUi.test.js`; `tests/check_account_foundation.py`.
Modified: `backend/main.py`, `backend/requirements.txt`, frontend `src/App.jsx`,
`components/ProfilePanel.jsx`, `components/LocationWeatherCard.jsx`,
`services/orbitwatchApi.js`, and this journal. No other Markdown file changed.

Temporary browser/API/Vite and PostgreSQL test processes were stopped; ports
8000/8001/5173/5174/55434 were verified closed. Known limits: production deployment
is pending explicit migration authorization; storage measurements are logical SQL
sizes and future account growth needs monitoring. Physical touch, Google 3D and
real event-marker integration remain on the accepted final integration checklist.
Future subscriptions/inbox work is a separate batch; this foundation deliberately
emits nothing. **No commits or pushes. Stop after Batch 04.**

## Batch 05 — Subscriptions, Inbox & Supabase Activation

Handoff repaired in Batch 06 after inspecting committed implementation (8d5395f9).
Implemented authenticated subscriptions, canonical 143-satellite/eight-celestial/
13-event validation, private bounded inbox, trusted deduplicating writer, account
controller, four account tabs, Skywatch cards and notification centre. Key files:
backend models/schemas/routes alerts, services account_targets/account_inbox,
apply_account_migrations.py, migrations 003/004; frontend MySkywatch,
NotificationCentre, AccountTabs, AccountWorkspace.css and accountSettings/API wiring.

Genuine preceding local execution evidence: migrations 002–004 were applied to
configured Supabase fingerprint 91629c91746ef7a1 in one additive transaction.
SQL database bytes were 12,979,347 before and 13,184,147 after (+204,800), leaving
486,815,853 against nominal 500 MB; legacy counts unchanged (five users, 143 live
satellites, zero history, 1,019 archive). No production notifications were seeded.
Executed checks: SQLite 101 HTTP checks; disposable PostgreSQL 119 HTTP checks;
14 focused frontend tests; ESLint and production build passed. Fixed UTC read
serialization and SSR dependency scanning. Browser setup began but completed
visual verification was not recorded; no successful Batch 05 browser smoke is
claimed. Production authenticated verification output was not retained in the
handoff, so Batch 06 rechecks it. Scheduled delivery and push remain absent.

## Batch 06 — Visibility Predictions

Completed on 2026-11-02; starting HEAD 8d5395f9db5eeb237b6c30a1db0172bd74dad689.
Repaired missing Batch 05 entry first. Rechecked configured Supabase fingerprint
91629c91746ef7a1: all four account tables from migrations 002–004 exist with RLS;
column compatibility verified. No migration was missing, so no DDL was repeated.
Seven real authenticated auth/readiness/account GETs returned 200. Both new
visibility endpoints returned the expected 409 for an existing account without
saved locations. Database measured 13,192,339 bytes before and after read-only
verification, leaving 486,807,661 bytes of nominal 500 MB; normal 300 MB and
emergency 400 MB ceilings remain untouched. Legacy counts remain 5/143/0/1019.
No production records, inbox entries, provider budgets or tables were reset.

New backend services visibility.py / visibility_forecast.py and routes/visibility.py
provide authenticated GET /api/account/visibility/satellites and /celestial.
Owned saved UUID location, optional followed canonical target, 1–48 hour horizon,
20/8 target caps; default location selected server-side. Current orbital table only,
no historical fallback or Space-Track access. Skyfield 1.55/SGP4 find_events groups
rise/set with multiple culminations and clipped-window handling; exact culmination
candidates plus 241 samples/pass find maxima and screened useful segments. Reject
missing, invalid/mismatched or >7-day-old elements. Seven days is a conservative
screen, not an accuracy guarantee. Sun <= -6 degrees and altitude >=10 degrees
screen satellite opportunities; eclipse is calculated separately; brightness is
explicitly unverified. Local times use saved IANA zones including DST.

Installed pinned skyfield-data==7.0.0 (17 MB local file storage, separate from DB).
DE421 is locally loaded only after SHA-256 verification:
a20a7139da04cbc462454634918e9a9ca69127044e2cc9d4f9c16e238d2deedc.
No startup/request kernel downloads. Missing/corrupt/out-of-range ephemeris yields
unavailable calculations. Built-in Skyfield timescale is used, not the package's
expired finals2000A data. Eight celestial targets use topocentric apparent DE421
positions, rise/set transitions, RA/declination, 120-second altitude/twilight
screening and Moon illumination. Moon screening allows Sun<=0; planets <=-6.
Uranus/Neptune carry telescope wording. No terrain/refraction or brightness model,
and no naked-eye guarantee. Scientific references reviewed:
https://rhodesmill.org/skyfield/earth-satellites.html and
https://rhodesmill.org/skyfield/api-position.html.

Prediction RAM cache: 256 entries, five-minute forecast buckets, exact observer,
IANA zone, target, TLE digest/epoch and horizon; two concurrent calculations;
six-second between-target processing budget with honest per-target deferral;
maximum eight opportunities/target. API releases DB transaction before calculation.
Forecast service uses one 72-hour hourly dataset/location, 60 KB/96-row ceiling,
one-hour shared persistent cache and existing cross-process weather lease. It
reserves the SAME open_meteo gate (60/hour, 500/day), with existing backoff and
Retry-After accounting; no quota resets or immediate retries. Requests are bounded
by connect/read timeout and streaming deadline. No forecast request for windowless
astronomy. Nearest hourly valid time must be within 30 minutes; stale datasets and
current weather are never substituted. Terms/pricing reviewed at
https://open-meteo.com/en/pricing and variables at https://open-meteo.com/en/docs;
free service is for non-commercial use, with attribution. Commercial deployment
must configure an appropriate licensed provider rather than expand the free gate.
One real, quota-accounted public New York forecast request returned 72 rows and
correct matching; subsequent target previews reused it. No NOAA forecast fetch.

MySkywatch retains its existing cards/tabs and adds VisibilityPreview with saved
location selector, next pass/window, local timestamps, details, elevation/azimuth,
illumination/equipment, source epoch and weather facts. Bounded manual refresh,
loading/unavailable/cached-age wording; no fake predictions. Controller cancels and
rejects late location/target responses; logout/unmount discards private requests.
Adjusted existing tab word wrapping after actual mobile inspection. New frontend
files: components/VisibilityPreview.jsx, services/visibilityPreview.js and focused
test; existing MySkywatch, account CSS and authenticated API transport updated.

Executed verification: check_visibility.py passed fixed ISS rise/max comparison
against independent one-second sampling, sunlight/eclipse and twilight, stale and
mismatched epoch rejection, clipped pass and UTC-midnight crossing, all eight
celestial targets, polar rise/set, Moon illumination, missing ephemeris, DST,
forecast age/valid-time matching, two-account ownership, invalid horizons/targets,
no public writes and 15 counted authenticated HTTP checks plus location switching.
The first standalone test run passed assertions but exposed a Windows SQLite pool
cleanup lock; explicit client close/engine disposal fixed it and final run exited 0.
Existing check_account_alerts.py: 101 HTTP checks PASS. Frontend focused suite:
15/15 PASS including cancellation/late-result isolation. Production build PASS;
existing large-chunk/plugin timing warnings remain. Final lint status recorded below.
Read-only real Supabase ISS test used epoch 2026-10-29T13:31:42Z, returned eight
bounded 48-hour passes; first peak 13.52 degrees, correctly eclipsed at dark sky.

Real browser smoke used disposable SQLite users/location fixtures, genuine current
DE421 calculations and existing cached genuine weather, with upstream requests
disabled. Login/restore, satellite missing-elements state, Moon details and saved
New York-to-London switch succeeded; EST changed to GMT with different geometry.
Desktop and 390x844 inspected; document width 390 and preview scroll width 258 within
260-pixel box (no horizontal overflow). Proof images saved in visualization workspace.
No production browser writes. Time Explorer and Live routes unchanged; no broad
unrelated suite was run. No scheduler, inbox generation, push or delivery added.
Remaining limits: approximate sampling boundaries, unknown intrinsic brightness,
unmodeled terrain/refraction, conservative TLE freshness, single-host provider
lease, and free-provider licensing for commercial deployment. Install pinned data
requirements when deploying; source failures degrade honestly. Next batch is real
scheduled notification generation/delivery. Only this Markdown file changed.
No commits or pushes.

Final checks: ESLint PASS with no warnings after replacing render-time clock access
with the response generation timestamp; final production build PASS (2,115 modules).
Python compile and diff whitespace checks PASS. Temporary visibility API/Vite and
browser tab stopped; viewport override reset. No production services were started.

## Batch 07 — Real Notification Generation & Delivery

Starting HEAD 59effb83359163c74974c91b6f4260711c8943cd; completed 2026-11-02.
Preserved Batch 05/06 authentication, subscriptions, inbox and scientific engine.
New trusted runner: `backend/run_notifications.py --once` or `--loop` (300-second
cadence), independent of browsers and web-server lifespan. A systemd service
example is supplied in `deploy/orbitwatch-notifications.service`; it is NOT installed
or deployed. PostgreSQL session advisory exclusion plus a 90-second durable token/
lease fences mutations. Hard process death expires the lease; ordinary interruption
releases it. Heartbeat records actual start/success/error and once/loop mode; one
successful one-shot is never represented as verified recurring deployment.

Evaluation uses master/category preferences, canonical followed targets, owned saved
locations, IANA quiet hours (including overnight/DST), actual source validity and
10/30/60-minute warning gates. A notification may be generated between its due
warning and ten minutes later, always before the useful start; messages show the
actual local start, not an exact lead-time promise. Existing Skyfield/SGP4/DE421
predictions are reused over a two-hour worker horizon, with darkness, sunlit segments,
10-degree screening, seven-day element bound and explicit brightness uncertainty.
A clipped END is allowed; ongoing/clipped starts fail the future-warning gate.
Forecasts are queried only for due candidates, shared per saved location, with the
existing one-hour cache, valid-time matching, provider lease/quotas/backoff. Suppress
forecast cloud >=80%, precipitation probability >=70% or precipitation >=0.2 mm;
missing forecasts remain explicitly unknown, not substituted with current weather.

Bounds: 25 enabled accounts selected by persistent owner cursor/run, up to 140
location-target pairs/account, eight-second per-account work budget, 55-second run
deadline, five generated messages/account/run, 50 outbox rows/run. Pair rotation
and account cursor reduce starvation; resource limits can defer/miss short windows
under load and are not an alert-delivery guarantee. No massive prediction arrays
are stored. Worker refuses generation at 299 MB database usage to retain the normal
reserve. Provider fetches are off by default: workers consume existing caches and
never separately fetch orbital/event feeds. Optional weather fetching requires
ORBITWATCH_NOTIFICATION_PROVIDER_REQUESTS=true, the exact `--host-fingerprint`
value in ORBITWATCH_NOTIFICATION_HOST_ID, and an existing persistent shared weather
cache. Deploy only on the same ingestion/API host/shared cache volume; SQLite/OS
provider gates are NOT distributed quota coordination. Independent ephemeral hosts
must remain cache-only. No provider counters were reset.

Natural events reuse normalized cached EONET/GDACS/USGS records without new polling.
Only reliable Point geometry is supported for automatic radius alerts (haversine,
including dateline); Polygon/MultiPolygon reports are skipped rather than using a
boundary vertex. Require fresh usable cache, retrieval <=1 hour and genuine report
<=24 hours. USGS new M>=4 reports qualify; a >=0.5 magnitude increase with a recent
source update is material. GDACS Orange/Red qualify; only escalation is material.
EONET recent open, nonclosed curation reports qualify once/identity, with no automatic
update repeats. Open/reviewed/alert levels are never described as local danger.
Source report URLs are constrained to official NASA/USGS/GDACS domains. Coverage
remains bounded by existing ingestion; OrbitWatch is not an emergency alert system.

`services/notification_policy.py` separates scientific eligibility from persistence.
`services/notification_runner.py` commits inbox and compact durable delivery ledger
atomically through the existing trusted writer. Dedup survives dismissal/200-row
inbox rotation; nearby locations (<=10 km) and same-target starts within 20 minutes
are coalesced, with stable event identities/material-change keys. Ledger is capped
at 1,000/account and expired entries retained 35 days; capacity suppresses new work
rather than evicting live dedup identities. Settings/subscription/location ownership,
coordinate/version, warning/radius and quiet-hour gates are rechecked before commit.
Pending delivery rechecks current consent/settings/location/subscription and expiry.
No public notification-create endpoint exists.

Delivery state distinguishes inbox persisted, push queued/retry, provider accepted,
rejected, expired, suppressed and unknown. Send intent is committed before network;
only committed inbox rows can be sent. Temporary explicit HTTP 429/5xx rejections
retry with backoff/Retry-After, at most four attempts; 404/410 revoke subscriptions.
A transport ambiguity or crash after send intent becomes UNKNOWN and is not blindly
resent: Web Push offers no exactly-once receipt API. This trades a possible missed
push for avoiding duplicate sends; inbox remains durable. Provider acceptance is
never proof of display. Unconfigured push preserves pending work until expiry.

Push: pinned pywebpush 2.5.0 and compatible cryptography 50.0.2 installed in venv;
pip check passed. The initial older cryptography pin was rejected by dependency
resolution before installation and was corrected. Endpoint/key material is Fernet
encrypted at rest; only known HTTPS FCM/Mozilla/Apple/WNS hosts are allowed, with
public-address validation, no credentials/nonstandard ports/redirects, bounded keys
and payloads, and owner-only APIs. Device limit is configurable 1–5 with a hard DB
cap of five. VAPID keypair consistency is validated. Required persistent server
secrets: ORBITWATCH_VAPID_PRIVATE_KEY (base64 DER), ORBITWATCH_VAPID_PUBLIC_KEY
(base64url uncompressed P-256), ORBITWATCH_VAPID_SUBJECT and
ORBITWATCH_PUSH_ENCRYPTION_KEY (Fernet). No keys were committed or written to env.
References reviewed: https://pypi.org/project/pywebpush/ and
https://github.com/web-push-libs/pywebpush; Apple Home Screen requirements at
https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers.

New authenticated APIs: GET /api/account/notification-delivery, POST
/api/account/push-subscriptions (explicit consent), DELETE /push-subscriptions/{id}.
Status exposes opaque device receipts and genuine heartbeat/outcome metadata, never
endpoints. Existing inbox safely enriches source URL and delivery state; missing
migration 005 does not destroy the old inbox path. Existing Notification Centre and
Preferences show real worker/permission/device state, explicit enable/disable,
quiet-hours and platform guidance. One visible-app 60-second refresh updates count/
inbox; no per-second polling or permission prompts on login/render. Push-only service
worker intercepts no Cesium/Vite fetches, checks a durable local device marker and
expiry, uses branded notifications, validates same-origin click destinations and
opens/reuses the authenticated inbox. Logout attempts local marker revocation,
notification closing, browser unsubscribe and server revocation before session clear;
failed server revocation retains a receipt for retry. Fully quit browser/OS delivery
is platform-dependent. Revoked browser permission is displayed honestly.

Supabase migration 005: explicitly APPLIED to verified fingerprint
91629c91746ef7a1. Three additive tables: account_push_devices,
notification_runner_state, account_notification_delivery, with unique/check/FK
constraints, indexes, RLS and PUBLIC revocation. The explicit migration checker now
validates 002–005 plus delivery constraints/indexes and preserved existing account
counts. Production size: 13,192,339 bytes before; 13,347,987 after migration
(+155,648); 13,364,371 after one genuine runner heartbeat. Final nominal remaining:
486,635,629 bytes. Normal 300 MB/emergency 400 MB ceilings were not approached.
Legacy counts unchanged: users 5, live elements 143, history 0, archive 1,019.
All four old account tables remain empty. Production inbox/delivery/push rows: ZERO;
runner metadata: ONE genuine heartbeat. No fake production users/messages or push.

Actual operation verified separately: `backend/run_notifications.py --once` completed
with evaluated=0/generated=0 against real Supabase, with no browser or upstream
fetches. Eight authenticated production auth/readiness/account/status GETs returned
200. Status reported mode=once, real last-success timestamp, push_configured=false,
no devices/outcomes. Recurring worker is NOT deployed and background delivery is
NOT operational. No always-on host/VAPID configuration was present; the owner's
host clarification remains unanswered, so a reviewable deployment unit was prepared.
Operator action: deploy the loop service on the persistent ingestion host with shared
caches and DB/secrets, then explicitly opt in a device and verify a genuine accepted
push AND device display. No real opted-in device received a push in this batch.

Focused tests: disposable SQLite policy/API/ledger/worker suite passed (27 counted
HTTP checks after integration additions); disposable PostgreSQL suite passed 28 HTTP
checks, migration reapplication preserving data, schema constraints/RLS and granted
non-owner role reading zero rows. Includes actual DE421 window -> runner -> private
inbox, unchanged USGS report dedup, all warning choices, overnight/DST quiet hours,
disabled preferences, owner isolation, missing/stale/polygon event rejection,
material magnitude/GDACS changes, encrypted endpoint storage, committed send intent,
ambiguous crash recovery, 429 retry/Retry-After and 410 device revocation. Real
pywebpush encryption/VAPID signing was exercised with ONLY the HTTP boundary mocked;
no unsolicited provider call. Existing account-alert suite: 101 HTTP checks PASS;
existing scientific visibility suite: 15 HTTP checks plus scientific assertions PASS.
Frontend: 18/18 focused tests PASS, including actual service-worker message/push/click
handlers, explicit consent, unsubscribe, late private response isolation and prior
account/visibility contracts. ESLint and production build PASS; existing bundle/plugin
warnings remain. Windows denied the old disposable PostgreSQL port 55434; test server
ran on alternate loopback 55444. An invalid 17-byte auth test key was corrected to
16 bytes; obsolete UI-text assertions and a mixed-encoding edit were corrected.

Genuine browser: disposable local users only, actual backend auth/inbox/status;
no permission requested. Unconfigured push control disabled, one-shot status honest,
60-second refresh eventually showed stale heartbeat, Mark all read cleared the bell.
Desktop and 390x844 inspected; page width 390, delivery box width 260 / scroll width
258 (no horizontal overflow). Screenshots saved in approved visualization workspace.
Hot-reload blank state was recovered by normal reload; production build/SSR tests
passed. Push-click deep-link restoration and final cleanup status recorded below.

Changed files: new delivery models/routes, migration 005, browser_push,
notification_policy/runner services, run_notifications entrypoint, systemd service,
frontend NotificationDelivery/browserPush/push service worker and focused backend/
frontend tests; extended migration runner, API/router/schema, account controller/hook,
AuthRoot/App deep-link/logout, existing Notification Centre/Preferences/Skywatch
wording and account CSS. Only this Markdown file changed. No commits or pushes.
Next-batch handoff: deployment/secrets/device verification above remains operational
work; next development batch is Time Explorer completion. Stop after Batch 07.

Final verification: authenticated push-click URL restored Notifications automatically;
normal logout returned to the login screen with private account UI removed. No push
permission prompt appeared. Final SQLite delivery suite exited 0 (27 HTTP checks),
Python compile checks and diff whitespace checks passed. Browser viewport restored.

Cleanup: temporary API/Vite/browser and disposable PostgreSQL test cluster stopped.
No recurring job was installed. The production heartbeat is historical one-shot
execution evidence and will correctly become stale, not proof of ongoing service.

## Batch 08 — Complete Time Explorer

Starting HEAD 08424141b171b80853056e8130b8586199f6c553. Kept exactly two
product modes and the existing Viewer/shared celestial meshes. Time navigation now
accepts all 47 canonical destinations (Sun, eight planets, 26 moons, five dwarfs,
seven asteroids), including the same overview, subsystems and full catalog as Live.
The existing approximate scene model, canonical same-time center cache, parent-
attached paths and local camera transforms remain in use; no precision JPL claim.
Date changes force the shared positions/frame to update without reselecting Earth.

Time uses the shared raster map gallery with an independent saved map preference
and label toggle. Google 3D remains explicitly Live-only because its loader lifecycle
is not Time-compatible; keyed providers remain gated. NASA/Esri/OSM and compatible
rasters are clearly modern/static reference imagery, never selected-date observations.
Existing atomic map replacement/fallback remains intact. Time labels are names only;
Live weather/events/location readings are disabled there. Imagery requests and archive
coverage do not block mathematical scene readiness or navigation.

Calendar range is 1945-01-01 UTC through the current instant, with month/leap/DST
validation and explicit local/UTC display. Calendar/scrub edits change draft state;
LOAD confirms the scene time. Entry needs no introductory Load. Each Load clears
historical selections/orbits, satellite inspector/follow, stale weather/event panels
and markers, preserving the celestial destination and local camera. Sequence ID plus
UTC timestamp fence readiness callbacks; obsolete waits/fetches abort. The cinematic
shield hides/inerts ordinary HUD while the requested/confirmed date dock stays usable.
Timeouts finish with a specific scene retry; imagery has its own retry. No arbitrary
loading delays or extra Viewer. Loads and entry start with all 15 toggles OFF; the
four legacy default IDs remain metadata/test constants only. Live selections survive.

New compact HistoricalSatelliteList replaces Time's bulk explorer workflow. It
separates verified prelaunch/decay, missing archive, qualifying stored elements and
unknown lifetime status. Coverage checks use actual valid windows, not min/max epoch
bounds; checked objects still require successful backend propagation. A single
prelaunch notice is dismissible. The immutable 15 IDs were not changed. Added reviewed
lifetime metadata in time_satellites.json: 14 launch dates read from genuine existing
imported Space-Track GP_HISTORY LAUNCH_DATE fields, TESS from
https://science.nasa.gov/mission/tess/ (2018-04-18). Dates have UTC-day precision;
launch-day status without qualifying elements is unknown. No verified decay dates
were available, and none were invented. No archive endpoint is treated as a lifetime
bound. Before the first satellite era, trajectory requests are skipped. Backend
stored-only/newest-at-or-before/24-hour/SGP4 policies were not modified.

Verification: 66 focused frontend tests PASS (new lifetime/1945/DST checks, calendar,
reference-map cancellation/fallback, historical catalog, astronomy/local frames,
weather/labels/picking, auth transport and notification UI/service-worker regressions).
The separate existing solar-system layer suite's 13 cases and LOD suite's three cases
also passed, including all 47 center/representation/resource cleanup checks; the
celestial content case passed. Initial failures were obsolete nine-body/forced-Esri/
immediate-date-change assertions, updated to the requested behavior; a test-only Node
process import resolved lint. Final ESLint and production build PASS (2,119 modules);
existing bundle-size/plugin timing warnings remain. No backend algorithm changed,
so unrelated backend suites were not rerun.

Actual browser smoke used production-built frontend + genuine backend auth on an
isolated loopback PostgreSQL database. Two authentic cached archive records (ISS and
Hubble, 2022-01-01) were copied ONLY into that disposable DB; no provider downloads.
Verified immediate Time entry/0 toggles, calendar draft leaving scene unchanged,
1945 LOAD and one 15-object prelaunch notice, all disabled prelaunch rows, full 47-
object catalog and Saturn subsystem, NASA reference selection, Titan travel and
subsequent date LOAD retaining Titan/local view, Earth return, a genuine coverage
shortcut and explicit Hubble toggle yielding 1/1 historical positions. A new Load
reset all 15; Live returned with its six selections and Esri, Time retained NASA.

Browser inspection found and fixed Time Dock/System panel overlap using measured
clearance, and a compact moon diagram pseudo-element covering neighboring cells.
The final Earth parent hit-test resolves Earth, with panel bottom 534px above dock
top 550px. At 390x844 the page width was 390, list/dock width 300; list bottom 510px
was above dock top 522px. Improved narrow header/footer typography and omitted the
redundant zero-selection note on small screens to expose more list content. Proof
images are in the approved visualization workspace. Development optimizer reload
instability was avoided by testing the production build; transient browser command
timeouts were recovered through fresh observations. No physical touch-device claim.

Supabase: READ ONLY. Measured 13,364,371 bytes used, 486,635,629 remaining against
nominal 500 MB; archive remains 1,019 records and users five. No migration, import,
record update, provider budget reset or production account/test message was performed.
Batch 07 worker/push code is preserved; recurring deployment and real device push are
still not operational and belong to final deployment, not this batch.

Files: App, OrbitGlobe, SystemMenu, MapSettings, TimeDock, SceneTimePicker,
TimePreparation, navigationVisibility, sceneCalendar, earthMapProviders,
useHistoricalSatellites, live.css; new HistoricalSatelliteList and
services/timeSatelliteAvailability; reviewed catalog JSON; focused tests and
isolated browser fixture helper tests/serve_time_explorer.py. Only this Markdown
file changed. No commits or pushes.

Limits/Batch 09: celestial positions remain approximate catalog reconstructions;
modern imagery and present-day place names are reference only; Google 3D is Live-only;
archive gaps remain honest and day-only launch metadata cannot resolve launch-hour
existence. Next batch implements bounded genuine historical weather snapshots and
adds verified satellite archive coverage under the 300 MB normal/400 MB absolute
storage ceilings. Do not broaden natural-event tracks or hosting here. Stop after
Batch 08.

Final mobile verification after readability fixes: 390px page width, 300px list/dock,
203px scrollable list body; list bottom 543px above dock top 555px. Final screenshots
saved. Temporary browser/API/preview and disposable PostgreSQL stopped; viewport
reset. No production service or recurring notification worker was started.

## Batch 09 — Genuine Historical Weather & Satellite Archives

Starting HEAD 6cbbcec11727f5d33f92e7ff593973cf8396a9b6; working tree was clean.
Preserved Batch 08's 47 destinations, independent reference map preference,
1945–present draft/LOAD calendar, local camera context, names-only place labels,
15 unchecked satellite identities and strict stored-only 24-hour orbital rule.
Batch 07 notification architecture was not modified. No commits or pushes.

Implemented explicit ERA5 ingestion, private-object storage adapter, compact
metadata migration 006, authenticated coverage/snapshot/location routes, and
Earth-only Time Explorer weather controls. Main toggle, six variable cards,
opacity, independent Wind Flow, real coverage, deliberate nearest-snapshot scene
LOAD and historical click inspector share the existing Viewer. Historical date
changes reset weather/inspection and abort obsolete requests; synchronous timestamp
guards exclude old planes before effects run. Weather never blocks scene readiness.
Live current/forecast sources remain separate. Historical labels remain names-only.
Fixed the obsolete Time Dock claim that historical weather never exists and a
standalone legend inheriting the Live legend's horizontal flex layout.

Scientific source: Copernicus CDS / ECMWF, reanalysis-era5-single-levels,
https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels,
DOI 10.24381/cds.adbb2d47, current dataset CC-BY licence/required C3S attribution.
Reviewed official ECMWF ERA5 documentation and CDS API setup. ERA5 covers 1940
onward, including 1945. It is atmospheric reanalysis, not literal satellite/radar
or station observations; sparse early observations constrain estimates less.
Source and uncertainty statements appear in the historical panel and inspector.

Exactly 328 planned timestamps: January/April/July/October 15, 12:00 UTC,
1945–2026 inclusive. Genuine production snapshots downloaded/imported: **0 / 328**.
Per-variable production coverage is zero for temperature, dewpoint, cloud fraction,
preceding-hour precipitation, MSL pressure, U/V wind and derived RH. No generated
production weather, nearest-date substitution, temporal interpolation, current-
weather fallback or special-date fabrication. The schema permits future individually
verified dates; this importer deliberately accepts only scheduled seasonal dates.

CDS access was not configured: no CDSAPI_KEY/ECMWF_DATASTORES_KEY, .cdsapirc or
matching ECMWF rc account configuration. The 1945 pilot stopped at this local
credential prerequisite, with **zero CDS job submissions/download calls**. Recent-
year ingestion was deferred for the same prerequisite rather than repeated failed
authentication. Dataset-terms acceptance cannot be verified without the owner's
account and must be completed manually. No credentials were created or printed.
SUPABASE_URL and a backend Storage service-role credential are also absent.
Consequently no production bucket/blob was created and no weather metadata was
seeded. No direct writes to Supabase's managed Storage schema were attempted.

Pipeline: pinned official ecmwf-datastores-client 0.5.3 in the existing venv.
historical_weather_import.py supports status, migrate, download --year YEAR,
inspect --file FILE and import --file FILE --expected-target 91629c91746ef7a1.
One grouped year/available-month request, seven genuine source variables, 12:00,
GRIB and requested 1-degree grid; explicit operation only, never startup/API work.
Uses final ERA5 (experiment 1) with a conservative 95-day release lag; no ERA5T
substitution. A persistent request/job manifest polls once per invocation and
resumes the same job, with no queue wait or automatic ambiguous resubmission.
Completed months and checksums prevent duplicate downloads as a year expands.
One host operation lease and persistent provider gate; four snapshots/import,
64 MiB source response, 256 MiB local pilot and 4 MiB object limits.

Scientific validation checks CDS manifest/dataset/product, source SHA-256,
ECMWF ea/oper class/stream, final experiment, supported GRIB parameter/units/level,
exact validity instant, instant analysis versus one-hour forecast accumulation,
regular global grid ordering/wrap, bitmap masks and physical ranges. GRIB1's
ECMWF surface-coded 2m/10m/MSL parameters are recognized by exact paramId;
GRIB2's explicit levels are also accepted. Invalid variables are reported as
partial coverage, never silently zeroed. Temperature/dewpoint K→°C, cloud fraction
→%, Pa→hPa, accumulated metres→mm for the preceding hour. RH uses ECMWF's
liquid-water Tetens relation es=611.21 exp(17.502*(T−273.16)/(T−32.19)), bounded
to 0–100%; display wind speed is hypot(U,V)*3.6 km/h.

Canonical grid is 360×181 integer-degree point samples, west −180°, north 90°,
with cyclic longitude and both polar rows. CDS regridding or direct integer-node
decimation of 0.25-degree data adds no resolution. Spatial bilinear display sampling
propagates missing contributing nodes. OWWX1 uses zlib, a bounded metadata header
and little-endian int16 planes, −32768 missing sentinel, explicit units/offsets/
scales/missing counts. Scales: 0.01 for °C, %, mm and m/s; pressure 0.1 hPa with
1000 hPa offset. Error is at most half a quantization step. Decompression size,
header/plane consistency and SHA are revalidated before rendering/sampling.

Storage design: private historical-weather bucket, no anonymous/client policies,
4 MiB application/octet-stream cap, server-only service access and project match.
Immutable key era5/v1/UTC_TIMESTAMP/SHA256.owwx; verify upload by checksum GET
before publishing the metadata transaction. Failed/corrupt objects never receive
metadata; interruption can leave a reusable versioned object, never a dangling
published index. PostgreSQL contains small metadata only, not field arrays.
Bounded authenticated responses, transparent negotiated HTTP gzip, four decoded
objects cached and exact-date 404s; Storage failures return an isolated 503.
Importer checks measured PostgreSQL <300 MB and all object bytes <750 MB, and
refuses unknown-size objects. File storage and egress are separate from DB reserve.

Supabase fingerprint 91629c91746ef7a1 verified before writes. Migration 006 applied
and reapplied idempotently with RLS and unchanged users/orbital rows. PostgreSQL
13,364,371 bytes before → 13,421,715 after migration → 13,446,291 after first
satellite batch → **13,487,251 final**; nominal remaining **486,512,749 bytes**.
Normal 300 MB and absolute 400 MB ceilings remain well clear. Storage metadata
measured **0 objects / 0 bytes before and after**, no unknown-size entries.
Dashboard egress/plan usage was not accessible and was not claimed measured.

Satellite audit reused seven complete saved GP_HISTORY archives; no old request
was repeated. Two disjoint, one-day pilot windows ending at the seasonal 12:00
instant: 2025-01-14→15 and 2026-04-14→15. Each passed existing response/count,
local disk, 50 MiB table pilot and measured transaction capacity checks. Sources
validated identity, preserved record IDs/epochs and actual SGP4 propagation.
Two GP_HISTORY retrievals plus two normal logins (four Space-Track HTTP requests),
with cooldown/lease/counters preserved. First response: 47 records, 53,041 raw /
6,795 gzip bytes; second: 68 records, 76,805 raw / 8,230 gzip bytes. Imported all
115; no failed/deferred source responses. Stopped after the two-batch cap.

Historical rows **1,019 → 1,066 → 1,134**; distinct IDs **14 → 15**, including TESS.
Saved gzip archive bytes **120,561 → 135,586** across nine manifests. For each
pilot timestamp, 13/15 objects pass genuine backend SGP4. January 2025 gaps:
Chandra/GOES-16; April 2026 gaps: Chandra/TESS. Across all 328 scheduled timestamps,
verified launch-day exclusions leave **1,045 eligible satellite/date pairs**:
exact qualifying coverage **0 before → 26 after**, **1,019 remaining gaps**.
This count is timestamp coverage, not continuous historical completeness. The
newest stored epoch must remain at/before the selected instant and <=24 hours old.
Detailed measurements/checkpoints are retained in ignored .runtime/history audits.

Verification: **11 backend scientific/API tests PASS**, plus a real isolated
PostgreSQL publish integration PASS (migration twice/RLS, corrupt source before
target access, corrupt upload before metadata, upload-first visibility, complete
eight-plane metadata, repeat import no-op, unchanged unrelated rows). Tests cover
calendar/1945, conservative archive lag, conversions/RH, GRIB metadata and partial
failure, quantization/masks/checksum/corrupt compression, global decimation/wrap/
polar sampling, Storage size limits, auth/exact gating, location units and safe
503. Mocked CDS tests prove grouped requests reuse job IDs and never resubmit an
ambiguous attempt. Real production read-only service checks returned coverage
200 with zero stored snapshots, snapshot/location 404; authentication middleware
was independently tested locally, while production reads used a dependency override.

**61 focused frontend tests PASS** in the final combined run (historical weather,
Time completion/calendar/scene preparation, satellite catalog, Earth picking,
place weather, source fields, independent wind, map/navigation/ephemeris and
weather resource/quality/reduced-motion regressions). Final ESLint PASS and
production build PASS, 2,122 modules; preexisting bundle-size/plugin warnings and
test Vite HMR-port warning remain nonfatal. An initial GRIB fixture assertion was
too strict for GRIB1 packing precision; corrected the tolerance to 0.0002°C.
No application failure remained in the focused checks.

Bounded browser smoke used the real backend/auth and fixed disposable loopback
PostgreSQL, never a production account/weather fixture. Explicitly labelled
isolated scientific fixtures exercised exact April 15 1945 data, missing RH,
nearest action loading a deliberately disclosed timestamp, on/off, independent
wind + precipitation, view-center inspection and a real Earth surface click.
Inspector displayed 20°C, 1013 hPa, 18 km/h, 2 mm preceding-hour precipitation and
Unavailable RH; these were test constants, never claimed downloaded ERA5.
April 16 LOAD removed the old layer and inspector immediately. Fixture-free
restart verified the honest 0/328 coverage experience. Modern basemap disclaimer
and date LOAD remain intact. At 390×844: page 390px, panel/dock 300px, panel
bottom 543px above dock top 555px, scrollable body; desktop panel also clears dock.
Screenshots saved in the approved visualization folder. No physical touch-device
or genuine ERA5 cloud-blob end-to-end delivery claim.

Remaining limitations/handoff: supply a CDS personal access token with manually
accepted dataset terms and backend SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY for
this verified project. Then run one 1945 and one recent final-year grouped pilot,
inspect genuine GRIB metadata (especially hourly precipitation), create/review the
private bucket through the API, import and measure actual uploaded object/egress
bytes before expanding. Actual remote CDS queue/download and Supabase blob upload
remain unverified without those credentials. No known new blocking application
bug from focused checks; preexisting approximate celestial ephemerides and large
bundle remain. Satellite gaps are explicit, not filled by current elements.
Batch 10 is Natural Events/source status/cyclone coverage; hosting, recurring
notifications, VAPID and real device push still belong to the final release batch.
No Natural Events expansion or hosting was implemented. Temporary API/preview/
browser and local PostgreSQL stopped, viewport reset, normal frontend build
restored. Stop after Batch 09.

## Batch 10 — Global Natural Events & Cyclone Tracks

Starting HEAD 81601b2927c0c516da2aa27a54f569fc6c4c8724; clean working tree.
Preserved handwritten auth, two product modes, Live weather, Batch 08 navigation/
camera/calendar/satellites and Batch 09 exact historical-weather unavailability.
No ERA5 onboarding/import, schema migration, production alert/push, hosting,
recurring worker deployment, VAPID configuration, clay icons, commits or pushes.

Expanded independent shared-host event caches: EONET queries up to 500 open
curated records without a 30-day cutoff plus 150 closed records from 30 days;
GDACS searches EQ/TC over 30 days and FL/VO/DR/WF over 180 days, two 100-record
pages per group maximum; USGS uses its official M2.5+ month GeoJSON feed. EONET
open is expressly curation status, never proof a wildfire still burns. Separate
first report/start, last report, source modification, verified material update,
retrieval, provider validation, cache age and report age. Future GDACS end dates
are retained separately and cannot masquerade as a new observed event time.
Overall versus episode alert levels remain distinct. Official main-report links
are restricted to the provider's domain; no source-supplied URL is proxied.

Acquisition validates exact URL/parameter-scoped ETag/Last-Modified parts, handles
real HTTP 304 without changing original retrieval/report times, honors restrictive
cache controls, retains Retry-After/backoff and atomic refresh ownership. Every
extra page consumes the same provider's persistent hourly/daily budget; original
EONET/GDACS 4 requests/hour and refresh cooldowns were not bypassed/reset. Repeated
pages/IDs terminate pagination. Responses cap at 8 MB each / 16 MB per refresh,
5,000 source records, at most three acquisition threads, and no startup bulk job.
New explicit natural_events_refresh.py --refresh runs one bounded cache operation;
without the flag it only reports existing data. An initial concurrent readiness
probe deferred four sources before any HTTP; a single preflight then completed
them, reusing the already-refreshed GDACS cache. Provider counters were preserved.

Added NOAA NCEI IBTrACS v4r01 ACTIVE CSV (143,079 bytes, not the 333 MB ALL archive).
Official source: https://www.ncei.noaa.gov/products/international-best-track-archive
and its v04r01 column/technical documentation; DOI 10.25921/82ty-9e16. Required
NOAA/IBTrACS attribution is shown. This batch archive updates several times per
week, not minute-by-minute. Parser validates SID, basin/season, dated positions,
agency columns, missing values, main/provisional classification and IFLAG. It
excludes spurs and P-interpolated positions, preserves original O/I/V positions,
and withholds interpolated intensity for I flags. Wind remains reported knots with
documented agency averaging (USA 1 minute; Tokyo 10; New Delhi 3; CMA 2, etc.);
no cross-agency category conversion. At most 32 storms / 512 points each; source
SHA-256 f30823baf46e983b7889357483f2f0ba90f9dcb14b5f21ec03b871765dbe5016.
Small authentic two-storm excerpts with provenance/checksums exist ONLY in tests.

NHC/CPHC CurrentStorms index plus reviewed NOAA GIS forecast-point layer metadata
provide a bounded regional forecast adapter: at most two official bins, exact
basin/storm-number/bin checks, issue/valid timestamps, 12-hour issue expiration,
and separate future forecast arrays. Invalid/expired/mixed-issue data are withheld.
Only a unique explicit USA_ATCF_ID match joins IBTrACS and NHC; names/proximity
never join EONET/GDACS/IBTrACS storms. Unmatched verified forecasts remain separate
source reports without an invented current marker. Genuine NHC index retrieval
returned **zero active storms / zero forecasts**. No real current GIS forecast
delivery claim: its active-storm field-format case still requires release checking.
IMD's documented cyclone_track endpoint returned **HTTP 401** on one public probe;
authorized credentials are required, no bypass/retry. General GDACS geometry is
not sufficient evidence of a dated forecast path, so none is inferred. No cones,
forecast probabilities, danger radii, future intensities or landfalls were invented.

Genuine pilot normalized **2,658 reports**: EONET **648** (two rejected), GDACS
**37**, USGS **1,968** (two rejected), IBTrACS **5** storms (149 non-original/
unsupported source rows excluded), NHC **0**. Fair provider/category round robin
retains **842** with 400/source and 1,200 overall caps, not the old global 600 cap.
Displayed categories: 403 earthquakes, 397 wildfires, 16 floods, 14 cyclone reports,
six volcanoes, four droughts, two snow/ice reports. Other supported categories
explicitly show no loaded reports. **219 older open EONET records** remain visible;
oldest displayed last report is 2026-06-15. Coverage is incomplete, clearly disclosed.

Five genuine IBTrACS observed/provisional routes: IN-FA 35 points, VANCE 46,
ARNAB 14, OLANA 12, CHAMPI 47. Four EONET reported-position routes add 38, 34,
11 and six points. Thus nine source routes, not nine distinct reconciled storms.
Latest IBTrACS position is 2026-11-01 00:00 UTC; EONET latest 2026-11-02 00:00.
Feed retrievals were 09:58–10:00 UTC November 2. EONET's no-cache policy marks
its application snapshot stale immediately; by final read EONET/GDACS/USGS/NHC
caches were stale and IBTrACS fresh. Source dates do not change on local reads.
There are no verified forecasts in this pilot; every relevant inspector says so.

Operational provider calls: EONET two, GDACS two search requests, USGS one,
IBTrACS one, NHC one = seven feed HTTP calls / 2,358,396 response bytes. One
additional quota-accounted selected GDACS flood geometry request (FL:1104121)
returned zero accepted polygons; no outline was invented and no retry was made.
Separate schema/access research: GDACS Swagger, NOAA layer list, NOAA point-field
metadata and the one IMD 401 probe. Browser smoke used cached data with provider
fetching disabled; it introduced no event-provider calls. Documentation browsing
is separate from these operational request counts.

Added authenticated explicit /api/events/{id}/boundary enrichment. It shares
GDACS's lease/cooldown/quota, caps response at 2 MB and output at 16 boundaries /
4,096 vertices, supports standard Polygon/MultiPolygon/GeometryCollection nesting,
keeps at most 16 cached products, and honors no-store/no-cache/max-age. Cached
reads remain available when provider fetching is disabled. Boundary product roles
can include forecasts/impact outlines; without verified role they are labelled
unknown and are excluded from automatic notification proximity. Nonempty remote
GDACS enrichment remains unverified; isolated valid/empty/cache cases are tested.

Renderer reuses the same Viewer and two existing bounded CustomDataSources.
Only the selected storm creates its route: solid glowing reported path, hollow
amber forecast points/dashed forecast path, dated/intensity markers selected from
actual points, and a stationary source icon. Geographic segments take the short
antimeridian route; large temporal/spatial gaps are split rather than fabricated.
Selection alone never flies. Explicit VIEW TRACK / FOCUS STORM frames the route
clear of the desktop report panel; return restores saved camera position/direction/
up. Generation guards and owned-flight cancellation prevent late camera movement
after mode changes. Track geometry is rebuilt on data/selection changes, not each
frame. Reduced motion, category icons, marker animation, clustering, depth testing,
event-click priority and satellite ownership are preserved. No arbitrary polygon
vertex becomes an incident-centre icon; validated source boundaries render instead.

Natural Events UI has category/source/report-context filters, actual loaded counts,
source freshness/curation badges, dates, ages, source status, complete inspector,
observed/forecast legend and explicit missing-data messages. List filters are
labelled separately from the map category. Lists start with 40 rows, load 40 more,
and stop at 200 with a refinement notice. Mobile focus closes the report panel and
retains named track/return controls. Fixed inherited Live dock edge anchoring and
mobile HUD grid sizing that clipped telemetry/account controls; clocks remain.

Notification eligibility now uses current source validation separately from report
age. An older incident requires evidence: comparable source timestamps plus a
>=0.5 upward USGS magnitude revision, GDACS latest-episode escalation, or a changed
reported polygon newly reaching the saved radius. An unchanged refetch, old open
curation record, unverified change or projected forecast passage cannot alert.
Existing ledger severity can also substantiate a significant escalation. Point/
Polygon/MultiPolygon proximity handles holes and antimeridian unwrapping with
spherical minimum distance to segments. Crossing/degenerate/oversized, hemispheric
or near-polar ambiguous polygons are conservatively rejected. Viewing-location
ordering uses the same reported geometry, not a fake centroid. Messages describe
source reports near saved observation areas, never certain impacts. Consent,
category/radius, saved locations, quiet hours/timezones, freshness, fencing and
atomic durable dedup remain. Event ledger keys are retained during routine expiry
cleanup; the existing 1,000-row/account hard cap still bounds storage. No competing
scheduler or automatic subscriptions were introduced. Forecast-only/IBTrACS reports
do not automatically trigger proximity alerts without suitable current evidence.

Storage: no Supabase writes/new tables/buckets. Fingerprint 91629c91746ef7a1,
read-only PostgreSQL **13,487,251 bytes**, 486,512,749 nominal bytes remaining,
12 public tables, users five, archived satellite elements 1,134, weather snapshots
zero. Supabase Storage remains zero objects/bytes. Local events directory measured
**6,372,021 bytes** including caches, audit and research metadata, not PostgreSQL.
No giant raw track archive or production fixture was stored in Supabase.

Verification: **12 focused new backend tests PASS** for old open/closed reports,
future end dates, episode levels, real IBTrACS excerpt/checksum/flags, forecast
identity/issue/expiry, no name merging, fair allocation, real HTTP transport mock
pagination/ETag/304, holes/dateline/multipolygons/malformed geometry, material
changes and selected boundary caching. Original event auth/cache/concurrency suite
PASS (36 concurrent consumers, 48 atomic reservations, 304/429/outage recovery,
zero real provider calls). Notification delivery suite PASS including 27 HTTP
checks, quiet/DST/policy, owner-isolated encrypted push, atomic inbox/ledger,
inbox cleanup dedup, overlap fencing and mocked committed/ambiguous sends. No
production alert or push was sent. **44 focused frontend tests PASS** together;
subsequent 19-case renderer/picking/Time regressions also PASS after focus fixes.
Final lint/build PASS; existing large-bundle/plugin warnings remain. Initial test
failures were obsolete old-open/polygon-rejection assertions and one inconsistent
fixture report timestamp; fixed and rerun. An initial dict syntax error and render
clock purity lint finding were fixed before final verification.

Real authenticated browser smoke used a disposable local PostgreSQL user with
genuine unchanged cached official reports (not fictional disasters). Verified
842 loaded / five IBTrACS-filtered storms, source selection, IN-FA's 35 dated
positions, real 93 kt / 1-minute source intensity, provisional/batch/source dates,
no-forecast message, solid route, explicit focus, 27,000 km camera restoration,
mobile panel closing/return toolbar and no overlapping weather legend. At 390×844:
page width 390, toolbar 300px/right 378/bottom 710, Live dock 300px/right 379/top
725, account button fully within right 379. Time entry removes the live track/
toolbar, keeps 15 objects / zero selected, NASA reference map and LOAD; Live
returns with six selections. Screenshots saved in the approved visualization
folder. No physical touch-device claim. Temporary browser/API/preview/PostgreSQL
were stopped and normal frontend build restored; viewport override reset.

Limitations/final-batch handoff: feeds are bounded and incomplete, source activity
is not independently verified, and stale reports remain labelled. No genuine
forecast was available; validate an active NHC/CPHC response and nonempty GDACS
geometry/roles before claiming those live cases verified. IMD needs authorized
access; no global forecast is promised. Polygon geodesic proximity is conservative
and rejects ambiguous large/polar shapes. Event ledger cap requires monitoring;
do not delete dedup keys to regenerate notices. Shared cache/provider quotas need
one persistent ingestion host/volume. Recurring notifications and real-device
push remain undeployed. Prompt 11 handles hosting, genuine scheduler, VAPID,
release verification and cleanup. Historical weather remains honestly 0/328;
Copernicus onboarding was not attempted here. Stop after Batch 10.

## Batch D — Solar System expansion

The Live Mode scale control keeps the 240 AU limit and offers Oort Cloud exploration at that boundary. A Sun-centered camera eases into the distant view and restores the previous framing on return. Manual zoom and rotation use the existing input owner, and reduced motion skips the flight. The inferred cloud uses one lazily allocated Cesium point batch with 2,400, 4,600 or 6,800 stable seeded samples. Its render units are compressed by 128 and its camera uses dedicated clipping bounds. The Sun remains a visual reference. The normal planetary and satellite scales retain their data and geometry. [NASA Oort Cloud facts](https://science.nasa.gov/solar-system/oort-cloud/facts/)

The normal wide view had excluded named minor bodies unless selected. Dwarf planets and asteroids now gain visible points and trajectories in the outer part of the normal zoom range. Path sampling still calls the existing Live and Time Explorer ephemeris resolvers. The renderer reuses its existing orbit buffers and label collision policy. At distant overview ranges it projects names into a bounded screen-space layer because the Cesium glyphs broke up at 240 AU in the desktop capture. Close-view labels still use the existing Cesium collection. Brightened screen-space points indicate catalogue positions rather than physical diameters.

Before editing, a read-only check used the production-backed Time Explorer weather handlers. All four 2024 UTC dates returned complete snapshots, each with eight fields and a valid point temperature. The production archive contained four records at that check. SSH on port 22 timed out, so the latest ingestion-process checkpoint was unavailable. This batch made no changes to the campaign and submitted no CDS requests.

Local Chrome exercised the rendered app at 1280×900 with full motion and at 390×844 and 844×390 with emulated touch and reduced motion. All three layouts reached 240 AU, rendered named labels and orbital paths, entered the cloud, reached 16,000 AU with wheel or touch input and the range control, restored 240 AU, and switched between Live and Time Explorer. The scale controls fit within their viewports and cleared the zoom buttons. The browser test used isolated account and network responses. Captures are in `.setup-cache/batch-d-evidence`. Physical-phone GPU performance and a signed-in production browser session were outside that verification.

The 27 focused Node tests covering Oort sampling and camera ownership, named ephemerides, solar LOD, orbit styling and the historical frontend contracts passed. The full suite passed 241/241 in serial after concurrent Vite SSR tests collided on their local port. The final minor-body visibility guard was checked with a four-test rerun, including preservation of the existing moon visibility rules. ESLint and the final production build passed. Vite reported its existing large-bundle warning. Runtime changes are confined to frontend scene rendering, HUD controls and their styles. No backend, ingestion, authentication or notification code changed.

## V6 — Observation layout and Natural Events coverage

The phone Weather panel filled the viewport and intercepted the globe. The 390×844 baseline capture hit a report filter at the viewport center. The desktop Weather panel already passed that center hit test at 1600×900. Ordinary Weather, Map, Camera, System and mobile catalogue panels now use non-modal observation surfaces with edge bounds, contained scrolling and Escape dismissal. The modal account and date workflows retain their explicit triggers. The Time Explorer date strip uses the full viewport as its positioning reference so the phone rules apply its bottom offset once. Report source and context filters expand on demand. The existing arm artwork and authentication flows were outside this patch.

### Natural Events pipeline

On November 25 at 18:09:21 UTC the deployed FastAPI event handler returned HTTP 200 from the actual EC2 caches. This was an in-process authenticated route test with refresh scheduling disabled. The original default globe admitted confirmed activity and earthquake occurrences under 24 hours old. The inspected NHC/CPHC summary had zero active storms. That left 44 USGS earthquakes eligible and excluded every other family even though the handler included those reports. The production cache refresh owner and shared request budgets remain in use. Each provider retains its own usable response through another provider’s timeout, with an isolated recovery path and explicit cache state. The event endpoint returns the bounded normalized cache directly.

Live view now includes recent dated official-source reports and recent reports with recorded source closure. Each state has its own label and expiry. Earthquakes still use a 24-hour occurrence window, NHC confirmation a 12-hour advisory window, floods seven days, volcanic reports 14 days, and slowly updated drought and ice reports 30 days. A provider’s open flag or cache retrieval timestamp alone cannot establish activity. Confirmed ends remain in the archive. Forecast-only rows stay separate from observed markers. The first page interleaves report families, and a less common hazard represents a cluster where it overlaps a quake. Existing explicit storm identity links, published boundaries, icon artwork and horizon occlusion still apply.

### Coverage at the inspected production timestamp

API counts below are from the deployed handler before the change. Exclusions and eligibility replay the same timestamp and reports through the new status and grouping code. Eligibility counts distinct groups with a point or published area before view-specific horizon and clustering limits. The API’s bounded allocation omitted 1,414 earthquakes and 246 wildfires from its displayed subset. That difference is separate from status filtering and identity deduplication.

| Family | Upstream records | Normalized cache | Live exclusions | Group dedup | Production API | Render eligible | Latest report UTC and provider |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Cyclones | ≥6 storm records | 6 | 3 | 2 | 6 | 1 | Nov 23 00:00 · EONET/GDACS/IBTrACS |
| Earthquakes | 1,816 feed features | 1,814 | 356 | 0 | 400 | 44 | Nov 25 16:23:53.838 · USGS |
| Floods | ≥15 | 15 | 12 | 0 | 15 | 3 | Nov 21 20:00 · EONET/GDACS |
| Wildfires | ≥646 | 646 | 396 | 0 | 400 | 4 | Nov 23 19:00 · EONET/GDACS |
| Volcanoes | 4 GDACS | 4 | 4 | 0 | 4 | 0 | Oct 10 05:58 · GDACS, archive only |
| Drought | 5 GDACS | 5 | 1 | 0 | 5 | 4 | Nov 23 00:00 · GDACS |
| Landslides | Unresolved | 0 | 0 | 0 | 0 | 0 | No normalized EONET reports |
| Severe storms | Unresolved | 0 | 0 | 0 | 0 | 0 | EONET storm records classified as cyclones where supported |
| Snow and ice | ≥3 | 3 | 2 | 0 | 3 | 1 | Oct 30 00:00 · EONET |
| Dust and haze | Unresolved | 0 | 0 | 0 | 0 | 0 | No normalized EONET reports |
| Temperature extremes | Unresolved | 0 | 0 | 0 | 0 | 0 | No normalized EONET reports |
| Water colour | Unresolved | 0 | 0 | 0 | 0 | 0 | No normalized EONET reports |
| Other reports | Unresolved | 0 | 0 | 0 | 0 | 0 | No normalized reports in this family |
| Tsunamis | No dedicated feed | — | — | — | — | — | Outside the existing 13-family taxonomy |

EONET returned 650 records across two capped queries, of which 646 normalized. GDACS returned 31 and all normalized. USGS accepted 1,814 of 1,816. IBTrACS normalized two storms, excluding 44 position rows at the parser. Storm totals and position rows use different units. The capture omitted a category breakdown for rejected records, so the affected EONET rows show verified lower bounds or unresolved raw totals. At the audit EONET, GDACS and NHC had stale-but-usable caches and USGS and IBTrACS were available. None reported a provider failure. Source definitions are documented by [NASA EONET](https://eonet.gsfc.nasa.gov/docs/v3), [GDACS](https://gdacs.org/Documents/2025/GDACS_API_quickstart_v1.pdf) and [USGS](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php).

The EONET Ireland and Thailand floods and the November 23 Australian wildfire are recent closed reports. Tropical Cyclone Xavier qualifies as a recent dated report, with its last position on November 23. The October 30 report for iceberg B22K qualifies under the ice window and shows its last reported location. B52 and D33D are older archive reports. Kanlaon’s latest stored volcanic report was outside the 14-day display window. The replay increased eligible groups from 44 to 57, across six families.

### Browser and regression checks

Local Chrome rendered the fixture-backed app at 360×800, 390×844, 412×915, 844×390, 1366×768, 1600×900 and 1920×1080. On each viewport, nine points across the scene center reached the Cesium canvas with Weather, report details, Camera, Map and System open, and after Time Explorer finished preparing. The run exercised the flood category and its rendered details, the report archive and source filter, the celestial catalogue, the date picker, both mode buttons and the notification workspace. It checked horizontal overflow and uncaught JavaScript errors. The baseline and after screenshots are kept locally in `.setup-cache/v6-layout-evidence`. They show the UI and event overlay with external imagery requests isolated. These checks used emulated touch and a local test account response. Physical-device safe-area and keyboard behavior, real provider imagery and the signed-in production workflows require separate verification.

From the frontend directory, `node --test --test-concurrency=1 tests/naturalEventLive.test.js tests/naturalEventVisuals.test.js tests/hudAssembly.test.js tests/historicalWeather.test.js` passed all 17 tests. `npm run lint` and `npm run build` passed, with existing Vite bundle-size warnings. From the project root, the backend virtual environment ran `python -u tests/check_event_expansion.py` with 14 passing tests and `python -u tests/check_natural_events.py` with the real route, disposable SQLite database and mocked providers. The initial sandboxed HTTP fixture run stalled after normalization and the approved local rerun completed. The HTTP fixtures verified cache isolation, authenticated detail handling, 36 concurrent consumers, 48 atomic reservation attempts and timeout/429 recovery.

Before release, the public API readiness endpoint returned `ready` with database available. The initial EC2 inspection captured the provider caches. Subsequent SSH requests to port 22 timed out. The repository deployment script scopes service operations to the API and notification worker, and this batch issues no ERA5 commands that change state.

The landscape screenshot exposed Weather sharing the zoom rail at 844×390. The right-side panels now start beneath the top controls, end before the lower dock, and reserve the zoom rail horizontally. The repeated 844×390 touch-emulation check passed the report-selection sequence, the central hit tests and a bounds check against the zoom group. On the same build family the Oort Cloud scenario passed on desktop with wheel input and at 390×844 with touch pinch. It verified the 240 AU entry threshold, the cloud range down to 16,000 AU and restoration of the original 240 AU framing.

The [EC2 rollout of the backend change](https://github.com/TUF-SCAR/OrbitWatch/actions/runs/45789781092) succeeded, including API and notification-worker health. The public readiness response reported the database available and an unauthenticated event request returned HTTP 401. Cloudflare served JavaScript containing the new report heading and the CSS observation layout. The follow-up landscape change is frontend CSS only. SSH timeouts blocked an independent post-release comparison of the ERA5 process ID and authenticated event-cache inventory.

An expanded browser pass caught a collapsed desktop Object Explorer result area at 1600×900 after the switch to a non-modal panel. The Explorer now has an explicit flex column and a height bounded by the available viewport. The repeated test passed at 1600×900 and 390×844, including row selection, the satellite inspector, the Preferences and My Skywatch tabs, and opening and typing in location search. The Oort pinch scenario also passed at 844×390. Final lint and the production build passed.

## V6 Batch E.2 — Accounts and notifications

OrbitWatch keeps the existing Argon2id password hashes and 24-hour browser sessions. New accounts require at least 15 password characters. Existing passwords continue to work, and the form preserves the spaces users enter. Username lookup and uniqueness use Unicode NFC. Email matching lowercases the domain and preserves the local part, including case, dots and tags. The migration adds private rate-limit and revocation tables and functional uniqueness indexes. Each new session gets its own token identifier, and logout revokes that session and removes the current browser's push device when supplied. Logout clears local credentials immediately. Server-side revocation requires a connection. Account settings synchronize through the existing authenticated routes. Scene display settings remain browser-local. Password change and self-service deletion are outside the current account interface. [NIST Digital Identity Guidelines](https://pages.nist.gov/800-63-4/sp800-63b.html) · [SMTP address semantics](https://datatracker.ietf.org/doc/html/rfc5321)

The notification inbox uses the edge panel and keeps the center available to the globe. Location editing reuses the street map at phone and desktop widths. The user can enter coordinates or deliberately request device location. OrbitWatch resolves the selected coordinate against local timezone polygons and shows a manual IANA fallback. A device move does not change the saved location. The forecast request adds provider-supplied atmospheric visibility and humidity within the existing shared cache and budget. A modeled visibility below 1 km screens ordinary viewing alerts. Missing fields remain unavailable. Confirmed-finished, closed and forecast hazard reports remain available in their existing visual context and are excluded from emergency delivery. Eligible nearby danger still bypasses Quiet Mode. [Open-Meteo forecast fields](https://open-meteo.com/en/docs) · [Skyfield satellite event calculations](https://rhodesmill.org/skyfield/earth-satellites.html)

In the real PostgreSQL fixture the scheduled Moon opportunity initially generated zero inbox alerts. The shared geometry insert succeeded, but its result did not provide a usable affected-row count. The worker now takes ownership only when PostgreSQL or SQLite returns the claimed cache key. The same fixed-date DE421 case then generated a single alert and a repeated run generated zero. The delivery suite also exercised quiet-hour and DST checks, dangerous-event relevance, owner-only push, retries and expiration, a persisted send with unknown outcome after a simulated restart, and duplicate protection. The inbox's collapsed desktop body also surfaced in the browser run and was corrected with a content-sized scroll body within the edge panel.

From the project root, the backend virtual environment ran `python -u tests/check_auth_hardening.py` (6 tests), `python -u tests/check_account_foundation.py` (74 HTTP checks), `python -u tests/check_account_alerts.py` (101 HTTP checks), `python -u tests/check_visibility.py` (16 HTTP checks and scientific assertions), `python -u tests/check_event_expansion.py` (14 tests), and `python -u tests/check_notification_delivery.py` (33 SQLite HTTP checks). `python -u tests/check_notification_delivery.py --postgres` passed 34 HTTP checks after the claim fix. The fixture packages use a local database and controlled cache or delivery responses. The scientific checks exercised a numerical satellite peak reference, orbit freshness, illumination, twilight, eight celestial targets and DST. Frontend ESLint and production build passed. Vite still reports its existing large-bundle warning.

Web Push remains opt-in and device-specific. The existing worker, VAPID configuration and service worker carry the test payload. The inbox's explicit test control verifies the path to the provider without introducing a fabricated science alert or inbox record. A provider response reports acceptance. Browser display requires separate observation. [Web Push message encryption](https://www.rfc-editor.org/rfc/rfc8291.html)

The first deployment at `8ed8ffa` returned successful GitHub Actions, live API readiness and updated Cloudflare assets. The EC2 API, Caddy, notification worker and ERA5 campaign were active. ERA5 retained PID 124832 and Supabase held 16 historical snapshots. The production measurement during release verification was 15,051,923 bytes in PostgreSQL and 11,072,123 bytes in object storage. The signed-in production checks use separate release-test accounts, and ERA5 receives no job or service changes in this batch. [Initial backend deployment](https://github.com/TUF-SCAR/OrbitWatch/actions/runs/45803596282)

The serial frontend command `node --test --test-concurrency=1 --test-reporter=spec tests/*.test.js` passed 242 of 242 tests. Local Chrome passed the separate viewport checks at 1366×768, 1600×900, 360×800, 390×844 and 844×390 against an isolated FastAPI fixture. The checks signed in, opened the inbox and delivery controls, confirmed the viewport center hit the Cesium canvas, opened the saved location and fit its coverage circle, refreshed and logged out. The 390×844 check saved a browser-geolocation pin and the 1600×900 check entered a pin manually. The 1366×768 check also persisted a changed radius through refresh. A separate registration run closed Chrome and reopened the same isolated profile, restoring the signed-in session. External map and imagery traffic was isolated in these browser checks. The captures are under `.setup-cache/batch-e2-evidence`.

Cloudflare served the corrected inbox CSS after the follow-up push. The AWS rollout of `9bb44ab` succeeded and the deployed Git SHA matched. FastAPI reported database readiness. The API, Caddy, notification loop and ERA5 systemd units were active. The notification heartbeat was 6.6 seconds old with no reported error and push configuration present. PostgreSQL used 15,076,499 bytes of the configured 500 MB quota. Supabase object storage used 11,072,123 bytes of its 1 GB quota. Both cleared the 200 MB reserve. EC2 reported about 1.1 GiB available memory and 23 GiB free on its root volume during the release check. ERA5 retained PID 124832 with 16 of 227 snapshots verified and 1990 listed as the current year. [Follow-up backend deployment](https://github.com/TUF-SCAR/OrbitWatch/actions/runs/45807605449)

Authenticated production checks verified the accepted Cloudflare origin and rejected unrelated origin, registration and login, owner-only saved locations, preference persistence across independent sessions and logout revocation. Revoking one session left the other session usable. All eight disposable accounts created during the smoke attempts were removed by matching their recorded IDs, usernames and emails. An earlier browser-fixture log showed a satellite planning TypeError. The focused catalogue request returned four expected entries in both the repeated isolated fixture and the authenticated production check. The recent API journal showed no matching production error. The production worker reported configured VAPID and a recent recurring heartbeat. Chromium rejected push enrollment with “Registration failed - permission denied” in the temporary isolated context. A second attempt with a disposable persistent Chrome profile timed out waiting for enrollment. Both attempts stopped before the test could reach a push provider. Actual foreground, background-tab, closed-tab and physical-device delivery remain unverified.

For a physical-device check, sign in on the deployed site and open the bell, then open **Browser notification settings** and choose **Enable browser notifications**. Allow the browser and operating-system prompt when offered. Choose **Send test notification** and check that **OrbitWatch delivery test** appears in the system notification center. Repeat once after switching to a different tab or app and tap the alert to reopen the inbox. To verify closed-tab delivery, send a fresh test and close the OrbitWatch tab immediately, leaving the browser running. If that test appears before the tab closes, repeat later and treat it as a foreground result. On iOS, first add OrbitWatch to the Home Screen and open it from that icon. The test limit is three requests per five minutes per account.

## V6 Batch F.1 — Scientific accuracy

The Time Explorer Moon now shares the analytical position model with Live and the rendered orbit track. The largest tested Horizons XYZ error fell from 93,973 km to 1,106 km. The satellite API validates identity, checksum and epoch and applies the seven-day Live age band. Time Explorer preserves its independent 24-hour policy and identifies older archive windows. Schematic celestial placements disclose their limitations in the inspector. The existing API scheduler owner now refreshes due Natural Events feeds under their shared budgets. The [scientific accuracy audit](scientific-accuracy-audit.md) records the reference values, data retention limits, test results and production readings.

The AWS and Cloudflare checks passed for `6d575e5`. All five Natural Events caches revalidated during read-only inspection. ERA5 stayed active at PID 124832 with 16/227 published, and both Supabase quotas remained above the required free-capacity reserve. [Backend deployment](https://github.com/TUF-SCAR/OrbitWatch/actions/runs/45816421551)
