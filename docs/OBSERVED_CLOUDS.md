# Live Earth observed clouds — 26 October 2026

The Clouds selector uses explicitly labeled infrared observations, with an
explicitly labeled NOAA GFS modeled-cloud fallback when observations fail and
no cached observation exists. Both retain their source times. See
[WEATHER_VISUALS.md](WEATHER_VISUALS.md) for the current regional rendering pass.

## Source evaluation and decision

| Source | Verified product/access | Decision |
| --- | --- | --- |
| NASA GIBS / Worldview | Public WMTS/WMS; geographic and Mercator grids; capability metadata supplies actual dates and gaps. GOES East/West and Himawari clean IR are advertised every ten minutes at the 2 km visualization tile matrix. Daily MODIS cloud fraction/top products also exist. | Good official imagery access, but these three geostationary views alone leave the European/African/Indian Ocean coverage problem. Daily cloud retrievals are not continuous ten-minute global observations. |
| NOAA GOES | GeoColor mixes daytime reflected light, nighttime infrared and a static night-light background. Clean IR works day/night, with geostationary coverage limits. | GeoColor is not transparent cloud-only imagery. Do not lay its land/city-light background over the map while describing it as clouds. |
| EUMETSAT EUMETView | Public CORS-enabled WMS; `mumi:worldcloudmap_ir108`, Geostationary Ring IR10.8 µm Image. Actual advertised three-hourly composite slots. Geographic WMS PNG/JPEG verified. | Chosen: one multi-mission mosaic includes the Indian Ocean, GOES and Himawari regions. No API key needed for this tested public visualization endpoint. |
| JMA Himawari | Official imagery includes real-time full-disk/region products; operational dissemination includes HimawariCloud/Cast and registered services. Product-specific terms apply to enhanced RGB. | No scraping or extra credentials. The chosen EUMETSAT mosaic supplies the Himawari sector with attribution. |

Primary references:
- [NASA GIBS access](https://nasa-gibs.github.io/gibs-api-docs/access-basics/) and [visualizations](https://nasa-gibs.github.io/gibs-api-docs/available-visualizations/)
- [NASA Worldview temporal configuration](https://github.com/nasa-gibs/worldview/blob/main/doc/config/layers.md)
- [NOAA GeoColor quick guide](https://www.star.nesdis.noaa.gov/goes/documents/QuickGuide_CIRA_Geocolor_20171019.pdf)
- [EUMETView product](https://view.eumetsat.int/productviewer/productDetails/mumi%3Aworldcloudmap_ir108), [data policy](https://www.eumetsat.int/legal-framework/data-policy), [terms](https://www.eumetsat.int/about-us/terms-use)
- [JMA dissemination](https://www.jma.go.jp/jma/jma-eng/satellite/dissemination.html) and [Himawari imagery](https://ds.data.jma.go.jp/mscweb/data/himawari/index.html)

EUMETView capabilities advertise no fees/access constraints. This does not make
all underlying satellite products CC BY or public domain. Attribution remains
visible and the EUMETSAT/third-party policies apply. Public/commercial deployment
must review the applicable product terms; this implementation does not assert a
new redistribution licence. No Zoom Earth assets, imagery or code are used.
No numeric upstream WMS rate limit was found in the inspected official sources;
the application's conservative caps below are self-imposed, not a claimed quota.

## Scientific presentation

WMS 1.1.1 uses EPSG:4326 with longitude/latitude bbox `-180,-90,180,90`.
This avoids WMS 1.3 latitude/longitude axis ambiguity. The source mosaic has
polar gaps, uneven viewing geometry and inter-satellite seams. Its timestamp is
the provider's composite slot, not a simultaneous observation at every pixel.
Only advertised slots at or before the current clock are accepted. Unsupported
cadences fail closed. No forecast time, scan interval or source epoch is invented.

The real grayscale infrared visualization is transferred to white opacity:
`alpha = sourceAlpha * clamp((brightness - 85) / 170, 0, 1)^1.05`.
This is **cold-cloud emphasis, not a cloud mask or calibrated temperature**.
Warm low clouds can be omitted; cold land, snow and ice can remain visible.
Alpha is not cloud fraction. No synthetic noise, cloud placement, advection,
sharpening or meteorological interpolation is added. JPEG's black no-data
background maps to zero opacity. Existing globe lighting dims the display at
night, despite infrared observations being available day and night.

The prior PNG sample was 1,852,720 bytes at 2048×1024; an actual browser PNG
transfer timed out. The same slot's supported JPEG was 208,894 bytes and arrived
in 2.86 seconds in the direct diagnostic. JPEG is a visualization product, not
quantitative radiance. Transfer times depend on provider/network conditions.

## Rendering and budgets

Evaluated Cesium's maintained open-source
[WebMapServiceImageryProvider](https://cesium.com/learn/cesiumjs/ref-doc/WebMapServiceImageryProvider.html).
For this bounded short animation, request one geographic WMS image per frame
and use the project's existing native `SingleTileImageryProvider` approach.
This avoids a tile-request fan-out on every frame/camera movement. It also means
regional zoom has a deliberate resolution ceiling; no false sub-grid detail.
There is no new rendering dependency, cloud mesh, custom shader or second Viewer.

| Preset | Image grid | Cached frames / time span | Equatorial display spacing | RGBA per decoded frame |
| --- | --- | --- | --- | --- |
| Performance |1024×512|2 / 3 h|39.1 km|2 MiB|
| Balanced / Auto |2048×1024|3 / 6 h|19.6 km|8 MiB|
| Quality |4096×2048|4 / 9 h|9.8 km|32 MiB|

Settings live in `frontend/src/services/cloudConfig.js`. These are display
sampling budgets, not claims about uniform sensor resolution. Quality samples
more actual image detail, rather than enlarging the GFS 1° field. The cache holds
compressed processed blobs; only the current/previous imagery layers are resident.
During transition there are at most two layers; intermediate canvases/bitmaps
are released. GPU/driver copies and temporary decoding allocations add to the
table above; it is not a total VRAM or whole-app FPS guarantee.

## Playback, failure and ownership

- Latest verified frame appears first. Older frames load serially into a bounded
  cache. Playback is opt-in and disabled with fewer than two frames.
- Play starts at the oldest loaded slot, advances every 2.4 seconds, and stops
  at the newest. The 650 ms crossfade is explicitly a display transition between
  actual images. There is no fictional intermediate observation or orbit-clock change.
- Replaying resident frames makes no HTTP calls. Opacity does not request new imagery. Settled regional camera changes can
  request bounded same-slot detail; global playback makes no regional requests. Re-entering with fresh metadata reuses blobs.
- Metadata is cached for 15 minutes; refresh does not bypass that cache. At most
  24 attempted requests per 15-minute Live session window. Failed requests get
  at least 120 seconds backoff, respecting longer Retry-After. Timeout is 60 seconds.
  No automatic endless provider retry loop. Requests omit credentials.
- On a provider failure, a successfully loaded frame retains its original time.
  Without a usable observation, the UI reports unavailability and explicitly identifies the
  automatic modeled fallback. A local display/decode failure clears the misleading
  observation display and reports the error. No silent alternate-date substitution.
- Hidden pages pause playback and abort preparation. Layer disable/switch,
  incompatible Google 3D, travel and Time Explorer stop activity and remove cloud
  layers. Reduced motion disables autoplay and crossfade motion; manual still
  frame selection remains. Logout unmounts the owner, cancels listeners/timers/
  requests and revokes every cached blob URL.
- Caps are per application session, not an account-wide durable server lease.
  Reloads/new clients have separate caches. Existing NOAA, Open-Meteo, event and
  satellite backend quotas, authentication and database code are unchanged.

## Verification and evidence

`frontend/tests/cloudImagery.test.js` covers slots/gaps/future bounds, projection,
monotonic transfer/no-data, all profile/cache budgets, repeated playback with no
HTTP, quality eviction, cancelled late URLs, Retry-After/cached outage behavior,
request ceiling, invalid payloads, two-layer ownership, opacity, reduced motion,
late travel/logout completions and local decode failure reporting. Wind has seven
tests including hysteretic adaptive recovery, renewed overload, restart/reset and
unchanged zoom warm-seeding/motion. Provider tests are mocked.

Native evidence and the eight-second real playback recording are indexed in
`.orbitwatch-backups/clouds/README.md`. The checkpoint distinguishes completed
native checks from environment-blocked checks. Full frontend suite: 118 passing
as of the final acceptance run. Existing weather/backend generated ecCodes
contracts pass with zero provider HTTP. ESLint, production build and whitespace
checks pass after the final implementation edit; existing bundle-size/plugin
advisories remain. Native mobile viewport emulation was ineffective, and a native
OS reduced-motion override was unavailable: those checks remain manual rather
than being counted as passes. Deterministic reduced-motion/lifecycle tests pass.
