> Historical investigation (13 October). The Guided geometry and gradient treatment below were superseded by [Orbit Trace](ORBIT_TRACE.md) on 14 October. Scientific frame/data/provider findings remain applicable.

# Orbit investigation — 13 October 2026

Baseline: `main` at `7bf88c7`. No production account/orbital-record/schema changes.

## Scientific findings and justified changes

[CelesTrak SGP4 tutorial](https://celestrak.org/software/tutorials/sgp4.php)
and [verification tutorial](https://celestrak.org/software/tutorials/sgp4-verification.php)
require compatible GP/SGP4 implementations and WGS72 propagation constants.
Verification against model output is different from agreement with observations.
[CelesTrak/Vallado frame FAQ](https://celestrak.org/publications/AIAA/2006-6753/faq.php)
specifies SGP4 Cartesian position/velocity in TEME. Skyfield's `satellite.at(t)`
is GCRS; [explicit frame conversion](https://rhodesmill.org/skyfield/api-satellites.html)
is required before labeling vectors TEME. We use public
`frame_xyz_and_velocity(TEME)` and `frame_xyz(itrs)`; raw Satrec comparisons confirm
the export. Mean TLE elements are not osculating/observed orbital elements.

[Skyfield coordinates](https://rhodesmill.org/skyfield/coordinates.html) distinguish
Earth-centered inertial paths from rotating ITRS coordinates. Each scene tick
applies one shared TEME→fixed transform to path and marker. Cesium's public
[TEME/pseudo-fixed conversion](https://cesium.com/learn/cesiumjs/ref-doc/Transforms.html)
approximates UT1 with UTC; shifting its evaluation by the server-provided DUT1
uses UT1. Polar motion is not loaded. Installed timescale/EOP predictions and
browser clock resolution limit certainty; numerical sub-millimeter agreement
in fixtures is **not** real-world positional accuracy. TLE age is shown; no
current elements are presented as historical observations in Time Explorer.

[NASA orbit categories](https://science.nasa.gov/earth/earth-observatory/catalog-of-earth-satellite-orbits/)
explain inclination, polar/Sun-synchronous, GEO and eccentric trajectories.
Perturbations and precession mean a propagated revolution need not close as
an ideal ellipse. Scientific retains every predicted vertex and its real endpoint
gap; it is not flattened into an Earth-fixed ground track. Ground-track overlays
were considered and deferred to keep this batch focused on the actual 3D path.
[NASA Eyes](https://science.nasa.gov/eyes/) is spatial-context inspiration, not a
source of propagation formulas or justification for distorted distances.

## Why the styles can look alike

Inspection and actual six-satellite browser diagnostics confirm different
resident geometry is selected: Guided481 circle vertices, Scientific480/960/2000
real samples. Scientific is never replaced by a fitted ellipse. Near-circular
paths legitimately overlap at ordinary viewing scales; eccentric Guided
intentionally falls back to the same real path. No eccentricity is invented.

Seven real-element recordings at the tested propagation instant:

| Satellite | Mean TLE eccentricity | Radius min–max (km) | Guided behavior |
| --- | ---: | ---: | --- |
| ISS | .000671 | 6795.5–6800.1 | circle |
| Hubble | .000187 | 6841.2–6850.3 | circle |
| Landsat8 (Sun-synchronous) | .000130 | 7072.3–7088.9 | circle |
| GPS BIIR5 | .011673 | 26255.7–26865.7 | circle; measurable radial difference |
| INSAT3DS (GEO) | .000125 | 42158.6–42169.2 | circle; Earth-fixed marker nearly stationary |
| Chandra | .765003 | 18909.6–142701.5 | real eccentric path |
| XMM-Newton | .464262 | 35764.3–98103.2 | real eccentric path |

These are recorded predictions, not current catalog guarantees. The radial
estimate `(rmax-rmin)/(rmax+rmin)` can differ from mean TLE eccentricity due to
perturbations. Existing .03/.025 hysteresis remains. Guided is schematic and
Earth-centered, using the actual radius and angular momentum plane. New precise
velocity supplies `r×v`, replacing the rounded path-chord plane where available;
legacy samples retain their central-chord fallback. No independent animation,
coordinate smoothing away from the prediction, or per-frame geometry upload.
A frozen mean-radius circle was rejected: it separates some GPS markers by
hundreds of kilometers. Received-velocity fitting retains slow physical change
and marker synchronization without sampling-noise/seam deformation.

## Accuracy and actual visual failure

The old backend rounded geographic angles/altitude before Cartesian recovery.
Additive responses now include TEME km/km/s, ITRS verification vectors, DUT1,
explicit frame/unit/time-system/schema, precise period, mean inclination/e,
TLE age and sampled altitude range. Existing fields/routes/auth are preserved.
Signed epoch offsets explicitly distinguish propagation before a future-dated
element epoch from propagation after it; an absolute offset is not called age.
Vectorized Skyfield evaluation also removes thousands of per-sample astrometry
calls. Velocity-aware cubic Hermite interpolates five-second short tracks;
legacy clients/samples remain supported. In seven real fixtures: raw SGP4 TEME
round-trip <.001m, displayed fixed frame versus ITRS <.001m, independent midpoint
interpolation <.001m. Full-orbit polylines still have finite chord error (~150m
LEO, up to kilometers at eccentric perigee); the line is not a navigation product.

Actual initial browser fixes had highlights enabled (current1), so global stale
suppression was **not** reproduced as the universal failure. The principal
visibility issue was context peak .19 versus quiet .075 after thin subpixel
coverage: very weak on real Earth/space backgrounds. We retain the same shader,
phase envelope, thin resident primitive and depth test, but increase local head
contrast (context .55/.08, selected .95/.15) with a restrained16% neutral lift.
Quiet-path crowd opacity stays bounded at .48; short moving heads at3.3. No
coincident overlay/glow tube or through-Earth depth override was added.

Two correctness defects were also fixed: a request-captured trajectory epoch
could override the actual returned orbit epoch; projection-distance error was
being treated as the age of a valid current fix. The returned epoch now owns
the path. A projection problem schedules bounded path refresh, while genuine
expired coverage or element mismatch suppresses current motion. Rounded period
loss is avoided using the new precise seconds field. Cached SGP4 computation
is independent of external GP retrieval budgets.

## Evidence and limits

- Native production-material/path/marker probe:7 real categories ×2 styles ×2
  selection states ×30 frames =840frames. Measured head/quiet >=5.51 and trail/
  quiet >=2.04; phases advance from received sample time and one shared matrix.
  One resident geometry revision per case. Controlled black background contains
  no imagery-provider content. Real marker and real sampled path are drawn.
- Actual application read-only bridge: six live precise paths, real selection/
  Focus/Follow, both styles and Earth occlusion inspected; advancing phases and
  automatic overlapping coverage/orbit refresh remain visible. Test identity is
  synthetic; orbital records/propagation are real. This does not sign off normal
  production authentication or a44-object network session.
- Concurrent1/6/12/24/44 native probe uses the existing recorded real legacy
  samples; it is additional GPU ownership/refresh coverage, not provider freshness.
- Final 900-frame load run passed with no empty frames, refresh gaps, unavailable
  positions or shader failures. An actual Earth-sized depth test occluded all
  twelve isolated far-side ISS path vertices: visible stroke pixels 21310 → 0.
- Final Time travel Earth → Mars → Jupiter, a committed historical date change
  at Jupiter, and Earth return retained the date, one Viewer and zero center/ring
  drift. NASA metadata failure/retry, fixed reference, same-day layer reuse and
  rapid date coalescing were checked separately.
- Evidence JSON/screenshots and continuation status are saved under ignored
  `.orbitwatch-backups`. Old development HMR artifacts are separated from clean
  final runtime observations; reload the fixture after source edits.

Weather ingestion and historical satellite archives remain future batches.
