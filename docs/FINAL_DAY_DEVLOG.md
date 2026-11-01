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
