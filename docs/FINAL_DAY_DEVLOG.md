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
