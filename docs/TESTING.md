# Local verification

Preserve the working tree; no git reset/checkout/commit is needed for these checks.

## Frontend

From the repository root:

```powershell
npm run lint --prefix frontend
npm test --prefix frontend
npm run build --prefix frontend
python frontend/scripts/check_assets.py
```

The asset check requires Pillow. The build has a known large-main-chunk warning.

The fixture's JavaScript motion preference selector exercises runtime preference listeners and camera durations without changing OS settings. CSS media queries still follow the OS preference. Resource diagnostics count active Cesium scenes, canvases, root model primitives and tile bytes; browser heap and render duration are approximate, not total GPU memory or a frame-rate benchmark. Diagnostics are excluded from the production build.

`preview clears` counts WebGL clear calls from the auth and inspector previews during each 1.5-second diagnostic interval. A settled reduced-motion preview should report zero; loading, resizing and camera input should cause redraws. Full-motion preview rotation should continue producing clears. This is a redraw check, not a GPU timing measurement, and background-tab throttling affects counts. Fixture disposal restores all patched prototypes.

`frontend/tests/ui.html` is a development-only synthetic UI fixture. Serve the frontend on `127.0.0.1:5174` and open `/tests/ui.html`. Use `ui-test` / `orbitwatch-test`. The bottom strip can force feed, model, camera, Bing metadata and Google authorization failures. Its fake session is isolated from port 5173 and it is not part of the production entry/build.

The spacecraft-model selector supports `online`, HTTP-failing `offline`, and abortable `stalled` requests. With the optional 3D preview enabled, open Hubble after selecting a failure mode: it should fall back to the credited photograph and remove its extra canvas, within ten seconds for a stalled load. Closing the inspector during a stall must also release the canvas without a delayed error. Switch back to `online` and reopen to verify recovery. The disposal regression separately checks shared textures, geometry, materials and decoded image ownership.

`Lose spacecraft context` uses the browser's `WEBGL_lose_context` extension on the optional preview only. After it loads, activate this control: the photo tab and retry action should replace the preview, the extra canvas should disappear, and the Earth scene should remain usable. Retrying should create and load a fresh preview. This tests context-loss handling, not actual GPU memory exhaustion.

The place-search fixture selector leaves real geocoding as `provider` by default; `fixture` returns a clearly labeled Hyderabad rectangle and synthetic attribution, `offline` rejects, and `stalled` waits for the Finish button. Start a stalled search and press Escape, then finish it and reopen search: no late results should appear. Editing the query also cancels the prior result. A stalled search times out after ten seconds and can be retried. Search while following Hubble, select the fixture result, and verify Follow replaces Release and the camera visits the location. Provider attribution must remain visible after selection. The Cesium geocoder has no public transport-abort API; cancellation releases application timers/listeners and ignores the eventual response.

`clock age` compares the last rendered Cesium time with wall time. In settled Live Mode it should remain near zero, including after trajectory refresh, asset loading and celestial travel. Time Explorer intentionally shows an offset: its chosen time stays fixed. Check Follow after at least two automatic trajectory refreshes; fresh positions must not vanish because model or orbit geometry delayed the scene clock.

The selected-spacecraft layer has an EntityCollection regression: 50 trajectory replacements must preserve the exact model Entity and ModelGraphics while updating position/orientation ownership. In the browser, follow Hubble and refresh; it should remain selected and visible without reloading its model. Unload it and verify zero selected scene models and disabled camera actions, then reload it. Travel to Enceladus and back: only Enceladus/Saturn remain off Earth, then the selected Hubble detail returns. Inspector previews are separately counted canvases.

## Actual backend contracts with isolated storage

`tests/check_backend_contract.py` imports the real routes, password hashing, JWT handling, repository reads and Skyfield propagation. It substitutes only environment loading/database construction with a temporary SQLite file with independent pooled connections and a fresh test signing secret. It does not read `.env` contents, start the production lifespan/refresh worker, or call orbital providers. Backend source is unchanged. Orbital elements and accounts are explicitly synthetic; the suite does not validate provider freshness or PostgreSQL writes.

Create a virtual environment under the ignored backup directory with a Windows CPython installation, then install the backend's existing dependencies:

```powershell
python -m venv .orbitwatch-backups/api-venv
.orbitwatch-backups/api-venv/Scripts/python.exe -m pip install -r backend/requirements.lock
.orbitwatch-backups/api-venv/Scripts/python.exe tests/check_backend_contract.py
```

The suite checks 39 API requests: login by name/email, bad credentials, registration/duplicate registration, profile, missing/expired/invalid JWTs, catalog/status, finite propagated coordinates, mixed-success trajectory batches, 480-point orbits and validation errors, including registration concurrent with catalog reads.

### Reliability checks (23 October)

```powershell
.orbitwatch-backups/api-venv/Scripts/python.exe tests/check_reliability.py
.orbitwatch-backups/api-venv/Scripts/python.exe tests/check_availability.py
.orbitwatch-backups/api-venv/Scripts/python.exe tests/check_provider_budgets.py
```

These use temporary SQLite storage, mocked disconnects/HTTP and an intentionally
closed loopback PostgreSQL port with independent credentials. They never load
the real `.env`, disconnect Supabase or run production ingestion. The outage
suite exercises26 actual route requests plus40 simultaneous503s, safe startup,
liveness/readiness, invalid JWT vs valid JWT with DB down, auth recovery, cached
propagator authorization, mid-trajectory errors and sanitized responses.
The strict unexpected-error check also verifies no exception escapes to ASGI
traceback logging and the generated500 retains configured CORS headers.
Availability checks cover single-flight probes,5-60sec recovery backoff/jitter,
worker cancellation/backoff, scheduler lease release and unchanged provider
reservations under DB failures. Existing provider tests cover mock HTTP budgets,
restart/circuits/Retry-After and independent process reservations. External
orbital-provider requests are zero.

The UI fixture's `Fixture infrastructure` selector can inject database503,
backend502, offline, timeout and expired-session failures. It persists only this
test setting in sessionStorage across fixture reloads to exercise saved-session
restoration. `Session diagnostics` reports token presence only, never its value.
Set online to restore normal test behavior; no production accounts are used.
Check retained credentials/no Viewer while unverified, automatic/manual retry,
normal cinematic arrival, failing refresh with existing tracks and401 logout.
Intentional request-failure warnings are expected; distinguish them from crashes.

For browser integration, run the script with `--serve` (loopback port 8001; refresh lifespan disabled), then in another terminal:

```powershell
$env:VITE_API_BASE_URL = 'http://127.0.0.1:8001'
npm run dev --prefix frontend -- --host 127.0.0.1 --port 5175 --strictPort
```

Open `http://127.0.0.1:5175/` and log in with `integration_test` / `OrbitWatch-test-2026`. This uses real backend authentication and propagation with six synthetic orbital fixtures. STALE is expected because the remaining catalog objects have no orbital records. The test process allows only the separate test frontend origin. Stop both test processes when done; temporary database storage is cleaned on normal exit (an interrupted process may leave its test-only directory under the ignored backups).



## Two-mode maps, Time and orbit styles (12 October 2026)

The product contains only Live and Time Explorer. Live System retains 47
named destinations and Catalog; Time System has only the reused Sun/eight-planet
Orbit Map. Check keyboard/panel guards, off-Earth mode rail, recentering, LOD
slider and selected timestamp across Earth→Mars→Jupiter→Earth. Time retains
tracked selections but renders no current satellite positions or telemetry;
Inspector explains unavailable coverage and disables Focus/Follow/orbit actions.

Orbit Trace is the only satellite geometry display; Profile has no style switch.
An old stored `orbitStyle` key is removed without resetting other settings.
Native `tests/orbit-render.html` tests 1/6/12/24/44 real paths over 450 frames,
plus seven precise categories in both selection states over 420 frames and an
Earth-depth check. Selection never changes vertices or source epochs; actual
refresh replaces geometry without a blank frame. Node tests cover selection
origin/reveal, refresh continuity, reduced motion and unchanged real endpoints.
Use `tests/orbit-trace.html` for actual before/after visual review; see
[Orbit Trace](ORBIT_TRACE.md). The native probe does not certify a 44-object
authenticated production network session; the app fixture uses synthetic
satellite input unless its documented read-only bridge is selected.

`tests/maps.html` runs the real NASA metadata parser and loads root JPEGs for
an archived date, an advertised gap and a future reference. In the application
verify actual observation-day text, daily/cloud-gap notice, historical imagery,
future fixed provider identity and missing/offline reference disclosure. Rapid
changes/hours should not accumulate layers/listeners; repeated off-Earth trips
must restore imagery even for an unchanged cache key. Paused ICRF readiness
changes must invalidate canonical centers rather than retain fallback-frame
positions; regression covers all 47 bodies.

Live gallery tests: Google, Bing/Labels/Road, Esri, OSM, NASA Reference. Missing
CARTO key must show UNCONFIGURED, not available; real-key authorization remains
manual until configured. For a deliberate Google403, enable Fail Google access,
travel away/return to create a fresh root, verify Esri fallback and unavailable
Google status, disable the flag and select Google to retry. For Bing failure,
enable Fail Bing metadata before selecting a Bing map, verify actual Esri active
tick, then disable and retry. First-tile403, cancellation, bounded timeout,
empty-layer restoration and pending Google handoff also have automated tests.

Do not edit fixture sources mid-travel. Vite HMR can remount the entry/scene;
reload the development fixture after source changes before final acceptance.
Record fresh-console failures separately from injected faults/HMR artifacts.
Provider IDs/error-listener counts in diagnostics contain no URL/token and are
not a claim about browser-wide/GPU memory. See [imagery configuration](EARTH_IMAGERY.md).

Final checks12 October2026:80 frontend tests, ESLint, production build and the
isolated 39-request backend contract suite pass. The bundled Python runtime
(asset dependencies include Pillow) also validates all 47 GLBs/textures. The
ordinary/backend test Python environments did not have Pillow; this was a tool
dependency issue, resolved with the existing bundled runtime, not an asset failure.
The existing 1204.74 kB main-chunk warning remains. Browser injected403/metadata
failures recovered; old HMR/root artifacts were separated from the fresh session.
A short-view height bug demonstrated in the934×644 fixture was corrected using
one combined Explorer scroll surface, preserving selectable rows and fixed footer.

## 13 October precise orbit/effect/provider validation

Run `node --test tests/satelliteCartesian.test.js` from frontend for explicit
TEME/ITRS/UT1 and independent midpoints. The real seven-case fixture was generated
read-only by `frontend/tests/satellite-cartesian-check.py`; it requires actual
record reads and never starts ingestion. The native effect button in
`tests/orbit-render.html` measures pixel contrast and draws the real moving marker
using production path/material/update code. It excludes provider imagery from
pixel analysis. Existing concurrent1/6/12/24/44 and old legacy regressions remain.

Use `tests/check_provider_budgets.py` for mocked HTTP, persistent/concurrent/four-
process reservations, Retry-After/circuit tests; no real provider HTTP. Run the
isolated backend contract harness with `--workload` for ten simulated minutes,
actual authenticated local routes (66 workload requests), and mocked same-host
lifespan scheduler election. Provider stress never touches production accounts,
records, schema or quota. Tests use temporary local SQLite, not Supabase.

Fixture Fail NASA metadata injects503 only for GIBS capabilities. Enable before
first Time entry, verify fullscreen→disclosed reference and retry after backoff;
no repeated metadata request per date/hour. Test rapid edits and same-day layer
identity, reference toggle, future/gap selection and off-Earth date/travel. Do not
edit sources mid-test: development HMR can reset/remount the fixture; begin clean
runtime acceptance after a reload. Time preparation uses real matching renders/
visible-tile readiness, bounded waits and cancellation, not a cosmetic timer.

Final results: 86 frontend tests, lint and production build pass; 105 isolated
backend requests and provider concurrency/circuit/scheduler checks pass. Native
real-category contrast/motion probe passes 840 frames, concurrent load probe
passes 900 frames, and the far-side ISS depth test leaves zero visible stroke
pixels after Earth occludes it. Real application Chandra/XMM eccentric fallbacks,
signed before/after TLE epoch disclosure, Focus/Follow, short-track refresh and
Time Earth/Mars/Jupiter/date/return were checked. Clean final runtime has no
warnings/errors; the normal authenticated 44-object network session remains a
separate qualification. See the ignored checkpoint/evidence and
[investigation](ORBIT_INVESTIGATION.md) for measurement limits.
