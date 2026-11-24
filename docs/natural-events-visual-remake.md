# Natural Events visual remake

Batch B starts from `bba8a70006d3364ebf47f5e1ac6aa14802042374` on `main`, including Batch A. The review covered event projection and picking, the report panel and feed hook, event categories, and the backend normalization and cyclone-track validation.

## Duplicate cyclone markers

The old map emitted a marker for each provider report ID. Provider normalization already removed repeated revisions of the same ID. NOAA forecast attachment already matched exact ATCF IDs on the backend. The missing link was between independent positional reports on the client.

A read-only replay of the November 7 local cache confirmed two duplicate pairs:

| EONET report | Official JTWC product code in its references | IBTrACS storm and ATCF ID |
| --- | --- | --- |
| `EONET_25728` · In-fa | `wp3026.tcw` | `2026297N11166` · `WP302026` |
| `EONET_25964` · Murasu | `io0426.tcw` | `2026305N12087` · `IO042026` |

The graphic groups exact agency identifiers and verified official event-report references. It rejects ambiguous links and keeps similarly named or nearby storms separate. The GDACS MURASU record in the cache had no verified link, so it remains separate. The grouping is used for display and leaves report IDs, provider records, source URLs and notification input intact. The compact replay retained 839 reports and produced 837 map entries before screen-space clustering. [NOAA IBTrACS column documentation](https://www.ncei.noaa.gov/sites/g/files/anmtlf171/files/2025-09/IBTrACS_v04r01_column_documentation.pdf)

For linked storms, the marker uses the latest dated eligible position. It prefers a verified source observation over a GDACS report centroid. A trajectory comes from one validated source at a time. The client never stitches unrelated positional feeds into a new track. A forecast-only advisory has no observed marker.

## Design and rendering

- Thirteen original SVG symbols share a dimensional badge style. They use distinct silhouettes, category colors and a dark edge that remains readable over light or dark imagery. Markers, report rows and the compact summary use the same cached artwork.
- A transparent device-resolution canvas sits over the existing Viewer. It uses Cesium projection and ellipsoid occlusion, a 160-marker paint budget, and a 5.5-million-pixel backing limit. It avoids rebuilding sprites on scene quality changes. Label placement tests marker and text bounds, prioritizes selection and important events, and opens up at closer scales. A selected symbol can animate without sending any requests, and reduced motion uses a static highlight.
- Clustering follows projected proximity and counts distinct map entries. Selected events remain separate from clusters. Selecting a cluster opens a summary with a route to its report list. Selecting an individual event offers Details and Focus. Focus uses the existing camera and can restore the prior view.
- Solid lavender paths connect dated source positions. Amber dashes identify official forecast paths while their issue and validity times pass validation. Browser captures initially showed dated dots and labels without readable Cesium line strokes. The selected paths now share the event canvas. The renderer projects the supplied geodesic segments, splits occluded spans and retains dated Cesium points and endpoint labels. Tessellation adds line vertices for drawing only. Tracks preserve antimeridian crossings and source gaps. Source boundaries preserve component and hole rings. An ordinary point report has no inferred boundary.
- The compact summary is nonmodal and sits clear of phone navigation. Full report details open on demand. The report list also supports keyboard and screen-reader selection. Actions have visible focus and the summary buttons provide 44 px targets. [Material 3 adaptive layout guidance](https://developer.android.com/codelabs/adaptive-material-guidance) · [WCAG 2.2](https://www.w3.org/TR/WCAG22/)

## Verification

Browser checks run the built project in Chrome with SwiftShader and isolated auth. The 839-report fixture was exported read-only from the local caches and marked stale. Uncommon family and forecast checks use separately labeled synthetic data. All provider requests are blocked during visual QA. Evidence is in the local ignored directory `.setup-cache/natural-event-evidence`.

| Viewport | Preset | Event backing width | Globe backing width | Visible badges / clusters |
| --- | --- | ---: | ---: | ---: |
| 360×800 | Performance | 720 | 234 | 21 / 16 |
| 390×844 | Balanced | 780 | 319 | 22 / 17 |
| 844×390 | Quality | 1688 | 844 | 22 / 17 |
| 1280×900 | Balanced | 1280 | 1049 | 35 / 26 |
| 1920×1080 | Quality | 1920 | 1920 | 49 / 35 |

The five cached views exercised selecting and dismissing an event, and each fetched the feed once. Phone cases used touch and 2× DPR. The 1280×900 session opened Murasu’s linked reports, focused its real NOAA observed trajectory and returned to the previous view. See `cache-*.png`, `selection-*.png`, `verified-source-identity-1280.png` and `noaa-observed-cyclone-1280.png`.

The fixture series captured all 13 supported categories in `fixture-*.png`, including the boundary-only flood and a cyclone with both path styles. `cyclone-detail-before.png` and `cyclone-detail-after.png` show the line rendering change. A fixture with a missing retry hint exposed an existing tight polling loop caused by a `NaN` timeout. The feed hook now ignores invalid hints and uses the existing upper delay bound when none are usable. The final fixture session made one feed request across the 13 captures.

Changing all three presets in the same 390×844 session held the event canvas at 780 px while the globe changed from 253 to 319 to 390 px. Switching to Time Explorer hid the layer and returning to Live restored it. See `quality-switch-*.png` and `report-quality.json`.

Frontend checks ran from `frontend`. `node ..\.orbitwatch-tools\npm\bin\npm-cli.js run lint` and `node ..\.orbitwatch-tools\npm\bin\npm-cli.js run build` passed. The build retained Vite’s large-chunk warning. `node --test --test-concurrency=1 tests/accountSettingsUi.test.js tests/naturalEventVisuals.test.js tests/cycloneTracks.test.js tests/weatherFields.test.js` passed all 19 checks, including the account-settings case that failed during the concurrent full run. Two older Natural Events cases in `weatherFields.test.js` now exercise the native fallback using Cesium entities and cluster IDs. Tests for motion and projected track styling exercise the new canvas.

The broader `node --test --test-concurrency=3 tests/*.test.js` run returned 232 of 233 passing. Vite’s SSR transport timed out at 60 seconds while loading the unchanged `NotificationDelivery.jsx` in `accountSettingsUi.test.js`. The case passed in the scoped serial rerun above.

The backend commands from the root were `& .\backend\.venv\Scripts\python.exe -u tests/check_event_expansion.py` (12 passed) and `& .\backend\.venv\Scripts\python.exe -u tests/check_natural_events.py` (passed). The latter needed Windows loopback access for the isolated FastAPI test client. Both used local test data.

## Changed files

- Event rendering and data: `naturalEventArt.js`, `naturalEventIdentity.js`, `naturalEventOverlay.js`, `naturalEventLayer.js`, `useNaturalEvents.js`.
- Event presentation and wiring: `NaturalEventSummary.jsx`, `NaturalEventsPanel.jsx`, `NaturalEvents.css`, `WeatherPanel.jsx`, `WeatherPanel.css`, `OrbitGlobe.jsx`, `App.jsx`.
- Regression coverage: `naturalEventVisuals.test.js`, `weatherFields.test.js`.

## Limits

An unlinked provider report keeps its own marker when sufficient map space is available. Close or overlapping reports can appear as a cluster. The overlay uses the globe ellipsoid for horizon culling, so steep terrain and photogrammetric building occlusion are approximate. Source boundary geometry and dated track-point labels still use the scene renderer. Physical Android timing and GPU cost remain unverified. Provider caches, production services and backend contracts were untouched.
