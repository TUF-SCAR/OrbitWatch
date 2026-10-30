# Live Earth clouds and precipitation — 27 October 2026

Live Earth starts on Esri with Clouds selected and enabled, including when a
Google token is configured. Other maps remain selectable. Weather uses the same
preview-card interaction as Map Settings, with Clouds, Precipitation, Temperature
and Wind. The thumbnails are local illustrative previews; current sources,
timestamps and availability remain in the controls below the cards.

All four weather graphics fade smoothly from full user opacity at 250 km to zero
at 200 km camera altitude, remaining hidden below it. Zooming out restores the
selected layer. This native render-cycle factor is separate from selection,
enabled state and user opacity; it does not reset or rebuild particle buffers.
Fully hidden wind/rain updates skip simulation work, and regional cloud requests
pause. Natural Events are outside this fade and remain unchanged. Google 3D,
Time Explorer and celestial travel retain their existing weather compatibility
rules; returning to a compatible Live Earth restores the user's selection.

The weather selector has one **Clouds** entry. It uses the existing real EUMETView
multimission infrared composites. If no usable observation exists and the source
fails, that entry explicitly reports a GFS modeled-cloud fallback with the GFS
forecast timestamp. Observed and modeled data are never silently blended or
assigned each other's dates. A cached observation takes precedence over fallback.
Retrying observations uses the existing cooldown and request gate.

## Cloud rendering

The brightness transfer now preserves source variation up to 255 rather than
flattening bright values above 235. Neutral RGB varies from 210 to 255 with the
source; alpha is `clamp((brightness-85)/170,0,1)^1.05 * sourceAlpha`. This remains
an infrared visual emphasis, not a calibrated cloud mask. No procedural noise,
invented fine cloud structure or sharpening is added.

Balanced and Quality obtain an additional geographic WMS crop after the camera
settles for 650 ms. Bounds are padded and quantized to reuse nearby views; no more
than one refinement attempt starts per ten seconds. It uses the exact displayed
global composite slot, with EPSG:4326 and longitude/latitude axis order. The same
native imagery owner crossfades to the region; it does not stack a brighter
regional cloud layer over the global cloud layer.

Camera movement retains regional coverage while it still covers the viewport;
leaving that coverage restores the global frame. Small camera events reuse
pending and cached crops rather than repeatedly cancelling them. Playback, broad globe views, polar
views and antimeridian-crossing views use global frames. Regional failures retain
global coverage. Late requests cannot resurrect a layer after leaving Earth.
The shared 24-attempt/15-minute provider gate and Retry-After still apply. Regional
sampling has two cache entries independent of the short global playback cache.

| Preset | Global clouds / frames | Regional clouds | Precipitation image | Streak budget / update limit |
| --- | --- | --- | --- | --- |
| Performance |1024×512 / 2|Global only|720×360|160 / 20 Hz|
| Balanced / Auto |2048×1024 / 3|1024 wide|1080×540|320 / 24 Hz|
| Quality |4096×2048 / 4|2048 wide|1440×720|560 / 30 Hz|

Regional height follows the bounding-box aspect ratio, capped at 2048. This is
closer sampling of the provider's real image, not a claim that the source contains
arbitrary resolution. Pixel detail still depends on the source, viewing geometry
and location. No new provider or credentials are introduced.

## Precipitation

The GFS instantaneous liquid-equivalent rate uses light blue → blue → violet →
magenta → coral → yellow, anchored at 0.1, 1, 5, 12, 25 and 50 mm/h. Color follows
logarithmic interpolation between these anchors. Dry/missing cells stay clear;
weak rates fade in smoothly instead of producing a hard low-rate outline.
The legend uses the same stops.

Cesium billboards add soft screen-down streaks only where samples of the real
model exceed 0.15 mm/h. They are symbolic precipitation activity, **not physical
drop trajectories, velocity, wind direction, radar, or rain/snow classification**.
The field includes frozen precipitation. No extra weather data is inferred from
the particle density, phase or speed.

Streaks are subdued at wide globe scale and visible at regional/local scales.
Anchors are redistributed on camera completion in batches of at most 40 per
update. There is no per-frame weather fetch or per-frame picking for settled
particles. Under 600 CSS pixels the count is reduced to 55%. Reduced motion holds
still streaks; hidden pages remove the collection. Layer disable, Google 3D,
non-Earth contexts and logout release collections and listeners.

All display grids sample the same original **1° GFS field**. Larger textures
reduce display sampling artifacts but cannot create narrow rain bands, resolve
individual cells or match the scientific detail of the references' 13–22 km
models. Broad smooth areas at close zoom are an honest source limitation.

## Scope and verification

No wind advection/style, temperature palette, orbital renderer, satellite data,
authentication, backend or database changes. The shared weather imagery owner
accepts a quality argument for precipitation only. The existing DEV review bar
has Bay of Bengal/North Atlantic presets and keeps its review view stationary;
normal application AFK behavior is unchanged.

`weatherVisuals.test.js` covers wet/dry masks, quality budgets, bounded seeding,
hidden/reduced-motion/off cleanup, regional bounds/cache/source time, and late
travel completions. Existing cloud tests cover provider gates and error handling.
See `.orbitwatch-backups/weather-refinement/` and the continuation checkpoint for
native screenshots and final validation results. No new dependencies were added.
