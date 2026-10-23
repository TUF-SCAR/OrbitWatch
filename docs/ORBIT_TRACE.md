# Orbit Trace — 14 October 2026

Orbit Trace has one geometry source: the genuine SGP4-predicted inertial
trajectory. Selection never changes vertices, timestamps, orbital scale or
closure. The old Guided geometry and profile preference are removed; loading
an old preference removes only its obsolete `orbitStyle` key.

## Visual language

- Unselected paths are 0.8 pixel subdued threads with a muted category tint.
  Their complete shape stays visible; there is no repeating opacity gradient.
- Selected paths are continuous silver-white, 1.35–1.5 pixels wide. A narrow
  dark edge improves contrast against bright Earth imagery. Both edge and core
  are integrated in one fragment on one depth-tested surface, avoiding a
  coincident outline primitive or bloom pass.
- A 650 ms illumination spreads in both directions from the actual satellite
  phase once on selection. It conveys selection, not satellite speed. A refresh
  reprojects the original anchor without restarting the transition. Reduced
  motion skips the reveal. Deselection settles over 220 ms.
- Once settled, only a small local silver-to-white sheen follows the actual
  satellite phase. No timer moves orbital coordinates or a repeating chase.
- Count-dependent context contrast reduces clutter at 40+ objects. Camera
  fading uses orbit-radius / camera-distance, so a large eccentric path remains
  readable at its own scale. Smooth continuous thresholds avoid show/hide
  oscillation. A selected path persists farther than context threads.

`satelliteOrbitMaterial.js` owns coverage/color; `orbitVisuals.js` owns selection
state and real-phase anchors; `stableOrbitCollection.js` retains normalized
resident geometry, depth testing and synchronous refresh replacement. Precise
TEME/velocity/DUT1, Hermite tracks, source epochs, expired-position freeze,
protected endpoints, provider budgets and Viewer ownership are unchanged.
Neither endpoints nor sampled paths are forced closed. Numerical propagation
agreement is not a claim of observed tracking accuracy.

## Reproducible visual review

Run Vite and open `/tests/orbit-trace.html`. This development-only scene uses
the production geometry, transform and material with recorded real SGP4 data
and the existing NASA/JPL/USGS reference Earth texture. It makes no orbital
provider requests. Controls cover selection, orbital camera movement, zoom,
real-time playback, overlap refresh and disposal. Landsat 8 is the polar
PACE-like example; Chandra is the highly eccentric example. These are not
PACE/IBEX trajectories. The four NASA reference screenshots described in the
request were unavailable, so no direct image-comparison claim is made.

Before/after captures are in `.orbitwatch-backups/orbit-trace/`:
`{before,after}-polar-{selected,unselected}.jpg`,
`{before,after}-eccentric-{selected,unselected}.jpg`, and
`{before,after}-dense.jpg`. They show actual WebGL output, not mockups.

`orbitTrace.test.js` checks all 44 recorded paths, exact vertex identity/open
endpoints, selection anchors, refresh continuity, reduced motion and disposal.
The native `/tests/orbit-render.html` load probe renders 1/6/12/24/44 paths over
450 frames. The contrast/motion probe draws seven real categories in both
selection states over 420 frames; Earth occlusion is tested separately.
These controlled scenes complement full-app Focus/Follow/failure checks; they
do not certify a 44-object authenticated production network session.

## Final evidence

86 frontend tests, lint, production build and 39 isolated backend contract
requests pass. The native load probe reports zero empty, refresh-gap or missing
position frames; every path has exactly two geometry revisions after the one
deliberate refresh. All 14 category/selection cases advance real phase. The
selected quiet section is 9.07–9.24 times the rendered brightness of its
unselected counterpart, so selection emphasizes the complete orbit rather than
only the satellite vicinity. Far-side Earth depth reduces the measured stroke
and marker contribution from 24,402 to zero.

The full application was also checked against the existing read-only backend
bridge: six real tracks, Focus/Follow/Release, camera drag, zoom, offline request
retention/recovery and Earth–Mars–Earth restoration with one Viewer. The final
fresh app console has no warnings/errors. A separate restored test tab logged
Vite websocket errors while its development server was stopped; these are not
shader failures. Existing build bundle-size/plugin-time warnings remain.

Automatic short-track renewal extended all six live tracks to about 284 seconds
of coverage while all paths stayed active and geometry uploads remained at one.
Before/after diagnostics are saved as `app-before-auto-refresh.json` and
`app-auto-refresh.json`. Actual orbital refresh replacement is separately
exercised by the native load probe and exact-vertex unit regressions.

See `.orbitwatch-backups/orbit-trace/README.md` for exact before/after and extra
far-distance/GEO/GPS/application capture links. Browser captures are native
JPEGs; the `.jpg` copies preserve their bytes. Older `.png`-named evidence is
retained. Viewport sizes differ, so these are visual comparisons, not pixel
diffs. The known propagation approximations and finite sampling error remain;
no observed-position accuracy claim or NASA-image match is made.

Logout verification released the live scene, all scene models, tiles and orbital
owners; the remaining canvas belongs to the existing authentication preview.
Test services/tabs were stopped after verification. No production account,
database record or schema changes were made.
