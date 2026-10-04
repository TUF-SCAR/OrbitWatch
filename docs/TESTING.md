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

`frontend/tests/ui.html` is a development-only synthetic UI fixture. Serve the frontend on `127.0.0.1:5174` and open `/tests/ui.html`. Use `ui-test` / `orbitwatch-test`. The bottom strip can force feed, model, camera, and Bing metadata failures. Its fake session is isolated from port 5173 and it is not part of the production entry/build.

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
.orbitwatch-backups/api-venv/Scripts/python.exe -m pip install fastapi uvicorn sqlalchemy python-dotenv PyJWT 'pwdlib[argon2]' skyfield httpx
.orbitwatch-backups/api-venv/Scripts/python.exe tests/check_backend_contract.py
```

The suite checks 39 API requests: login by name/email, bad credentials, registration/duplicate registration, profile, missing/expired/invalid JWTs, catalog/status, finite propagated coordinates, mixed-success trajectory batches, 480-point orbits and validation errors, including registration concurrent with catalog reads.

For browser integration, run the script with `--serve` (loopback port 8001; refresh lifespan disabled), then in another terminal:

```powershell
$env:VITE_API_BASE_URL = 'http://127.0.0.1:8001'
npm run dev --prefix frontend -- --host 127.0.0.1 --port 5175 --strictPort
```

Open `http://127.0.0.1:5175/` and log in with `integration_test` / `OrbitWatch-test-2026`. This uses real backend authentication and propagation with six synthetic orbital fixtures. STALE is expected because the remaining catalog objects have no orbital records. The test process allows only the separate test frontend origin. Stop both test processes when done; temporary database storage is cleaned on normal exit (an interrupted process may leave its test-only directory under the ignored backups).


