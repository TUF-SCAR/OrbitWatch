# Earth satellite orbit rendering

The backend remains unchanged. Skyfield/SGP4 supplies timestamped WGS84 latitude,
longitude and altitude for each trajectory and complete orbit. No frontend
circle/ellipse replaces those samples.

Each sample is converted to Cartesian Earth-fixed coordinates, then rotated by
the transpose of Cesium's `computeTemeToPseudoFixedMatrix` **at that sample's
timestamp**. The satellite and path both apply one shared forward rotation at
the effective scene timestamp. The origin remains Earth's centre. GEO therefore
has a complete inertial orbit even though its Earth-relative satellite position
is almost stationary. Cesium's pseudo-fixed conversion equates UTC and UT1;
this is a documented visualization approximation, not an EOP-calibrated TEME
state vector or a replacement propagator. It avoids asynchronous ICRF fallback
changes and duplicate Earth rotation.

Trajectory positions interpolate the recovered samples. Overlapping refreshes
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

One normalized, resident PolylineGeometry draws both the quiet complete shape
and brighter active region in one pass. Vertex texture s represents uniform
backend sample time. The phase follows the same current satellite position,
using time to predict the segment and projection to refine it. A short brighter
lead and long soft tail use a periodic continuous envelope, with a nonzero base
everywhere. Core coverage uses analytic pixel overlap to retain the prior
anti-flicker fix. No independent animation timer, overlapping coincident strokes,
per-frame geometry, extra Viewer or React phase state is used. Category colors
remain intact; selection and orbit count control the hierarchy. High-apogee
paths fade according to their own scale rather than a LEO-only camera threshold.

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
period, phase wrap/lead/trail, overlap/expiry, distinct 1/6/12/24/44 paths, global
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
and recovery, long Live running, Earth travel and logout. Native visual validation
is partially verified; see the Astra checkpoint for the remaining scenarios.
The resumed native browser reproduced a shader compile failure because `active`
is a reserved GLSL word; the local variable is now `phaseWeight`. The existing
`tests/orbit-render.html` probe's **Run satellite shader regression** compiles
the actual material on WebGL2 and checks six recorded real SGP4 paths over 540
frames with phase wrap, camera/zoom changes and resident buffer replacement.
All six cases passed without an empty frame. Node Material construction does
not compile GLSL and must not be treated as evidence of GPU compatibility.

The **Run 24/44 real satellite load regression** button uses 44 distinct real
catalog objects from `tests/fixtures/satellite-load-sgp4.json`. Each concurrent
case advances 180 rendered frames with camera/range changes, actual Earth-frame
rotation, a recorded overlapping trajectory merge and resident buffer replacement.
It asserts no empty frames, valid position coverage, phase alignment, two geometry
revisions per path and collection disposal. Start inside the shared orbit/track
coverage interval; a timestamp before an orbit's recording start wraps into the
next period and can include a real SGP4 precession offset.

To regenerate that recording against the read-only bridge:

    python frontend/tests/satellite-api-check.py --record-load-fixture

On 2026-10-10 both concurrent cases passed; maximum phase-to-path distances were
462m/438m. The app's six live paths survived automatic trajectory/orbit refresh,
Focus/Follow, Earth↔Mars and logout. Browser-to-8001 fetches were intermittently
unavailable at higher loads although standalone API checks passed; the recorded
GPU probe does **not** establish a normal authenticated Live 44-object network
session. No production transport/auth changes were made to bypass that limitation.
