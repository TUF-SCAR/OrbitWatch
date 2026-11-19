# Mobile auth arm positioning

## Cause

The existing robot arm SVG is drawn horizontally for the desktop side-entry animation. Phone CSS changed its left offset but retained the 650 px desktop sizing and horizontal keyframes, which pushed the SVG beyond the phone viewport. The old `max-width: 760px` rule also did not cover wider phones in landscape.

## Decisions

- Kept the existing SVG artwork, desktop arm rules, desktop keyframes, and the 1600 ms auth handoff unchanged.
- Added a panel stage around the existing panel and SVG. The stage is `display: contents` by default, preserving their desktop layout; it becomes a relative positioning stage only under OrbitWatch’s phone media query: `(max-width: 600px), (max-width: 1000px) and (max-height: 600px) and (pointer: coarse)`.
- In phone mode, rotated and sized the SVG for a vertical, claw-up path. Its claw joint is anchored to the panel stage’s actual bottom-center edge, so the Login and taller Registration panels share the same alignment.
- On extraction, the arm rises from below, closes at the same keyframe the panel starts moving, and carries the panel down with the stage. The desktop horizontal panel animation is disabled only in phone mode.
- On delivery, a separate phone-only stage animation carries the Login panel upward and holds it at its normal position. The claw visibly releases it before the arm retracts vertically.
- Left the existing reduced-motion handling, Earth transition, and auth handoff code untouched.

## Files changed

- `frontend/src/pages/AuthPage.jsx` — grouped the existing panel and SVG in the layout stage.
- `frontend/src/pages/AuthPage.css` — added phone-only positioning and vertical motion; retained desktop rules and keyframes.
- `docs/mobile-auth-arm-bottom.md` — this work log.

## Checks run

The local Vite frontend was used with Playwright in Chrome. Auth endpoints returned fixture responses and other backend requests were mocked; no backend or production service was started. The temporary, ignored `.setup-cache/mobile-auth-arm-qa.cjs` browser harness was removed after verification.

From the repository root, the browser harness was invoked with:

```powershell
$nodePath=(Get-Command node.exe).Source; & $nodePath .setup-cache\mobile-auth-arm-qa.cjs --auth-only
$nodePath=(Get-Command node.exe).Source; & $nodePath .setup-cache\mobile-auth-arm-qa.cjs --logout-only
$nodePath=(Get-Command node.exe).Source; & $nodePath .setup-cache\mobile-auth-arm-qa.cjs --fixture-only
$nodePath=(Get-Command node.exe).Source; & $nodePath .setup-cache\mobile-auth-arm-qa.cjs --desktop-only
```

Results:

- Login: **PASS** at 360 × 800 portrait and 844 × 390 landscape.
- Registration: **PASS** at 390 × 844 portrait and 780 × 360 landscape.
- Logout through Profile → Logout: **PASS** at 390 × 844 portrait and 844 × 390 landscape. The Login panel was carried from below the viewport, set in place, released, and left stationary while the arm retracted straight down.
- Delivery component fixture: **PASS** at 390 × 844 and 844 × 390. The claw joint stayed within 1.5 px of panel center; grip stayed within 2 px of the panel bottom; measured horizontal drift stayed below 1.5 px.
- Desktop runtime comparison at 1280 × 900: **PASS**. Computed arm size 650 × 260 px, position 820 × 315 px, transform origin 650 × 208 px, `arm-reach` and `panel-carry` keyframes, and both 1.6 s durations matched the existing desktop rules. The wrapper computed to `display: contents`; the panel remained centered at 640 × 450 px. The baseline desktop CSS/keyframes were unchanged in the diff.

Frontend build command, run from `frontend`:

```powershell
$nodePath=(Get-Command node.exe).Source; & $nodePath "..\.orbitwatch-tools\npm\bin\npm-cli.js" run build
```

Result: **PASS**, Vite built 2,154 modules. Vite reported its existing-style bundle-size warning for the 1,762 kB main JavaScript chunk; the build completed successfully.

## Checks not run

No production login, backend, deployment, or release checks were run; they are not needed for this frontend-only animation change. The Playwright harness was temporary and is not included in the branch.

## Follow-up: landscape panel width

### Change

The phone stage previously set a 430 px width and forced the panel to `width: 100%`. That overrode the existing 450 px panel rule on a touch device at 844 × 390. The stage now uses its panel's max-content width, capped by its containing width, and no longer overrides the panel width. The arm remains positioned relative to the stage, so its center and bottom anchors follow the panel's responsive dimensions. No desktop selectors or keyframes changed.

### Verification

A temporary Playwright check rendered the actual `AuthPage.css` in Chrome with touch emulation. Its command was:

```powershell
& (Get-Command node.exe).Source .setup-cache\browser-qa\mobile-arm-followup.cjs
```

Results:

- 844 × 390 landscape: **PASS**; panel and stage both 450 px; grip errors were 0.01 px horizontally and 0.04 px vertically.
- 390 × 844 portrait: **PASS**; panel and stage both 362 px; grip errors were 0.03 px horizontally and 0.02 px vertically.
- 360 × 800 portrait: **PASS**; panel and stage both 332 px; grip errors were 0.00 px horizontally and 0.07 px vertically.
- Desktop at 1280 × 900: **PASS**; computed stage, arm position/size/origin, and panel geometry matched the pre-follow-up stylesheet exactly (`display: contents` for the stage; 650 × 260 px arm at 820 × 315 px; 500 px panel).
- Frontend build from `frontend`: **PASS**, 2,154 modules. Vite retained its warning that the main JavaScript chunk is 1,762 kB after minification.

The temporary Playwright check was removed after use. No backend or production services were started.
