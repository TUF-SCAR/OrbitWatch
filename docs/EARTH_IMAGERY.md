# Earth imagery and provider configuration — 12 October 2026

## Ownership and truthful provider state

`earthMapProviders.js` contains factories; `baseMap.js` owns asynchronous switching.
It validates metadata and a real root image before atomically replacing the old
layer, cancels superseded work, rejects late completions and releases error
listeners. The gallery tick indicates the **actual active** map, not merely the
requested map. Missing keys show UNCONFIGURED; configured failures show
UNAVAILABLE with a deliberate retry. One imagery layer remains after each switch.
Google and the raster globe share active-provider visibility through Earth LOD.
No unkeyed CARTO requests or unauthorized substitute URLs are used.

Live retains Google Photorealistic, Bing Aerial/Labels/Road via Cesium ion, Esri
World Imagery and OpenStreetMap, plus NASA Blue Marble reference. Provider credits
remain visible. Raster fallback is Esri then the existing credited local
NASA/JPL/USGS Earth texture. Reference imagery is not live weather or current
photography. Time uses a separate dedicated NASA service and never overwrites
the Live gallery preference.

## Google diagnosis and retry

The configured token was tested, with explicit user authorization, against its
intended Cesium service using the normal localhost origin. Google asset 2275207
and Bing assets 2/3 returned HTTP 200 on 12 October; Google visibly rendered with
attribution. A quota/permission failure was **not** reproduced in this session.
Two code defects were identified: Earth LOD previously forced Google and the
globe visible regardless of active map; Cesium 1.144's convenience Google factory
caches a rejected endpoint promise, preventing a genuine retry after failure.

`googleEarth.js` uses public `Cesium3DTileset.fromIonAssetId(2275207, options)`
to obtain a fresh endpoint on an explicit retry/new creation. The same asset,
credits and Google-only geocoder remain. Loader guards, root-specific callbacks
and cleanup prevent late/off-Earth results. Manual retry warms a raster surface
before releasing a failed Google root. Endpoint/tile failures report sanitized
status codes; credentials and request URLs are never logged by application code.
Browser fault injection verifies403 fallback and later recovery.

If the deployed host fails: check the token's asset access and allowed URLs in
Cesium ion, account Google access/quota and the browser's sanitized HTTP status.
401/403 indicates authorization/origin restrictions;429 indicates quota/rate
limits. Confirm the deployed origin is allowed, rebuild after configuration and
select Google to retry. Do not print or share the token in an issue/log.

## CARTO key (external configuration still required)

Follow [CARTO's official key instructions](https://www.carto.com/basemaps/apikey/index.html)
and [Basemaps dashboard](https://dashboard.basemaps.carto.com/). Obtain a browser
Basemaps key manually and restrict allowed Referer domains to the exact local
hosts you use (localhost/127.0.0.1) and the deployed application host, using the
dashboard's accepted format. Add `VITE_CARTO_API_KEY` to ignored
`frontend/.env.local`; restart Vite, or rebuild the deployed frontend. This key
is intentionally browser-facing: rely on provider origin restrictions/quota,
never reuse a private backend credential.

Dark uses `dark_all`/`dark_nolabels`; Voyager uses
`rastertiles/voyager`/`voyager_nolabels`. URLs include the encoded `key` query
parameter, with CARTO/OpenStreetMap attribution. The current environment has no
CARTO key, so real authorized Dark/Voyager rendering is not signed off. Unit
checks verify key gating/paths. After setup, verify both styles, labels, credits
and absence of any unauthorized/key-required watermark; HTTP 200 alone is not
proof of authorized clean tiles. No account/key was created by this batch.

## NASA Time Explorer coverage

[Official GIBS access documentation](https://nasa-gibs.github.io/gibs-api-docs/access-basics/)
and the live [Web Mercator capabilities](https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi?SERVICE=WMTS&REQUEST=GetCapabilities)
are the source of layer/matrix/time coverage. Current verified product:
`MODIS_Terra_CorrectedReflectance_TrueColor`, JPEG,256 px tiles,
`GoogleMapsCompatible_Level9` (levels0–9). Production fetches current XML; the
small checked-in domain snapshot is test evidence only. Successful metadata is
cached for an hour within the Viewer-owned service. Requests have abort/deadline
handling and stale selection results cannot apply.

The selected **UTC day** must occur in the product's advertised daily intervals
(`P1D`). There is no nearest-day substitution. The 12 October metadata spans
2000-02-24 through 2026-10-12 with real gaps (for example2025-08-09 and
2022-10-11 through2022-10-22). These are observation-day visualizations with
cloud/swath/coverage gaps, not an exact selected-hour snapshot or complete global
measurement layer. The dock shows source/product and actual observation day.

Future instants, absent dates and unverified metadata use fixed
`BlueMarble_ShadedRelief_Bathymetry`, `GoogleMapsCompatible_Level8`, with an
explicit reference notice and no date in its URL. All future selections share
one provider key; changing a future timestamp never generates fake imagery.
If imagery itself fails, Time falls back to NASA reference, then the existing
undated NASA/JPL/USGS texture; it never silently substitutes current Esri imagery
as a historical observation. Scene time remains independent of image coverage.

Genuine browser checks: archived2024-06-01 imagery/root JPEG; advertised
2025-08-09 gap; 2030/2040 fixed reference ownership; Earth↔Mars↔Jupiter return
restoration. Daily selections and future fallback retain one scene/layer and
one outgoing error-listener owner. Historical satellite/weather data is a
separate pending backend batch.

## 13 October loading/quality pass

Time entry and committed date changes now cover the viewport while preparing
same-time scene frames and visible tiles in the shared Viewer. Edits coalesce
300ms; newer committed requests cancel stale imagery application. Hour changes
within the same UTC imagery day retain the provider. Capabilities are date-
independent: canceled dates share one bounded fetch, released on Viewer disposal.
Successful metadata caches an hour; failures respect Retry-After and exponential
backoff with up to15s jitter. Readiness has a timeout and explicit retry/fallback;
instant local computations incur no artificial multi-second minimum.

Representative2000/2010/2020/2024 root images were valid; this does not prove
uniform coverage/quality for every tile/day. MODIS cloud/swath gaps and limited
resolution remain honest data limitations, with maximum level9 respected. A
Mercator tile matrix also ends near ±85.05° latitude; polar coverage is not a
complete global observation map. Valid root tiles do not certify every visible
swath or eliminate real cloud/coverage gaps.
The View reference map control supplies a clearly labeled fixed nonhistorical NASA
composite while retaining selected time. It does not fill daily black gaps with
unlabeled observations. If NASA reference tiles fail, only the credited static
local reference is used, never current Esri as a Time reference. Injected metadata
failure and retry/recovery were browser-checked; no large tile-grid download.
