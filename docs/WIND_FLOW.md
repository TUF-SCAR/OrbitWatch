# Surface Wind flow

The Surface Wind field uses the existing protected `/api/weather/fields` response, unmodified NOAA one-degree U/V nodes, model initialization/valid time, cache and provider gates. No requests are made by particle animation. Other weather variables and Orbit Trace are unchanged.

## Technique and compatibility

Original implementation: CPU midpoint (RK2) advection and a single instanced Cesium WebGL draw of persistent geographic trail segments. Positions are Earth-fixed WGS84, U eastward and V northward; longitude wraps and latitude-dependent WGS84 metric factors convert m/s to angular displacement. Bilinear sampling never fills missing contributing nodes. Calm cells do not acquire invented movement. The renderer uses eight historical trail intervals, with time-based alpha and staggered lifetimes. New particle seeding changes sampling density only, not wind direction or field values.

Reviewed upstream implementations on 24 October 2026:

- [QJvic/cesium-wind](https://github.com/QJvic/cesium-wind/blob/master/src/main.js): 2D canvas overlay around wind-core. Its source import `cesium/Cesium` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` against our installed Cesium 1.144.0 exports. It needs packaging changes and a depth/lifecycle adapter; the overlay does not share Cesium's depth buffer. Not installed.
- [Mapbox/webgl-wind](https://github.com/mapbox/webgl-wind/blob/master/src/index.js): useful GPU-advection/feedback technique, but a planar standalone WebGL renderer, not a Cesium primitive. Requires projection, context-state, Earth occlusion, camera-history and lifecycle integration. Not a drop-in dependency.
- [cambecc/earth](https://github.com/cambecc/earth/blob/master/public/libs/earth/1.0.0/earth.js): projected canvas advection, helpful for the finite-lifetime field-sampling approach; its older standalone D3/application architecture is not our Vite/Cesium renderer.
- [RaymanNg/3D-Wind-Field](https://github.com/RaymanNg/3D-Wind-Field/tree/master/Cesium-3D-Wind): closest 3D technique, but the demo uses global Cesium 1.125.0 scripts/NetCDF/dat.gui and several full-screen color/depth feedback buffers. Porting its context/framebuffer ownership would introduce more integration surface and memory than this bounded 1-degree surface-field task requires. Compatibility of an unmodified demo with 1.144 was not claimed.

Our Cesium 1.144.0 exports and shaders were tested in the actual Vite 8.1.5 application. Low-level Renderer exports remain version-sensitive: keep Cesium pinned and rerun native acceptance before an upgrade. No upstream source, shader, texture or proprietary Zoom Earth asset was copied or installed; no new third-party license payload is required. The linked MIT projects are acknowledged as technique references. Existing Cesium and other dependency licenses remain unchanged.

## Tuning

Edit `frontend/src/services/windConfig.js`, not the temperature renderer or UI tokens.

| Mode | Maximum allocated particles | Target updates/s | Instance buffer |
|---|---:|---:|---:|
| Performance | 1,800 | 24 | 0.518 MB |
| Balanced / Auto | 3,200 | 30 | 0.922 MB |
| Quality | 5,000 | 40 | 1.440 MB |

Plus a 48-byte shared quad and small shader/VAO resources. CPU histories and instance staging are also bounded; this is not a measurement of total GPU VRAM. Density decreases from 100% regionally to 25% at 20,000km and beyond; viewport widths below 600px use 55% of that count and at most 24 target updates/s. Resize can reuse the allocated desktop capacity. Eight trail intervals, 0.9s trail lifetime, 9s particle life, 0.12s ordinary birth reveal / 0.7s death fade, 1.15 CSS-pixel strokes, brightness 0.7 and night alpha addition 0.08 are centralized. No bloom.

Visual time runs at 12,000 modeled seconds per wall second for a wide view, smoothly reducing to 1,200 below 800km camera altitude, with interpolation up to 20,000km. This common camera-dependent multiplier preserves relative field speeds and directions; it is NOT the application simulation clock, forecast progression or tracked air parcels. The one-degree field is frozen at its disclosed valid time until the existing data owner supplies a new field. Interpolation does not create gusts, small eddies or high-resolution cyclone structure.

The 9km visual shell keeps traces clear of terrain; it is NOT the wind measurement level (10m). Regional/globe visualization is intended, not street-level terrain flow. Particle advection stops/respawns beyond 85 degrees latitude to avoid longitude singularities; the scalar field still covers the poles. For unsupported Google 3D, the existing explicit Esri choice remains mandatory.

### Zoom redistribution and warm start

An altitude ratio of at least 1.35 relative to the last distribution (35% farther or approximately26% closer) queues a new viewport distribution after180ms without a cumulative1% height change. A750ms cooldown and completion of the previous batch prevent repeated refreshes. Heights below100km are clamped for this trigger; pan-only movement and small zoom changes retain the existing lifetime-based respawning. These thresholds are centralized in `windConfig.js`.

Refreshes sample the current visible viewport and apply the existing distance/quality count, with at most192 particle reseeds per animation update (up to eight bounded screen-pick attempts per particle). Old particles continue moving until their replacements are ready; arrays, GPU buffers and the render listener are retained. Newly activated density slots use the same warm start. A full5000-particle redistribution takes27 updates (roughly0.7–1.4s at20–40 updates/s); whole-globe counts need fewer updates.

Each seed back-integrates eight RK2 samples over the existing0.9s trail using the same U/V field and current camera-dependent speed multiplier. Refreshed particles receive staggered mature ages and therefore show a complete moving trail immediately; normal lifetime respawns reveal over120ms rather than700ms. There is no temporary velocity boost or permanent speed change. Live forward advection, lifetime, trail length, density targets and stroke remain unchanged. History is truncated at missing/polar data rather than inventing flow. Reduced-motion remains static with no animation timer.

## Ownership and failure behavior

One primitive, one animation listener and one render-request timer while animated. No React state updates per frame, entities per particle, framebuffer accumulation, per-frame material allocation, camera mutation, picking IDs or new Viewer. Fixed Earth coordinates and scene depth testing keep trails attached during camera motion and hide far-side flow. Significant settled zoom changes redistribute in bounded batches; pan-only view areas populate as finite-lifetime particles respawn. There is no fabricated screen-coordinate flow.

Off, zero opacity, another variable, incompatible basemap, off-Earth travel, Time mode, hidden tab and logout release the particle primitive/timer. Opacity updates preserve buffers. The owner never changes shared render settings. Reduced motion uses still field-derived short streamlines, no animation listener/timer; camera move-end refreshes their view distribution. Media preference changes are handled live. Context loss releases wind resources; a restore event rebuilds only wind. Whole-Viewer WebGL recovery still depends on Cesium/browser and may require the existing page reload. Deterministic lifecycle tests do not certify recovery of an entire real lost GPU context.

Sustained update CPU cost above 12ms or frame intervals exceeding twice the budget interval reduce active particles by 25%, down to 35% of the mode, without growing buffers. Simulation dt is capped at 0.1s to avoid catch-up jumps. This safeguard is not a hardware benchmark guarantee.

## Verification

See `.orbitwatch-backups/wind-flow/` for genuine normal-app screenshots, eight-second WebM and sanitized runtime captures. The development-only `?windReview` controls provide reproducible camera positions, locate actual high/low U/V nodes, and record the existing Cesium canvas; they do not fetch data or create another Viewer and are eliminated from production builds. Follow/travel tests use the normal controls.

Scientific tests cover signed east/north/south/west movement, WGS84 latitude metric, both dateline directions, wrapped interpolation, calm/missing/polar nodes; lifecycle tests cover persistent buffers, opacity, reduced motion, visibility, field/basemap/off state, context-loss owner cleanup and idempotent destruction. Native performance results and final integration outcomes are recorded in the evidence README.

Hover wind inspection is deferred to a shared cross-weather picking/readout feature; existing intentional location inspection and satellite/event picking are preserved.

### Final native acceptance, 25 October 2026

Verified whole Earth, Indian Ocean, actual high/low wind cells, dateline, drag/zoom, all quality modes, ISS selection/Follow, field switching, off/on, Earth–Mars–Earth, Google/Esri, Time/Live and logout. One Viewer during Live; zero Viewers, weather legends and diagnostics after logout (the independent existing auth preview retains one canvas). Native console capture contained no warnings/errors or shader failures. Time Explorer's existing NASA provider/network fallback was exercised and remains explicitly disclosed; no historical-data availability is claimed.

Mobile testing found and fixed a desktop-to-mobile resize cadence issue: changing viewport width now re-arms only the render-request timer and preserves particle buffers. Native 390px testing measured 24 wind updates/s; regression checks desktop/mobile/desktop with exactly one timer. Final full frontend suite: 105 tests, including wind scientific/lifecycle checks. ESLint and production-build results are recorded in the continuation checkpoint.

Compared with the supplied ocean references, this implementation uses fine, short pale trails over the approved scalar wind map, without arrowheads or bloom. Curvature and relative speeds come from the actual cached field. It deliberately retains OrbitWatch's darker globe, Earth occlusion and existing interface, rather than copying the reference map or inventing finer cyclone structure.

### Changed-file manifest

- Added `frontend/src/services/windConfig.js`, `windAdvection.js`, `windPrimitive.js`, `windLayer.js`: centralized tuning, scientific advection, GPU draw and lifecycle.
- Added `frontend/src/services/windReview.js`: development-only reproducible camera/recording controls, excluded from production output.
- Updated `frontend/src/components/OrbitGlobe.jsx`: wind ownership, diagnostics and development review integration.
- Updated `frontend/src/components/WeatherPanel.jsx`: accurate animated-flow disclosure.
- Updated `frontend/src/services/temperatureLayer.js` and `weatherFields.js`: remove static arrows while retaining scalar imagery and shared interpolation.
- Added `frontend/tests/windLayer.test.js`; updated `frontend/tests/weatherFields.test.js` for the retired arrow presentation.
- Updated `docs/WEATHER.md`; added this document. Ignored checkpoint and native evidence live under `.orbitwatch-backups/`.

### Zoom refinement acceptance (25 October 2026, evening)

All108 frontend tests, ESLint and production build passed. New tests cover all profiles at22,000/3,000/300km and back: no refresh on small zoom, settle delay, bounded cold/refresh work, immediate nonzero history, unchanged first-step AND settled advection, persistent buffers and one timer. Existing lifecycle tests still pass.

Native normal-app checks used genuine GFS valid25October15:00UTC: far globe,3,000km Indian Ocean,510km ocean,472km high-wind/cyclone view, repeated zoom-in/out and Performance/Balanced/Quality. No retained old-view cluster after redistribution, no restart pause or console/shader errors observed; one Viewer and six tracks remain. Screen sequences and sanitized diagnostics are in `.orbitwatch-backups/wind-zoom/`. Native samples: Performance24 updates/s (~2.2ms CPU), Balanced20–25.5 (~3–3.21ms), Quality20–34 (~5.3–7.6ms in dense close views). These are observational wind-update metrics, not a controlled whole-app GPU benchmark. Owned buffers remain0.518/0.922/1.440MB.

Limitations: physically converging winds can still concentrate particles as they advect. Very close views retain the approved longer screen-space trail appearance; this pass does not alter speed/trail length to suppress it. Pending redistribution takes several frames and is not an instantaneous population replacement. Zoom uses altitude, not arbitrary field-of-view changes; below100km the refresh threshold is clamped. No new video was required for this targeted pass; sequential native frames and numerical speed regression checks supplement the existing animation recording.

### Adaptive recovery

Temporary overload no longer leaves density permanently reduced. Recovery requires eight seconds of continuous healthy updates (<=6ms CPU, frame interval <=1.75 times target), at least12seconds since a reduction, and grows scale by0.05 at most once per2seconds. New overload resets the healthy window and retains the existing30-update/25% reduction. Reconcile resets adaptive state on genuine restarts, quality changes and off/on. Inactive tails are invalidated and return through bounded warm-seeding, retaining GPU buffers during recovery. Deterministic regressions cover overload, short relief, sustained/full recovery, renewed degradation, quality/off-on resets and cleanup.
