> Live Earth now offers **Observed clouds · infrared** (EUMETSAT real composite slots) separately from **Modeled cloud coverage** (GFS). See [OBSERVED_CLOUDS.md](OBSERVED_CLOUDS.md) for source research, scientific limitations, playback, budgets and validation.

> Surface Wind now uses animated, depth-tested flow instead of baked arrows. See [WIND_FLOW.md](WIND_FLOW.md) for scientific limitations, tuning, library evaluation and native validation. Temperature, precipitation and modeled cloud coverage retain their approved renderer.

# Live Earth weather

Initial implementation from `55bb762`; reliability continuation and global fields/
events expansion on the preserved `ac36865` working tree,23October2026.
This feature belongs exclusively to **Live → Earth**. Time Explorer and its
existing imagery are unchanged. No historical weather ingestion is implemented.


## Global field expansion

One NOAA reservation/download supplies all fields; changing a field or opening a
panel never makes an independent per-variable NOAA request. `/api/weather/fields`
returns the existing temperature envelope plus `fields.clouds`,
`fields.precipitation` and `fields.wind`. `/temperature` remains compatible.
Each scalar has65,160 NW-ordered nodes; wind has signed eastward `u` and northward
`v`. Same missing-node, geography, coverage, UTC and freshness safeguards apply.

| Field | Verified GRIB signature / source units | Display |
| --- | --- | --- |
| Temperature |2t,heightAboveGround2,K,instant |°C |
| Clouds |tcc,atmosphere0,%,instant |Model total cloud coverage,%,white/gray alpha |
| Precipitation |prate,surface0,kg m^-2 s^-1,instant |Liquid-equivalent **rate**,mm/h,source×3600; includes frozen precipitation, **not accumulation** |
| Wind |10u/10v,heightAboveGround10,m s^-1,instant |10m speed,m/s,and animated geographic flow; see WIND_FLOW.md |

The official live NOAA inventory was checked before implementing. It contains
both instant and averaged PRATE/TCDC; these are not interchangeable. The grouped
filter returns eight messages for the verified file; extra surface temperature
and averaged fields are ignored, never selected instead of the required fields.
Bundle bound16MB/16messages; no change to NOAA30min/4hour/32day budget.

A single dominant field is visible. Pixel interpolation does not add resolution.
Wind uses the approved bounded particle renderer from the actual east/north components; see WIND_FLOW.md for WGS84 advection and accelerated visual time. Modeled Cloud Coverage is **GFS forecast cloud fraction**, never called satellite observations. The separate Observed Clouds infrared choice is documented in OBSERVED_CLOUDS.md.

### Readability and reversible presentation

Native same-camera comparisons (`weather-events/compare-*.jpg`) isolated additive
ground scattering as the sunlit washout. Fog-off did not fix it; ground-off
flattened the night presentation; sunlight-off made it worse. The final owner
reduces only `globe.atmosphereLightIntensity` from its captured value toward1
while weather alpha fades in. Ground atmosphere, sky atmosphere, fog, real sunlight
and day/night flags remain untouched. It smoothly restores the **exact prior
intensity** when fading out, or immediately on travel/Time/incompatibility/destroy.
Native default10->1->10 and automated nondefault7.25 restoration were checked.
The DEV-only `/?weatherCompare` harness offers explicit native comparison buttons;
it is not included in production. Normal app navigation strips that query after
startup; the module captures the opt-in before authentication navigation.

Raster imagery works on the globe. Google Photorealistic3D Tiles is a separate
surface and remains explicitly unsupported for draped fields; an intentional
Esri switch is offered. A second raster sphere over Google's surface would
misrepresent the visualization, so it was not used. Event billboards can coexist
with Google because they are independent reported-location symbols.

### Observed cloud investigation

The actual NASA GIBS WMTS capabilities include
`MODIS_Terra_Cloud_Fraction_Day` / `MODIS_Aqua_Cloud_Fraction_Day` and night variants,
with daily dates through23October2026. These are dated satellite swath products,
with observation/sampling gaps and different day/night coverage, not an
instantaneous continuous cloud globe. No observed-cloud layer is enabled in this
batch; it is not silently substituted for GFS. See [GIBS metadata](https://gibs.earthdata.nasa.gov/layer-metadata/v1.0/)
and [MODIS cloud products](https://modis.gsfc.nasa.gov/data/dataprod/mod06.php).
Reported incidents are documented separately in [Natural events](NATURAL_EVENTS.md).

## Sources and scientific meaning

The global field is NOAA/NCEP **GFS 2-metre air temperature**, from the official
[1-degree GRIB catalog](https://www.nco.ncep.noaa.gov/pmb/products/gfs/nomads/).
The NOMADS filter now groups `TMP` at2m, `TCDC` through the atmosphere,
instantaneous `PRATE` at the surface, and `UGRD`/`VGRD` at10m from
`gfs.YYYYMMDD/HH/atmos/gfs.tHHz.pgrb2.1p00.fFFF`. This is a genuine global field,
not a reconstruction from point readings. NOAA US government data is public
domain; NOAA/NCEP attribution remains in the panel, legend and Cesium credits.

The service selects a six-hour cycle at least six hours old, then the latest
three-hour forecast valid time no later than now. This deliberately trades some
recency for reliable publication availability. GRIB initialization and valid time
must match the requested cycle/step; retrieval time is recorded separately.
Metadata distinguishes analysis from forecast; the current retrieval policy
normally supplies a forecast. A forecast is never described as an observation.

The native grid is **1° × 1°, 360 longitude nodes × 181 latitude nodes**,
65,160 values including both poles. ecCodes verifies variable, height, Kelvin
units, regular latitude/longitude geometry, coordinate uniqueness/alignment,
coverage and timestamps. Values are converted by `K − 273.15` and rounded to
0.1°C. The API orders rows from 90°N to 90°S and columns from 180°W to179°E;
longitude wraps, missing nodes remain null. At least95% of nodes must be valid
and within140–360K. The original temperature decoder still requires exactly one temperature message.
`weather_fields.py` now validates a bounded multi-message bundle, accepts only the
correct instantaneous field/level signatures, excludes averaged alternatives and
requires matching initialization/valid times for all five components.

Selected-location values use [Open-Meteo's forecast API](https://open-meteo.com/en/docs)
with explicit `models=gfs_global`. Implemented variables:

| API variable | Display / unit |
| --- | --- |
| `temperature_2m` | Temperature, °C |
| `apparent_temperature` | Feels like, °C |
| `relative_humidity_2m` | Relative humidity, % |
| `wind_speed_10m` | Wind speed, m/s |
| `wind_direction_10m` | Direction wind comes from, degrees |
| `precipitation` | Accumulation, mm over returned interval (verified900s) |
| `cloud_cover` | Cloud cover, % |
| `weather_code` | WMO condition, translated to text |

These are **current model estimates**, not station measurements. Open-Meteo
processes/elevation-adjusts GFS data; a local value need not equal the coarse
NOAA grid at that coordinate. Requests specify Celsius, m/s, mm and Unix UTC.
Actual valid time, interval, retrieval time, requested coordinates and returned
model-cell coordinates are retained. This endpoint supplies no initialization
timestamp, so the API returns null rather than inventing one. Missing variables
display Unavailable. Public example coordinates are not geolocation permission.

Open-Meteo's [free terms](https://open-meteo.com/en/terms) permit noncommercial use
within published limits (10,000/day,5,000/hour,600/minute); data requires
[CC BY4.0 attribution](https://creativecommons.org/licenses/by/4.0/). This college
project uses the free noncommercial endpoint, no account/key/payment service.
Reassess terms before commercial release. Neither source is a safety-critical
weather/warning service, and a1° field cannot resolve street-scale weather.

## Protected API and storage

All three routes use the existing JWT/user/database availability dependency and
return `Cache-Control: private, no-store`:

- `GET /api/weather/temperature`: normalized field, grid and metadata,
  `state`, `cache_age_seconds`, `valid_age_seconds`, optional `refresh_pending`.
- `GET /api/weather/location?latitude=…&longitude=…`: eight current variables,
  units and original timestamps. Invalid coordinates return422.
- `GET /api/weather/status`: cache availability/freshness and provider cooldowns;
  **never starts a provider download**.

No Supabase table/schema/account/record change is required. `weather_cache.py`
uses independent bounded SQLite files under `backend/.runtime/weather`, retaining
two global fields and256 locations. Global keys include actual model cycle/valid
time; points use0.1° rounded keys with antimeridian/signed-zero normalization.
All same-host workers share the store, an OS file lease and atomic reservations.
Only one external weather request runs at a time. Cold requests start one
background preparation job and return a small202 state envelope immediately,
instead of waiting for network/GRIB work inside the API request. Concurrent
readers share that job and then the completed field. A no-field provider
cooldown/unavailable state returns503 with the legitimate `Retry-After`, not a
fixed30-second hint. Warm readers share the field.

There is **no startup weather ingestion**. An authenticated global weather request
can schedule one background cold preparation/revalidation job when needed. The
local ecCodes dependency is checked before spending a NOAA reservation. Cached data returns
immediately, explicitly stale with its original valid time; repeated requests
cannot create an unbounded job queue. Point requests reuse the15-minute cache;
refresh failure can return a retained, explicitly stale point. Global fields
become stale after6h of valid/retrieval age and expire at24h valid age. Point
responses become stale after30min valid/15min retrieval age and expire at3h valid
age. Implausibly future valid times are refused. Frontend global freshness also
advances locally while the network is unavailable.

| Provider | Minimum spacing (+jitter) | Shared hourly / daily cap | Failure backoff |
| --- | --- | --- | --- |
| NOAA NOMADS |30min |4 /32 |30min doubling, capped6h |
| Open-Meteo |2s |60 /500 |60s doubling, capped6h |

These conservative application limits are deliberately below public quotas.
[NOMADS filter guidance](https://nomads.ncep.noaa.gov/info.php?page=gribfilter)
asks automated clients to space repeated requests by at least10seconds; this
implementation waits much longer. Failures count against persisted budgets,
including across restarts; numeric/date Retry-After can extend the gate. There
are no automatic HTTP retries/redirects. Connect timeout5s, read timeout20s,
response cap2MB global/100KB point. A database availability check occurs before
any external request; protected routes retain existing outage behavior.

The browser polls a healthy field every10min; active preparation normally every3s,
or after the exact retry interval in the backend state envelope. NOAA cooldowns
survive panel/mode reopen and manual checks. Network/transport errors back off60s.
Manual checks retain their30s UI cooldown and cannot bypass a server deadline.
Location requests require an
explicit form submission or **Weather at view centre** action, with2s client
spacing. Mouse/camera movement never requests point weather. No per-user provider
download, polling of all coordinates or model-file sweep exists.

## Cesium and controls

Open **Weather** in the existing scene dock, or press **W** on Live Earth.
Enable Temperature layer and adjust opacity0–80% (default55%). The fixed Celsius
palette saturates at−60/+60°C; missing samples are transparent. The global valid
time and1° source are always visible in the open panel or floating legend.
Data & accuracy contains initialization/retrieval details and model limitations.

`temperatureGrid.js` performs wrapped bilinear sampling into a720×360 texture;
this smooths pixels, **does not increase the1° model resolution**, and preserves
the source geography. `temperatureLayer.js` owns one tagged Cesium
SingleTileImageryProvider/ImageryLayer in the existing Viewer. Opacity uses a350ms
Cesium render fade, immediate for reduced motion. Static data is not recomputed
each frame; repeated alpha updates do not recreate the provider. Satellite paths
and camera/Follow state are untouched.

Raster basemap replacement inserts the new base below the weather layer and
preserves it. Google Photorealistic3D Tiles **cannot accept this globe imagery
overlay**. The panel explicitly explains this and offers **Use Esri for weather**;
only that deliberate user action changes the map. Google is not silently replaced
and never falsely presented as weather-compatible. Existing provider fallback and
credits remain. Weather disappears during travel, off Earth, in Time and on
logout; returning to Live Earth restores the enabled layer from valid cache.
The owner destroys its imagery and render listener; React aborts active requests
and clears timers. Exactly one Cesium Viewer remains.

## Installation and deployment qualification

Install CPython3.12 dependencies from `backend/requirements.lock` in a fresh venv,
then run `python -m eccodes selfcheck`, `pip check` and `tests/check_weather.py`.
The direct addition is **ecCodes2.50.0**; NumPy already belongs to Skyfield's
environment. No GDAL/xarray/Pillow conversion stack or separate executable is
needed. The official Windows wheel includes its native decoder; this batch
verified a clean Windows installation and decoding a real complex-packed GRIB.

[ECMWF's Python package](https://github.com/ecmwf/eccodes-python) uses eccodeslib
on Linux/macOS; the lock pins2.50.0.33 behind a non-Windows marker. Those platforms
were **not run locally**: qualify the actual host's wheel/OS/architecture and
clean install before deployment. Current binary support can require recent
glibc/macOS. Do not copy a Windows venv onto a different host.

- `ORBITWATCH_WEATHER_PROVIDER_REQUESTS=true` enables real weather requests;
  false serves only still-valid cache (used during browser/stress verification).
- `ORBITWATCH_WEATHER_CACHE_DIR` optionally selects a persistent writable local
  directory; default `backend/.runtime/weather`.
- Use **one weather API host** with a persistent shared local cache for its
  workers. Separate hosts/private containers with independent stores multiply
  quotas; a network SQLite volume is not a distributed coordination solution.
  Route `/api/weather/*` to that designated host. This batch adds no distributed
  lease or paid provider contract.

**Upstream lifecycle risk:** NOAA's official
[GFSv17 proposal PNS26-30](https://www.weather.gov/media/notification/pdf_2026/pns26-30_CommentsGFSv17_ProductRemoval.pdf)
proposes removing1°/0.5° forecasts and their filters, without an implementation
date in that notice. The1° source actually worked on23October2026. Monitor the
transition and requalify a supported global resolution/source when scheduled;
no speculative0.25° fallback or fake global field is installed. Provider downtime
shows stale/unavailable states rather than fabricated weather.

## Validation and request accounting

Actual weather-data HTTP requests in this batch: **4 total: NOAA2 + Open-Meteo2**.
Each Open-Meteo call batched three public locations (six location-equivalent
calls total). No weather stress test repeatedly contacted either provider.
Documentation/package downloads are not weather-data API calls.

Final genuine NOAA field:06Z initialization,15Z valid23October2026,
`20261023/gfs.t06z.pgrb2.1p00.f009`,360×181. Earlier realf006 decode contained
zero missing nodes,−51.9…45.6°C and plausible Hyderabad/Sydney samples. Final
Open-Meteo15Z values: Hyderabad25.8°C, London8.6°C, Sydney18.6°C, with all eight
variables and original metadata verified. These records, not synthetic weather,
were then cached for actual React/Cesium/WebGL validation with external providers
disabled. Browser accounts and six TLE records were synthetic in disposable local
SQLite; actual FastAPI JWT/protected routes/SGP4 were used. No production DB was
accessed or changed by these weather tests.

Automated checks cover generated GRIB conversion/orientation/invalid messages,
all-longitude wrapping/poles/missing samples, shared concurrent/persistent quotas,
cached multi-user reads, timeout/429/recovery, stale/hard expiry, DB gate,
protected200/401/422/503 routes and imagery/listener cleanup. Full frontend94tests,
lint/build,39 backend contracts, reliability/availability/provider-budget suites
pass. Existing TestClient deprecation and build chunk-size advisories remain.

Native browser checks include genuine global rendering/legend, three locations,
stale labeling, opacity/toggle, satellite selection/Follow preservation,
Esri/OpenStreetMap/Google handoffs, Earth→Mars→Earth, Time gating, responsive
390×844/390×667 and logout. Evidence and sanitized runtime diagnostics are in
`.orbitwatch-backups/weather/README.md`. Hosted provider permissions, target-OS
runtime and deployed end-to-end operation remain release qualifications, not
claims of this local implementation.

## Normal-application reliability follow-up (baseline ac36865)

The first implementation's native browser acceptance used an isolated account/API
and a separate cache of genuine recordings. It did **not** certify the user's
normal cache, Python environment or cold initialization. The follow-up found:

- Normal `backend/.runtime/weather` contained **zero global fields** and one failed
  NOAA reservation at15:55:47UTC on23October. Its next permitted attempt was
  **16:25:52.653711UTC**. Subsequent503 responses were enforced cooldowns with no
  field to return. Five successful location records were present.
- SQLite quick_check passed, the directory was writable, and the download lease
  was free. Weather overrides were absent: the default normal directory/provider
  setting was intended. No API was listening when inspection began.
- The original error category was **not persisted**, so a timeout, upstream HTTP
  failure or decoder failure cannot be assigned retroactively. No historical raw
  traceback was available. Do not reinterpret the later success as proof of the
  original trigger.

Confirmed design defects were synchronous cold preparation behind a10s frontend
timeout, generic503/Retry-After30 regardless of the real cooldown, unconditional
30s retries and loss of useful failure diagnostics. Global initialization is now
background single-flight. The general10s API/auth timeout is unchanged.

`202` envelopes distinguish `preparing`, `downloading`, `decoding`. No-field503
envelopes distinguish `cooldown`, `failed`, `unavailable`; `data_state` separately
identifies empty/hard-expired data. Usable200 fields retain available/stale state
and carry refresh availability. Envelopes contain `has_field`,
`retry_after_seconds`, UTC `next_attempt_at`, safe `last_failure` category/status/
count and provider-enabled state. The panel never presents a checkbox as proof
that a field is loaded. Expired fields are hidden. Retained usable fields keep
their original valid time during failure.

A small independent local-cache `activity` table records phases and sanitized
categories (`timeout`, `network_error`, `http_error`, `invalid_data`,
`decoder_unavailable`, `processing_error`), not exception text, credentials or
URLs. Existing gates/calls/data are retained, not deleted or reset. An abandoned
phase is not treated as an active download without a live job/OS lease. Hour/day
quota exhaustion also contributes to the real retry deadline. Status reads do not
start provider work.

After the original deadline elapsed naturally, **one** real NOAA attempt through
the service and normal configuration/cache succeeded at16:26:34UTC:360×181,
65,160 nodes, zero missing,06Z initialization/15Z valid,
`20261023/gfs.t06z.pgrb2.1p00.f009`. Cold service response took15ms. No recorded
test grid was copied into the normal cache. The normal cache's total NOAA calls
changed1→2, and successful completion cleared its failure count normally.

The actual localhost5173→127.0.0.1:8000 application was then verified with the
user's existing testing account and normal database/config/cache: protected
temperature200, location200, real Cesium Esri overlay, source/valid time, legend,
opacity/toggle and ISS selection/Follow. One genuine Open-Meteo call returned
Hyderabad25°C at16:30UTC; repeated location requests reused it. **Follow-up data
HTTP total:2 (NOAA1 + Open-Meteo1)**, separate from the original batch's four.
Normal backend restart preserved exact provider gates, call counts and field
identity; no extra NOAA retrieval occurred. Satellite ingestion was disabled
during this verification; no Supabase records/accounts/schema were modified.

Use an explicitly installed pinned runtime, not an arbitrary PATH Python:

```powershell
.venv/Scripts/python.exe -m pip install -r backend/requirements.lock
.venv/Scripts/python.exe -m eccodes selfcheck
.venv/Scripts/python.exe -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000
```

The local test used a clean pinned venv under the ignored backups;
that test environment is not a deployment path. Repeated failure/concurrency/
recovery/cold routes use mocked HTTP and disposable cache only, never a reset of
normal cooldowns. See `.orbitwatch-backups/weather-reliability/README.md` for the
normal-app screenshots, exact metadata/counts and test results.

The long-running normal UI check also demonstrated a held point reading still
labeled CURRENT MODEL after16.3min retrieval age. The frontend now applies the
same15min retrieval/30min valid stale thresholds and3h hard expiry as the backend,
using original timestamps and no automatic point-provider request. Boundary tests
cover these cases. Development HMR reset the panel afterward; final normal field
rendering was rechecked after that reload.
# Cloud and precipitation refinement

The current single Clouds mode, observed/model fallback disclosure, regional
imagery sampling and symbolic precipitation streaks are described in
[WEATHER_VISUALS.md](WEATHER_VISUALS.md). Earlier implementation notes below
remain useful background; the refinement document defines the current controls.
