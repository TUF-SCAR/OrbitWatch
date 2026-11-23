# Release Sprint A — Navigation, touch, mobile HUD and auth

Review branch `fix/release-navigation-auth`, based on `origin/main` at `fa2582cd2df4a9147e0c03a6f5039c4708e6160d`.

## Causes and changes

- **Camera ownership.** The zoom buttons used Earth cartographic altitude even after the destination controller took over the camera. The destination controller disabled native inputs and implemented wheel zoom independently, leaving pinch unmapped. Local bodies and wide Earth views now use distance from the current target, with absolute limits shared by button, wheel and pinch. Close Earth wheel and trackpad input use the existing bounded button dolly. In a cold desktop Chrome context, Cesium's native cursor-pick wheel path produced non-finite camera coordinates and a frustum `RangeError`. The bounded path uses the current camera direction and avoids that pick. Close Earth pinch and satellite Follow keep Cesium input. The slider uses the active range and the existing 240 AU ceiling.
- **Mobile selection and HUD.** The responsive marker card became a full phone dialog. The phone now shows a compact, nonmodal selection card with Travel, Details and Close. Details opens the existing inspector on demand. The lower right zoom controls reserve clearance above Readouts and the dock, including in landscape. Desktop gets a horizontal zoom pair beside the lower controls. At 360 px a cold layout check caught the completed HUD wrappers offsetting some controls a second time. The phone HUD now uses the viewport-sized stage once the reveal finishes. The phone header uses a larger OrbitWatch wordmark with its existing font and a dark gradient over map labels. The adaptive disclosure and focusable 44 px actions follow the [Material supporting pane guidance](https://developer.android.com/develop/ui/compose/layouts/adaptive/canonical-layouts#supporting-pane) and [WCAG 2.2 target and focus guidance](https://www.w3.org/TR/WCAG22/).
- **Auth arm.** The previous preload kept the SVG at zero opacity and hidden until motion began. Phone verification also started mounting the Cesium viewer during the same render as pickup. Those are confirmed first-frame risks from the production code path. Browser traces confirm the updated path parks the existing, styled SVG beyond the viewport, resolves its geometry and gives the browser a frame before authentication proceeds, with a 120 ms preparation ceiling. The phone's live viewer now starts after pickup. Earth travel waits for arm and panel completion, with the existing 2.2 s fallback and 150 ms reduced-motion handoff. The original arm geometry and desktop and phone keyframes are used for pickup and delivery.

## Verification

Frontend commands from `frontend`, using the existing local npm installation via Node:

```powershell
$node = (Get-Command node.exe).Source
$npm = '..\.orbitwatch-tools\npm\bin\npm-cli.js'
& $node $npm run lint
& $node $npm test
& $node --test --test-concurrency=3 tests/*.test.js
& $node $npm run build
```

Lint passed. Both full suite runs passed with 226 tests and zero failures. The production build passed with 2,154 modules and Vite's large JavaScript chunk warning. The focused Cesium controller regression extends the existing layer test to exercise local button and pinch range, the local minimum, the Earth wheel route, native Follow routing, and the overview slider and distance ceiling.

The browser checks used Vite's built OrbitWatch frontend in isolated Playwright Chrome contexts with SwiftShader and the project assets. Playwright served the bundle locally, mocked authentication and verification responses, and blocked external providers. The build enabled the existing development camera diagnostics for range and scene-state measurements. Browser evidence is in the ignored local directory `.setup-cache/release-navigation-evidence`.

- **Auth rendering.** `first-login-390-pickup.png` shows the arm and claw aligned at the bottom of the login panel on the first successful submission in a fresh context. The measured idle SVG was outside the viewport with its drawing styles applied and no running animation. `first-registration-360-pickup.png`, `logout-delivery-390.png` and `repeat-login-390-pickup.png` capture the corresponding UI flows. The first login, registration and repeat login reached Earth travel after both extraction animations finished. A 1280 × 900 desktop login played `arm-reach`, `grip-close` and `panel-carry` with the original 650 × 260 px SVG and 1600 ms keyframes.
- **Auth timing.** With extraction animation events deliberately blocked, the real auth flow began Earth travel after 2,217 ms. With reduced motion active it began after 177 ms, consistent with the 150 ms timer plus browser scheduling.
- **Mobile navigation.** At 844 × 390 the Moon card fit in the lower left while the Moon and both zoom buttons remained visible. At 390 × 844 the Mars card did the same. Both cards opened the existing Details view and could be dismissed. Real CDP touch events and UI button clicks changed the measured Earth, Mars and Moon camera ranges. Screenshots are `selection-844.png`, `selection-390.png` and the viewport images prefixed `hud-`.
- **Desktop navigation.** At 1280 × 900 and 1920 × 1080 the zoom buttons fit inside the viewport above the attribution strip. Earth responded to wheel and buttons at both sizes. At 1280 × 900, Jupiter responded to buttons, wheel and Ctrl-wheel. The slider reached 240 AU, and wheel and button movement returned it below that limit. The camera then returned to Earth.
- **Phone overview.** Starting from Earth at 390 × 844, zoom out revealed the scale slider. After setting it to 240 AU, simulated touch pinch moved inward to roughly 110 AU and back outward. The slider updated with the range. The wide scene frame is `overview-phone-390.png`.
- **HUD measurements.** At 360 × 800 and 390 × 844 the bottom of the zoom group stayed 12 px above Readouts. At 844 × 390 the clearance was 24 px. Notification and profile controls fit at all three phone sizes.
- **Time Explorer smoke check.** At 360 × 800, the Time Explorer date strip stayed clear of zoom controls. Earth zoom increased the measured camera range and the mode control returned to Live. The rendered frame is `time-360.png`.

## Limits

Chrome emulation produced actual frames using the laptop's software WebGL path. Physical Android rendering remains unverified, including when its compositor chooses to rasterize the parked SVG. Trackpad behavior was exercised with browser Ctrl-wheel events. This run used local imagery and mocked auth. The browser logged the existing missing Sun thumbnail during catalog navigation. There were no backend, production or database modifications.
