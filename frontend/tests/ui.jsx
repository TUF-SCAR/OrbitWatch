// Development-only fixture. Not imported by the production entry or build.
// Run on port 5174 to isolate its session/storage from the real application.
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { MotionConfig } from "motion/react";
import { Camera, IonGeocoderService, IonImageryProvider, IonResource, Rectangle } from "cesium";
import AuthRoot from "../src/auth/AuthRoot.jsx";
import { SPACE_OBJECTS } from "../src/data/spaceObjects.js";
import "../src/styles.css";
import "cesium/Build/Cesium/Widgets/widgets.css";
import "../src/live.css";
import { instrumentScenes } from "./sceneMetrics.js";
import { instrumentMotionPreference } from "./motionPreference.js";
const sceneMetrics = instrumentScenes();
const motionPreference = instrumentMotionPreference();
const realFetch = window.fetch.bind(window);
const realSatelliteFeed = new URLSearchParams(location.search).get("satellites") === "backend";
// AuthRoot changes the route to / during handoff. Keep the isolated fixture
// entry on reload instead of silently loading the production entry/transport.
const fixtureUrl = location.href;
const realReplaceState = history.replaceState;
history.replaceState = function (state, unused, url) {
  return realReplaceState.call(this, state, unused, url === "/" || url === "/login" ? fixtureUrl : url);
};
const apiOrigin = new URL(import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000", location.origin).origin;
let feed = "online";
let failModels = false;
let failTravel = false;
let failMap = false;
let failGoogle = false;
let failNasa = false;
const realIonResource = IonResource.fromAssetId;
IonResource.fromAssetId = function (id,...args) {
  if(failGoogle && id===2275207) return Promise.reject(Object.assign(new Error("Synthetic Google authorization failure"),{statusCode:403}));
  return realIonResource.call(this,id,...args);
};
let spacecraftModel = "online";
let placeSearch = "provider";
const pendingPlaces = new Set();
const fixturePlaces = () => [{ displayName: "Hyderabad (synthetic search fixture)", destination: Rectangle.fromDegrees(78.3, 17.2, 78.6, 17.6), attributions: [{ html: "OrbitWatch synthetic geocoder fixture", collapsible: false }] }];
const realGeocode = IonGeocoderService.prototype.geocode;
IonGeocoderService.prototype.geocode = function (...args) {
  if (placeSearch === "fixture") return Promise.resolve(fixturePlaces());
  if (placeSearch === "offline") return Promise.reject(new Error("Synthetic place search unavailable"));
  if (placeSearch === "stalled") return new Promise((resolve) => pendingPlaces.add(resolve));
  return realGeocode.apply(this, args);
};
const realImagery = IonImageryProvider.fromAssetId;
IonImageryProvider.fromAssetId = function (...args) {
  if (failMap) return Promise.reject(new Error("Synthetic map metadata failure"));
  return realImagery.apply(this, args);
};
const realFlight = Camera.prototype.flyToBoundingSphere;
Camera.prototype.flyToBoundingSphere = function (...args) {
  if (failTravel) throw new Error("Synthetic camera failure");
  return realFlight.apply(this, args);
};
// Cesium uses XHR for GLBs; Three.js uses fetch. Exercise both real transports.
const realOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url, ...args) {
  const target = new URL(String(url), location.origin);
  return realOpen.call(this, method, failModels && target.pathname.includes("/models/celestial/") ? "/tests/forced-asset-failure.glb" : url, ...args);
};
import.meta.hot?.dispose(() => { root.unmount(); motionPreference.dispose(); sceneMetrics.dispose(); window.fetch = realFetch; history.replaceState = realReplaceState; XMLHttpRequest.prototype.open = realOpen; Camera.prototype.flyToBoundingSphere = realFlight; IonImageryProvider.fromAssetId = realImagery; IonResource.fromAssetId = realIonResource; IonGeocoderService.prototype.geocode = realGeocode; for (const resolve of pendingPlaces) resolve([]); pendingPlaces.clear(); });
const user = { id: "ui-fixture", username: "UI Test", email: "ui-test@example.invalid", created_at: "2026-09-16T00:00:00Z" };
function sample(id, seconds) { const a = (Date.now() / 1000 + seconds) / 900 + id; return { timestamp: new Date(Date.now() + seconds * 1000).toISOString(), latitude: Math.sin(a) * 50, longitude: ((a * 180 / Math.PI + 180) % 360) - 180, altitude_km: 420 + id % 200 }; }
function trajectory(id) { return { norad_id: id, positions: Array.from({ length: 61 }, (_, i) => sample(id, i * 5)), orbital_period_minutes: 95, orbital_source: "SYNTHETIC UI FIXTURE" }; }
const json = (value, status = 200) => Promise.resolve(new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }));
window.fetch = (input, options = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url, location.origin), path = url.pathname;
  if (failNasa && url.hostname === "gibs.earthdata.nasa.gov" && url.searchParams.get("REQUEST") === "GetCapabilities") return Promise.resolve(new Response("Fixture NASA metadata unavailable",{status:503}));
  if (failModels && path.includes("/models/celestial/")) return Promise.resolve(new Response("Fixture model failure", { status: 503 }));
  if (path.includes("/models/satellites/verified/") && spacecraftModel !== "online") {
    if (spacecraftModel === "offline") return Promise.resolve(new Response("Fixture spacecraft failure", { status: 503 }));
    const signal = options.signal || input.signal;
    return new Promise((_, reject) => {
      const abort = () => reject(signal?.reason || new DOMException("Aborted", "AbortError"));
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    });
  }
  if (url.origin !== apiOrigin || !path.startsWith("/api/")) return realFetch(input, options);
  if (path === "/api/auth/login") { const body = JSON.parse(options.body); return body.username_or_email === "ui-test" && body.password === "orbitwatch-test" ? json({ access_token: "ui-fixture-not-a-real-jwt" }) : json({ detail: "Invalid credentials (UI fixture)" }, 401); }
  if (path === "/api/auth/register") return json({ access_token: "ui-fixture-not-a-real-jwt" }, 201);
  if (path === "/api/auth/me") return json(user);
  if (feed === "offline") return Promise.reject(new TypeError("UI fixture offline"));
  if (realSatelliteFeed && /^\/api\/satellites\/(trajectories|\d+\/(orbit|position|trajectory))$/.test(path)) {
    // Only test identity is synthetic. Public orbital samples come from the
    // unmodified backend propagators/database through the loopback test bridge.
    return realFetch(`http://127.0.0.1:8001${path}${url.search}`, options);
  }
  if (path.endsWith("/catalog")) return json({ objects: SPACE_OBJECTS });
  if (path.endsWith("/data-status")) return json({ stale: feed === "stale" || feed === "long", missing_supported_objects: 0, age_seconds: feed === "unavailable" ? null : feed === "long" ? 999999900 : feed === "stale" ? 90000 : 120 });
  if (path.endsWith("/trajectories")) return json({ objects: JSON.parse(options.body).norad_ids.map(trajectory), errors: [] });
  const id = Number(path.split("/")[3]);
  if (path.endsWith("/position")) return json({ norad_id: id, ...sample(id, 0), orbital_source: "SYNTHETIC UI FIXTURE" });
  if (path.endsWith("/orbit")) return json({ norad_id: id, positions: Array.from({ length: 240 }, (_, i) => sample(id, i * 24)) });
  return json({ detail: "Unsupported fixture endpoint" }, 404);
};
export default function Fixture() {
  const [controlsVisible,setControlsVisible]=useState(true);
  useEffect(()=>{const toggle=event=>{if(event.altKey&&event.shiftKey&&event.code === "KeyT")setControlsVisible(v=>!v);};window.addEventListener("keydown",toggle);return()=>window.removeEventListener("keydown",toggle);},[]);
  const [reviewTiming,setReviewTiming]=useState("normal");
  useEffect(()=>{const values=reviewTiming === "slow"?{"--ui-motion-loader":10000,"--ui-motion-reveal-interval":1200,"--ui-motion-morph":6000}:{};for(const name of ["--ui-motion-loader","--ui-motion-reveal-interval","--ui-motion-morph"]){if(name in values)document.documentElement.style.setProperty(name,values[name]);else document.documentElement.style.removeProperty(name);}return()=>{for(const name of Object.keys(values))document.documentElement.style.removeProperty(name);};},[reviewTiming]);
  const [fontScale,setFontScale]=useState("default");
  useEffect(()=>{if(fontScale === "default")document.documentElement.style.removeProperty("--ui-font-scale");else document.documentElement.style.setProperty("--ui-font-scale",fontScale);return()=>document.documentElement.style.removeProperty("--ui-font-scale");},[fontScale]);
  const [cameraMetrics,setCameraMetrics]=useState("");
  const [metrics, setMetrics] = useState("");
  const [celestialMetrics, setCelestialMetrics] = useState("");
  const [motion, setMotion] = useState("system");
  const [spacecraft, setSpacecraft] = useState(spacecraftModel);
  const [places, setPlaces] = useState(placeSearch);
  useEffect(() => { const timer = window.setInterval(() => { setCameraMetrics(sceneMetrics.cameraRead());setMetrics(sceneMetrics.read()); setCelestialMetrics(sceneMetrics.celestialRead()); }, 1500); return () => window.clearInterval(timer); }, []);
  const [status, setStatus] = useState(feed);
  const [broken, setBroken] = useState(false);
  const [brokenTravel, setBrokenTravel] = useState(false);
  const [brokenMap, setBrokenMap] = useState(false);
  const [brokenGoogle,setBrokenGoogle] = useState(false);
  const [brokenNasa,setBrokenNasa] = useState(false);
  return <><AuthRoot /><output aria-label="Camera diagnostics" hidden>{cameraMetrics}</output><output aria-label="Celestial representation diagnostics" style={{ opacity:controlsVisible?1:0, position:"fixed", bottom:48, left:8, zIndex:9999, maxWidth:500, color:"#bbb", background:"#171717cc", fontSize:8, pointerEvents:"none", maxHeight:32, overflow:"hidden" }}>{celestialMetrics}</output><output aria-label="Scene resource diagnostics" aria-live="off" style={{ opacity:controlsVisible?1:0, position: "fixed", bottom: 28, left: 8, zIndex: 9999, color: "#ddd", background: "#171717cc", fontSize: 10, pointerEvents: "none" }}>{metrics}</output><div style={{ display:controlsVisible?"block":"none", position: "fixed", zIndex: 9999, bottom: 0, left: 0, padding: "3px 8px", background: "#542917", color: "white", fontSize: 10, maxWidth: "100vw", whiteSpace: "nowrap", overflowX: "auto" }}>UI TEST · SYNTHETIC DATA · ui-test / orbitwatch-test <button onClick={()=>setControlsVisible(false)}>Hide test controls</button><select aria-label="Fixture assembly timing" value={reviewTiming} onChange={event=>setReviewTiming(event.target.value)}><option value="normal">Normal assembly</option><option value="slow">Slow review</option></select><select aria-label="Fixture font scale" value={fontScale} onChange={event=>setFontScale(event.target.value)}><option value="default">Default type</option><option value="1">Type ×1</option><option value="1.25">Type ×1.25</option></select><button onClick={() => sceneMetrics.advance(21600)}>Advance scene 6h</button><button onClick={() => sceneMetrics.resume()}>Resume Live clock</button><button onClick={() => sceneMetrics.zoom(10)}>Zoom out ×10</button><button onClick={() => sceneMetrics.zoom(0.1)}>Zoom in ×10</button><select aria-label="Fixture feed" value={status} onChange={(event) => { feed = event.target.value; setStatus(feed); }}>{["online", "stale", "offline", "unavailable", "long"].map((value) => <option key={value}>{value}</option>)}</select><select aria-label="Fixture JavaScript motion preference" value={motion} onChange={(event) => { setMotion(event.target.value); motionPreference.set(event.target.value); }}>{["system", "reduce", "full"].map((value) => <option key={value}>{value}</option>)}</select><select aria-label="Fixture spacecraft model" value={spacecraft} onChange={(event) => { spacecraftModel = event.target.value; setSpacecraft(spacecraftModel); }}>{["online", "offline", "stalled"].map((value) => <option key={value}>{value}</option>)}</select><select aria-label="Fixture place search" value={places} onChange={(event) => { placeSearch = event.target.value; setPlaces(placeSearch); }}>{["provider", "fixture", "offline", "stalled"].map((value) => <option key={value}>{value}</option>)}</select><button type="button" onClick={() => { for (const resolve of pendingPlaces) resolve(fixturePlaces()); pendingPlaces.clear(); }}>Finish stalled place searches</button><button type="button" onClick={() => { const canvas = document.querySelector(".verified-model-canvas canvas"); const gl = canvas?.getContext("webgl2"); gl?.getExtension("WEBGL_lose_context")?.loseContext(); }}>Lose spacecraft context</button><label><input type="checkbox" checked={broken} onChange={(event) => { failModels = event.target.checked; setBroken(failModels); }} /> Fail celestial models</label><label><input type="checkbox" checked={brokenTravel} onChange={(event) => { failTravel = event.target.checked; setBrokenTravel(failTravel); }} /> Fail camera travel</label><label><input type="checkbox" checked={brokenMap} onChange={(event) => { failMap = event.target.checked; setBrokenMap(failMap); }} /> Fail Bing metadata</label><label><input type="checkbox" checked={brokenGoogle} onChange={(event)=>{failGoogle=event.target.checked;setBrokenGoogle(failGoogle);}} /> Fail Google access</label><label><input type="checkbox" checked={brokenNasa} onChange={event=>{failNasa=event.target.checked;setBrokenNasa(failNasa);}} /> Fail NASA metadata</label></div></>;
}
if (!import.meta.env.DEV || location.port !== "5174") throw new Error("UI fixture requires isolated development port 5174.");
const root = createRoot(document.getElementById("root"));
root.render(<MotionConfig reducedMotion="user"><Fixture /></MotionConfig>);

