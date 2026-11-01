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
