# Live Earth weather

Implemented and validated locally on 23 October 2026, from main `55bb762`.
This feature belongs exclusively to **Live → Earth**. Time Explorer and its
existing imagery are unchanged. No historical weather ingestion is implemented.

## Sources and scientific meaning

The global field is NOAA/NCEP **GFS 2-metre air temperature**, from the official
[1-degree GRIB catalog](https://www.nco.ncep.noaa.gov/pmb/products/gfs/nomads/).
The NOMADS filter requests only `TMP` at `2 m above ground` from
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
and within140–360K. The decoder rejects unexpected fields and multiple messages.

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
Only one external weather request runs at a time; concurrent cold misses may get
503/Retry-After30 rather than duplicate downloads. Warm readers share the field.

There is **no startup weather ingestion**. A global weather request can schedule
one background revalidation job when a newer target exists. Cached data returns
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

The browser polls an active global field every10min, or30s after failures/pending
revalidation; manual checks have a30s cooldown. Location requests require an
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
