# Preload the auth robot arm

## Cause and reproduction

`AuthPage.jsx` only rendered the existing robot arm SVG while `extracting` or `delivering` was true. In a fresh phone browser context, the login and registration panels appeared while the SVG did not exist in the DOM. On successful authentication, React mounted the SVG at the same time its first CSS animation began. This made the first arm movement depend on the first render, layout, and paint of the SVG.

I reproduced the prior behavior using the `origin/main` versions of `AuthPage.jsx` and `AuthPage.css` in a fresh Playwright Chrome context at 390 × 844. Before form submission, the arm SVG count was zero. On the first mocked successful login, its animation ended at 3804.5 ms, but the existing extraction timer began Earth travel at 3798.5 ms: the transition advanced **6 ms before the arm's `animationend` event**. Both desktop and phone extraction used a 1600 ms timer alongside 1600 ms animations, so the handoff could win the final-frame race.

This confirmed two first-play readiness problems: the arm was cold mounted when extraction started, and the fixed timer was not synchronized with the actual end of the arm and panel movement.

## Changes

- `frontend/src/pages/AuthPage.jsx` — keep the existing SVG mounted whenever the auth interface renders. Its idle state is hidden, inaccessible to pointer input, and animation-free via CSS. On extraction or delivery, CSS starts the existing desktop animation or the phone's vertical animation. The SVG remains the same element across repeated login cycles so the animation can replay.
- `frontend/src/pages/AuthPage.jsx` — complete normal-motion extraction only after both the arm and panel extraction animations finish. A 2200 ms fallback bounds the wait if an animation-end event is missed. Reduced motion keeps its existing 150 ms handoff and does not wait for CSS animation events.
- `frontend/src/pages/AuthPage.css` — hide the preloaded arm while idle and activate it only for extraction or delivery. The desktop selectors use the existing `arm-reach` keyframes, position, dimensions, origin, and 1600 ms duration. The phone retains the straight bottom-center path and existing 1600 ms phone keyframes.

No logout cinematic, authentication logic, backend, or production services were changed or used.

## Verification

The browser checks used a temporary Vite fixture and Playwright with fresh browser contexts. Auth endpoints were mocked locally. The before-fix reproduction and after-fix interaction checks were run from `frontend` with these commands:

```powershell
& (Get-Command node.exe).Source .\node_modules\vite\bin\vite.js build --config ..\.setup-cache\preload-auth-qa\vite.config.mjs
& (Get-Command node.exe).Source ..\.setup-cache\preload-auth-qa\repro-baseline.cjs
& (Get-Command node.exe).Source ..\.setup-cache\preload-auth-qa\run-checks.cjs
& (Get-Command node.exe).Source "..\.orbitwatch-tools\npm\bin\npm-cli.js" run build
```

Results:

- Baseline first cold login: **REPRODUCED**. SVG absent before submit; Earth handoff occurred 6 ms before the first arm animation-end event.
- First login in fresh 390 × 844 mobile context: **PASS**. SVG was mounted and idle-hidden before submit, then visibly animated on the first login. It stayed centered on the panel bottom, moved vertically with zero measured horizontal drift, and carried the panel about 928 px. Earth handoff followed the panel and arm animation-end events by less than 1 ms.
- First registration in a separate fresh 390 × 844 mobile context: **PASS**, with the same mounted SVG and grip alignment.
- Second login in the first context: **PASS**. The same SVG element was reused, and its animation replayed and completed before Earth handoff.
- Logout delivery at 844 × 390: **PASS**. The arm moved vertically, delivered the panel, and retracted; measured horizontal drift was zero.
- Reduced-motion login handoff: **PASS** at 163 ms in the browser, consistent with the existing 150 ms timer plus frame scheduling.
- Desktop at 1280 × 900: **PASS**. Arm stayed 650 × 260 px at left 820 px, top 315 px, origin 650 × 208 px. `arm-reach`, `panel-carry`, and `grip-close` keyframes match `origin/main`; arm and panel durations remained 1.6 s and the panel remained 500 px wide.
- Frontend production build: **PASS** (2,154 modules). Vite reported the existing 1,762 kB main-chunk size warning.

The temporary test fixture and browser harness were removed after verification. No production account, backend, or service was contacted.
