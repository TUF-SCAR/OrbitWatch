# Earth satellite orbit rendering

As of 14 October 2026, additive backend responses export precise TEME position
(km), velocity (km/s), DUT1 and ITRS verification samples through vectorized
Skyfield/SGP4. Existing geographic fields/endpoints/auth remain compatible.
Orbit Trace uses only the real predicted samples. See [visual design](ORBIT_TRACE.md),
[investigation/sources](ORBIT_INVESTIGATION.md)
and [provider safeguards](API_USAGE.md) for measured evidence and limits.

Skyfield `at(t)` is GCRS, so the server explicitly converts through the public
TEME frame API before labeling its vectors. The consumer applies one shared
TEME-to-fixed rotation at effective scene time, evaluating Cesium GMST at UT1
using received DUT1. Polar motion is not loaded. Legacy geographic responses
still recover a TEME-like visualization frame per sample timestamp (UTC≈UT1).
Both pipelines preserve physical radii and the unchanged scientific marker.
No independently animated coordinate or asynchronous ICRF fallback is introduced.
Numerical agreement with a propagator is not an observed tracking accuracy claim.

Precise short tracks use velocity-aware cubic Hermite interpolation; legacy
tracks retain linear interpolation. Overlapping refreshes
keep the same position Property and bounded history (361 samples). A request is
due with less than 90 seconds of coverage remaining; lifecycle checks run every
15 seconds in Earth Live Mode. Batches contain at most 24 IDs, failed attempts
are spaced at least 30 seconds, and old valid samples survive failures. Outside
coverage, marker/path frame freeze at the last valid timestamp, the highlight
stops, and both the scene notice and marker label say the position is stale.
This does not extrapolate an expired fix as live telemetry.

Full orbits refresh separately, after 1/12 period bounded to 60–300 seconds,
or after a TLE epoch changes. A Viewer-owned queue permits four requests globally,
deduplicates IDs, and cancels only hidden/unloaded objects or destroyed Viewers.
Sampling is 480 points for short periods, 960 above three hours and 2000 above
18 hours, using the existing endpoint's supported bounds. True sample geometry
changes only on successful orbital refresh. Synchronous resident replacement
keeps one renderer/material per orbit; minor refresh changes are never combined
with fake coordinate interpolation or a blank remove/re-add frame.

One normalized resident PolylineGeometry draws a complete thread and its narrow
contrast edge in one depth-tested pass. Pixel-integrated analytic coverage
retains stable subpixel brightness. Unselected category-tinted threads give way
to a continuous silver-white selected path. Selection illuminates outward once
from the real phase, then settles; only a subtle real-phase sheen continues.
No independent orbital animation, duplicate strokes or per-frame geometry is
used. Relative angular-size fading keeps high-apogee paths readable at their
own scale. See [Orbit Trace](ORBIT_TRACE.md) for widths, timing and screenshots.

## Cesium 1.144 alternatives reviewed

- PathGraphics leadTime/trailTime and relativeTo INERTIAL can show partial paths,
  but require full-period position coverage beyond the short live trajectory.
- PathMode.PORTIONS splits/samples time-dependent materials into many temporal
  polylines via PathVisualizer's PolylineCollection. It adds dynamic geometry
  work rather than a uniform phase update.
- PolylineCollection rebuilds GPU buffers when its model matrix changes.
- Per-vertex colors are useful for static gradients, but moving them requires
  color uploads. PolylineGlowMaterialProperty has no satellite phase envelope.

The small deterministic material reuses the existing resident renderer and
depth/picking/cleanup policy; celestial rendering is otherwise unchanged.

## Validation and continuation

`frontend/tests/fixtures/satellite-sgp4.json` records the unchanged backend's
real ISS, Hubble, Landsat 8, GPS, INSAT-3DS and eccentric Chandra calculations.
Regressions cover exact frame round trips, short-trajectory alignment, a full
period, phase wrap/selection reveal, overlap/expiry, distinct 1/6/12/24/44 paths, global
143-request caps and cancellation/resource ownership. They do not establish
native GPU appearance or replace browser testing.

For native real-data validation, start only the read-only loopback test bridge
with the existing Python environment. It imports the backend propagators but
does not run its lifespan/ingestion worker. Starting the normal backend can
write orbital records; it is unnecessary for this fixture.

    python -m uvicorn satellite-backend:app --app-dir frontend/tests --host 127.0.0.1 --port 8001

Start Vite on isolated port 5174 and open
`http://127.0.0.1:5174/tests/ui.html?satellites=backend`. Login uses the existing
UI fixture identity; satellite endpoints use the **real database/SGP4 functions**,
not the old synthetic sample generator. Production auth remains untouched. The
rendered diagnostic output exposes phase, path distance, sample coverage, stale
state, upload count and resource ownership. Test 1/6/12/24/40+ simultaneous paths,
selection/Focus/Follow/Release, repeated zoom/drag, overlapping refresh, failure
and recovery, long Live running, Earth travel and logout. See the Astra checkpoint for the latest native visual validation results.
An earlier native browser run reproduced a shader compile failure because `active`
is a reserved GLSL word. Orbit Trace avoids reserved identifiers. The existing
`tests/orbit-render.html` probe's **Run satellite shader regression** compiles
the actual material on WebGL 2 and checks six recorded real SGP4 paths over 540
frames with phase wrap, camera/zoom changes and resident buffer replacement.
All six cases passed without an empty frame. Node Material construction does
not compile GLSL and must not be treated as evidence of GPU compatibility.

The **Run 24/44 real satellite load regression** tests 1/6/12/24/44
simultaneous satellites using 44 distinct real catalog objects from
`tests/fixtures/satellite-load-sgp4.json`. Five cases advance 90 frames each
(450 total) through camera/range changes, actual Earth rotation, overlapping
trajectory merge and resident buffer replacement. Assertions cover no empty
frames, valid positions, phase alignment, two geometry revisions after refresh
and collection disposal. Start inside shared orbit/track coverage: pre-start
phase wrapping can otherwise include a real SGP4 precession offset.

The native contrast/motion probe draws seven precise real tracks and markers
in both selection states (420 frames), measuring complete-path readability and
real phase advancement. The Earth-depth probe verifies far-side occlusion.
`/tests/orbit-trace.html` provides the visual review gallery with reference
Earth imagery, polar/eccentric/GEO/navigation/dense cases and motion/refresh
controls. The actual application uses the read-only bridge with synthetic
identity only. These tests do not certify a normal authenticated 44-object
production network session. Results and before/after images are recorded in
`.orbitwatch-backups/orbit-trace/` and the continuation checkpoint.
