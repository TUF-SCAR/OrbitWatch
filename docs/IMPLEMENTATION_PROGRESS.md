# OrbitWatch implementation checkpoint — 18 September 2026

Historical checkpoint. Later implementation and verification are recorded in the local, uncommitted `.orbitwatch-backups/astra-progress.md`; the remaining-work list and test counts below describe September 18 only.

Local source of truth: `D:\SCAR_IDE\OrbitWatch`, branch `astra-live-redo`. Work remains uncommitted. No clone, checkout, reset, stash, commit, push, or main-branch modification was performed.

Estimated overall completion: **about 75%**, including verification. This is an engineering estimate against the original specification, not a count of changed files. Live Mode is not yet fully presentation-ready.

## Completed implementation

- Auth/startup lifecycle now separates session checking, login-panel extraction, Earth travel, scene readiness, and HUD reveal. Input trimming and accessible form errors are implemented. Backend auth contracts are preserved.
- Live defaults to six major objects, visible orbit paths, and no selected inspector. The full 143-object offline catalog matches backend IDs and search metadata.
- Object search, category/region filters, local custom collections, separate bulk selection, and load/unload controls are implemented.
- Inspector uses photographs by default and an explicit optional NASA Hubble 3D model. Model loading has a total deadline, local Draco decoding, keyboard controls, and disposal on close/switch.
- Focus, Follow, Release, panel ordering, keyboard shortcuts, clean view, refresh cooldown, data-age reporting, and stored quality settings are implemented.
- One Cesium Viewer handles Earth and all 47 destinations. Detail is limited to the destination and moon parent. Travel loads immediately, suppresses controls, unloads origin detail, and supports lightweight fallback/retry.
- Astronomical orbit lines use straight space segments. This fixes the observed Cesium worker allocation failure caused by Earth-surface subdivision at astronomical distances. Selected orbital lines update with the reference frame.
- Cesium render-loop failures reach the scene retry boundary; retry resets destination UI to Earth. Ordinary UI clicks no longer reset Earth’s idle-camera timer.
- Inspector orbital values now come from the scene's own element model. Small-body references point to JPL's small-body database.

## Assets and realism

See [ASSETS.md](ASSETS.md) for exact provenance and processing commands.

- Nine bounded reference maps, eight matching textured GLBs, NASA ISS/Hubble photographs, and the verified Hubble model are present.
- Moon uses the NASA SVS/LRO reference map. Mars uses an equirectangular Viking reference map rather than an incompatible UV atlas.
- Seventeen cracked procedural meshes were repaired with continuous illustrative surfaces and smooth normals. These remain explicitly illustrative, not mission-derived shape models.
- All 46 non-Earth celestial GLBs use consistent glTF Y-up geometry; generated rings share the same equatorial convention.
- The unused NASA Mars source GLB is preserved under `frontend/scripts/reference`, outside shipped public assets. Draco license/notice files are included.

## Still partial / remaining

- Complete approximately 25 sourced, interesting facts for the remaining 37 bodies; major Sun/planet/Moon collections are populated. Inspector scientific content needs further depth.
- Complete geographic label coverage and verify provider alignment at country, regional, city, and street scales. Native labels are preferred, duplicate city overlays are suppressed, and baked-label limitations are explained.
- Improve and review remaining procedural textures, lighting, ring realism, and small-body shapes. Most spacecraft still have an honest unavailable-photo/model state; only Hubble has a verified interactive model.
- Finish real backend login/register/session-expiry integration, complete camera/panel/collection regression flows, and test map/geocoder outages.
- Finish 1536×864, 1920×1080, narrow-screen, reduced-motion, and keyboard-only verification. The primary manual viewport so far is 1366×768.
- Measure sustained GPU/heap behavior over repeated trips, inspect rapid-click cancellation and timeout races, and finish final visual polish. The large application bundle remains a build warning.

## Verification

- `npm run lint`: passes.
- `npm test`: 3 passing tests — backend/offline catalog parity; all destination coordinates, moon distances and orbit closure; bounded astronomical orbit geometry.
- `npm run build`: passes. Main JS approximately 1,089.81 kB / 294.79 kB gzip; large-chunk warning remains.
- `python frontend/scripts/check_assets.py`: passes for 47 shipped GLBs, buffer/accessor bounds, embedded image decoding, matching reference textures, map dimensions, axis markers, and closed repaired meshes.
- `git diff --check`: passes.

Browser verification uses the isolated development fixture at `http://127.0.0.1:5174/tests/ui.html`. Its session and orbital data are explicitly synthetic. This does not validate backend auth or the accuracy of a real orbital feed.

Observed manually across this continuation: trimmed fixture login and saved-session restore; six-object Earth start; search shortcut; station filtering; bulk selection and load/unload; collection creation/persistence; photo inspector; Hubble 3D load and disposal (two canvases back to one); Follow/Release; idle Earth framing; System hierarchy; Mars travel and local orbit/zoom; Phobos and Deimos travel; repaired Deimos rendering; Saturn travel. The Mars allocation failure was reproduced and corrected. No render errors appeared on the subsequent Mars/moon route before the deliberate outage test.

The original asset-failure fixture intercepted only `fetch`, but Cesium uses XHR for GLBs. It has been corrected to intercept both transports; earlier runs with that switch are not counted as successful failure-recovery tests.

## Blockers and boundaries

- Real backend API is unreachable on `127.0.0.1:8000`. The available bundled Python lacks FastAPI, uvicorn, SQLAlchemy, dotenv, and Skyfield. A working backend runtime/database is needed for real integration verification.
- Browser access works again; the earlier account-usage approval block is no longer active.
- Backend auth and database source files remain unchanged. Time Explorer and Disaster Lab retain their existing scope; no new future-mode implementation was started.

## Change inventory and dependencies

Main source areas: `App.jsx`, `auth/AuthRoot.jsx`, auth page/CSS, startup/HUD/panels, `OrbitGlobe.jsx`, `solarSystemLayer.js`, `solarSystemEphemeris.js`, API client, catalog/reference data, and Live CSS. New files cover celestial inspector/facts, place search, scene boundary, asset processing/validation, and development regression tests.

Three.js is now a direct dependency because the auth preview and optional inspector renderer import it explicitly. GLTF/Draco loaders remain lazy. No additional runtime dependency was added in this continuation.

Before presentation, specifically test real login/register/logout and expiry, geocoding, map-provider keys, long repeated Earth↔planet↔moon trips, failure/slow-network recovery, panel keyboard focus, custom-collection membership, reduced motion, and all requested desktop sizes.
