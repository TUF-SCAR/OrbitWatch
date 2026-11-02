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
