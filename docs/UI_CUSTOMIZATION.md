# UI configuration and assembly — verified 23 October 2026

Edit `frontend/src/styles/ui-tokens.css`. It is the single source for reusable
UI type, colors, spacing, control dimensions and motion timing. For example:

```css
:root {
  --ui-font-scale: 1.20; /* Default 1.08; changes HUD, panels, forms and controls. */
  --ui-accent: #86e8ff;
  --ui-panel-padding: 18px;
  --ui-button-height: 38px;
  --ui-motion-reveal-interval: 175;
  --ui-motion-morph: 520;
}
```

Motion timing numbers are milliseconds **without a unit**; CSS multiplies them
by `1ms`, and `uiConfig.js` converts them for Motion. Camera/preview speed values
are radians per second. Restart/reload after editing configuration. No orbital
mathematics, provider limits, URLs or credentials are configured here.

The named typography tiers and legacy `--ui-type-*` hierarchy variants all use
the same multiplier. Pixel typography declarations in the active stylesheets
were changed at their definitions, including responsive overrides and font
shorthands. A measured scale change from 1.08 to 1.25 increases a HUD title from
17.28 to 20 px, panel heading from 23.76 to 27.5 px, settings text/buttons from
12.96 to 15 px, and dock values from 17.28 to 20 px. Panel widths do not scale
with type; controls wrap and panel bodies scroll. Tiny labels initially gain
roughly 1–3 pixels while retaining their hierarchy.

## Live dock

The dock is sized by its contents: two aligned telemetry groups, narrow
separators and one orbit command with a count. The persistent rendering subtitle
is removed; scientific trajectory details remain in the Inspector. Desktop
measurements are approximately 484 × 58 px with the default six tracked objects.
On 390 px viewports, two telemetry columns and a full-width command occupy about
300 × 107 px. Unavailable/long data, disabled/selected command states, travel
status, celestial facts and required map attribution are retained.

## HUD assembly

`HudAssembly` owns one coordinator per App session. Children, backend fetching
and the single Cesium Viewer initialize concurrently. `CinematicStage` registers
its actual child geometry; the header measures its real instrument groups
instead of its viewport wrapper. All loaders start in one animation frame.
The coordinator sorts measured footprint area, then reveals smallest first.

The circular frame is the same persistent DOM container around the mounted UI.
Motion animates its position, width, height and corners into the target bounds;
the spinner settles and content appears near the end. Component identity is
preserved. There are no per-stage startup timers or Viewer remounts. Default
timing is roughly 2 seconds for eight instruments. Stage `inert`, `aria-hidden`
and pointer gating prevent hidden controls from accepting input; keyboard
shortcuts also wait for assembly completion. Completed stages do not replay on
selection, camera movement, ordinary panels or mode changes.

ResizeObservers update ready bounds and safely settle interrupted morphs.
Animation handles, the coordinator clock, observers and preference listeners
are cancelled on unmount. Reduced motion completes immediately, including a
preference change during assembly. Logout/relogin creates a fresh session.

On very short map viewports, the existing named destination buttons use a
compact schematic grid to prevent label collisions; larger Orbit Maps keep
their original circular layout. Catalog/travel/catalog membership and scientific
3D positions are unchanged. Catalog remains the scrolling map-family tab.

## Auth preview and idle camera

The decorative Three.js preview chooses bounded azimuth, elevation, distance
and orbital phases once per scene mount. Login/Register switching preserves
that session and manual OrbitControls input. Time-based slow revolution follows
the existing decorative radii, with self-rotation, rings, stars and belt retained.
Launch freezes the current decorative positions and approaches the updated
Earth center. It remains separate from the scientific Live Solar System.

Reduced motion keeps the preview static except for requested input/loading.
Visibility changes cancel/resume its animation frame with bounded elapsed time.
Unmount removes controls/listeners/observers, cancels the frame and disposes
textures, materials, geometry and the renderer. Live idle Earth rotation changes
only its speed, from `.0012` to `.00204` rad/s (1.7×); timeout, framing, input,
Follow/Focus, mode and reduced-motion restrictions remain in place.

## Verification

Evidence lives in `.orbitwatch-backups/ui-refinement/`: five `live-WIDTHxHEIGHT.jpg`
captures, font-scale/viewport/assembly JSON, auth/register/preview and shared-frame
morph captures, idle-rate/cancellation checks, and final test/build logs.
Morph captures use the fixture's explicitly slowed **review timing** so transient
geometry is inspectable; `normal-assembly.json` records the approximately 2-second
production timing. Test controls can be hidden/restored with Alt+Shift+T.

The browser fixture uses synthetic auth/data with the actual App/Cesium/Three
renderers; production accounts/database records are never touched. The fixture's
reduced-motion override exercises JavaScript media-query listeners; CSS queries
continue to follow the operating-system preference. The requested Live reference
screenshot was unavailable in the attachment folder, so the current running UI
served as the baseline. Existing NASA provider/network availability limitations
remain visible in Time mode; that integration was not changed in this batch.

### Final continuation checks — 23 October

The interrupted batch is complete. The existing desktop/responsive, font-scale,
normal/slow assembly, reduced-motion and auth-session evidence was inspected;
successful checks were retained rather than repeated. A fresh actual-renderer
session confirmed all eight ready stages release `inert`/`aria-hidden`, the
390 × 844 Live layout is settled and compact, and pointer input stops idle
rotation with normal motion still enabled. Two post-input camera samples nine
seconds apart are identical. The earlier measured idle rate was .00203777 rad/s
against the configured .00204 (1.7 × .0012).

Fresh logout reports zero Cesium scenes, models, tile memory and HUD stages;
the sole remaining canvas belongs to the expected auth preview. Fresh browser
warnings/errors are empty. The four approved Orbit Trace renderer/state hashes
match the pre-UI snapshot. No further UI source fixes were needed during this
continuation; backend, API, database and orbit sources were preserved.

`oct23-tests.log` records 89/89 frontend tests; `oct23-affected-tests.log` records
3/3 assembly/preview tests. ESLint, production build and `git diff --check` pass.
The existing large-chunk/plugin-timing build advisories remain. Browser auth is
the isolated fixture, not a new production-account validation; the reduced-motion
CSS/OS qualification above still applies. See the evidence `README.md` for
individual captures and measurements. No known unresolved UI defect was found.

### UI batch file inventory

- Configuration/type: `src/styles/ui-tokens.css`, `src/styles.css`, `src/live.css`,
  `src/utils/uiConfig.js`, `src/utils/motionTokens.js`.
- Assembly/input: `src/App.jsx`, `src/components/HudAssembly.jsx`,
  `src/components/CinematicStage.jsx`/`.css`, `src/components/TopHud.jsx`,
  `src/services/hudAssembly.js`, `src/utils/hudAssemblyContext.js`.
- Dock/map: `src/components/LiveDock.jsx`, `src/components/SystemMenu.jsx`/`.css`.
- Decorative preview/idle: `src/components/SolarSystemScene.jsx`,
  `src/utils/previewMotion.js`, the idle-speed lines in `src/components/OrbitGlobe.jsx`.
- Supporting typography: `src/pages/AuthPage.css`, `src/auth/AuthRoot.css`,
  `src/components/BootSequence.css`, `src/components/SatelliteModelViewer.css`.
- Verification: `tests/hudAssembly.test.js`, `tests/ui.jsx`, `tests/sceneMetrics.js`.

Paths above are relative to `frontend/`. This final continuation updated this
document, the ignored checkpoint and verification artifacts only. Other pending
orbit/provider/Time/backend changes predate this UI batch and were preserved.
