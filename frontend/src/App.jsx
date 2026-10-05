import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { Aperture, Maximize2, RefreshCcw } from "lucide-react";
import ModeRail from "./components/ModeRail.jsx";
import TopHud from "./components/TopHud.jsx";
import OrbitGlobe from "./components/OrbitGlobe.jsx";
import ObjectExplorer from "./components/ObjectExplorer.jsx";
import InspectorPanel from "./components/InspectorPanel.jsx";
import LiveDock from "./components/LiveDock.jsx";
import TimeDock from "./components/TimeDock.jsx";
import DisasterDock from "./components/DisasterDock.jsx";
import SceneDock from "./components/SceneDock.jsx";
import CameraMenu from "./components/CameraMenu.jsx";
import MapSettings from "./components/MapSettings.jsx";
import SpatialSurface from "./components/SpatialSurface.jsx";
import CinematicStage from "./components/CinematicStage.jsx";
import ProfilePanel from "./components/ProfilePanel.jsx";
import SystemMenu from "./components/SystemMenu.jsx";
import SystemScaleSlider from "./components/SystemScaleSlider.jsx";
import CelestialTravelCard from "./components/CelestialTravelCard.jsx";
import CelestialInspector from "./components/CelestialInspector.jsx";
import PlaceSearch from "./components/PlaceSearch.jsx";
import SceneBoundary from "./components/SceneBoundary.jsx";
import { fetchSatelliteCatalog, fetchSatelliteDataStatus, fetchSatellitePosition } from "./services/orbitwatchApi.js";
import { SPACE_OBJECTS } from "./data/spaceObjects.js";
import { navigationVisibility } from "./utils/navigationVisibility.js";

const DEFAULT_MAJOR_OBJECTS = [25544, 20580, 48274, 39084, 58990, 26407];
const TIME_DEFAULT_OBJECTS = [25544, 20580, 48274, 39084];
const TIME_OBJECT_LIMIT = 15;

function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("orbitwatch_settings") || "{}");
    return { quality: ["auto", "performance", "balanced", "quality"].includes(saved.quality) ? saved.quality : "auto", preview3d: saved.preview3d === true };
  } catch { return { quality: "auto", preview3d: false }; }
}

export default function App({ currentUser, onLogout, hudActive = true, onSceneReady, hudCycle = 0, startupCountry = null }) {
  const [mode, setMode] = useState("live");
  const [liveTrackedIds, setLiveTrackedIds] = useState(DEFAULT_MAJOR_OBJECTS);
  const [timeTrackedIds, setTimeTrackedIds] = useState(TIME_DEFAULT_OBJECTS);
  const [liveShownOrbitIds, setLiveShownOrbitIds] = useState(new Set(DEFAULT_MAJOR_OBJECTS));
  const [timeShownOrbitIds, setTimeShownOrbitIds] = useState(new Set(TIME_DEFAULT_OBJECTS));
  const [selectedId, setSelectedId] = useState(null);
  const [layers, setLayers] = useState([]);
  const [searchCycle, setSearchCycle] = useState(0);
  const [selectedCelestialBody, setSelectedCelestialBody] = useState("earth");
  const [sceneScale, setSceneScale] = useState({ visible: false, value: 0, range: 0, stage: "close" });
  const [celestialMarker, setCelestialMarker] = useState(null);
  const [travel, setTravel] = useState(null);
  const [travelError, setTravelError] = useState("");
  const [detailState, setDetailState] = useState("ready");
  const [limitMessage, setLimitMessage] = useState("");
  const [telemetry, setTelemetry] = useState(null);
  const [telemetryError, setTelemetryError] = useState(false);
  const [apiState, setApiState] = useState("checking");
  const [feedAge, setFeedAge] = useState(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const [selectedTime, setSelectedTime] = useState(new Date());
  const [mapStyle, setMapStyle] = useState(import.meta.env.VITE_CESIUM_ION_TOKEN ? "google" : "esri");
  const [mapStatus, setMapStatus] = useState(null);
  const [labelsEnabled, setLabelsEnabled] = useState(true);
  const [sceneMode, setSceneMode] = useState("3d");
  const [cameraFollowing, setCameraFollowing] = useState(false);
  const [disasterLayers, setDisasterLayers] = useState(["wildfires", "severeStorms"]);
  const [catalogObjects, setCatalogObjects] = useState(SPACE_OBJECTS);
  const [viewTelemetry, setViewTelemetry] = useState({});
  const [settings, setSettings] = useState(readSettings);
  const [presentation, setPresentation] = useState(false);
  const globeRef = useRef(null);
  const shellRef = useRef(null);
  const refreshTimerRef = useRef(null);
  const refreshLockRef = useRef(false);
  const travelLockRef = useRef(false);
  const layerTriggersRef = useRef(new Map());
  const focusFrameRef = useRef(null);
  const refreshDeadlineRef = useRef(null);
  const activeTrackedIds = mode === "time" ? timeTrackedIds : liveTrackedIds;
  const setActiveTrackedIds = mode === "time" ? setTimeTrackedIds : setLiveTrackedIds;
  const shownOrbitIds = mode === "time" ? timeShownOrbitIds : liveShownOrbitIds;
  const setShownOrbitIds = mode === "time" ? setTimeShownOrbitIds : setLiveShownOrbitIds;
  const selectedObject = catalogObjects.find((item) => item.noradId === selectedId) || null;
  const selectedRendered = Boolean(selectedId && activeTrackedIds.includes(selectedId));
  const atEarth = selectedCelestialBody === "earth";
  const navigation = navigationVisibility(mode, atEarth);
  const menu = layers.find((item) => ["map", "camera", "system"].includes(item) && navigation[item]);
  const allOrbitsVisible = activeTrackedIds.length > 0 && activeTrackedIds.every((id) => shownOrbitIds.has(id));

  const closeLayer = useCallback((name) => {
    setLayers((current) => current.filter((item) => item !== name));
    cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = requestAnimationFrame(() => {
      const trigger = layerTriggersRef.current.get(name);
      if (trigger?.isConnected) trigger.focus();
      else if (name === "explorer") document.querySelector(".explorer-trigger")?.focus();
      else if (name === "place") document.querySelector(".place-search > button")?.focus();
    });
  }, []);
  const openLayer = useCallback((name) => {
    const available = navigationVisibility(mode, atEarth);
    if (Object.hasOwn(available, name) && !available[name]) return;
    layerTriggersRef.current.set(name, document.activeElement);
    setLayers((current) => {
      const sceneMenu = ["map", "camera", "system"].includes(name);
      const rightPanel = ["map", "camera", "system", "inspector", "body", "celestial", "profile"];
      const narrow = window.innerWidth < 1100;
      return [...current.filter((item) => item !== name &&
        !(name === "profile" && rightPanel.includes(item)) &&
        !(rightPanel.includes(name) && item === "place") &&
        !(name === "place" && rightPanel.includes(item)) &&
        !(window.innerWidth < 1280 && ((name === "place" && item === "explorer") || (name === "explorer" && item === "place"))) &&
        !(rightPanel.includes(name) && item === "profile") &&
        !(sceneMenu && ["map", "camera", "system", "inspector", "body", "celestial"].includes(item)) &&
        !(["inspector", "body", "celestial"].includes(name) && ["map", "camera", "system", "body", "celestial", "inspector"].includes(item)) &&
        !(narrow && name === "explorer" && rightPanel.includes(item)) &&
        !(narrow && name !== "explorer" && item === "explorer")), name];
    });
  }, [mode, atEarth]);
  useEffect(() => {
    globeRef.current?.selectCelestialMarker(layers.includes("celestial") ? celestialMarker : null);
  }, [layers, celestialMarker]);
  const toggleLayer = (name) => layers.includes(name) ? closeLayer(name) : openLayer(name);
  const releaseCamera = useCallback(() => { globeRef.current?.releaseCamera(); setCameraFollowing(false); }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchSatelliteCatalog(controller.signal).then((data) => {
      if (!controller.signal.aborted && Array.isArray(data?.objects) && data.objects.length) setCatalogObjects(data.objects);
    }).catch(() => { /* The complete bundled catalog stays available. */ });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer;
    async function update() {
      try {
        const data = await fetchSatelliteDataStatus(controller.signal);
        if (controller.signal.aborted) return;
        setApiState(data.stale || data.missing_supported_objects ? "stale" : "online");
        setFeedAge(data.age_seconds);
      } catch {
        if (!controller.signal.aborted) setApiState("offline");
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(update, 60000);
      }
    }
    update();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [refreshNonce]);

  useEffect(() => {
    if (!selectedId || mode === "disaster") return undefined;
    const controller = new AbortController();
    let timer;
    async function update() {
      try {
        const data = await fetchSatellitePosition(selectedId, controller.signal);
        if (!controller.signal.aborted) { setTelemetry(data); setTelemetryError(false); }
      } catch {
        if (!controller.signal.aborted) setTelemetryError(true);
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(update, 15000);
      }
    }
    update();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [selectedId, mode, refreshNonce]);

  useEffect(() => {
    if (mode !== "live") return undefined;
    const timer = window.setInterval(() => { if (!refreshLockRef.current) setRefreshNonce((value) => value + 1); }, 60000);
    return () => window.clearInterval(timer);
  }, [mode]);
  useEffect(() => () => { window.clearTimeout(refreshTimerRef.current); window.clearTimeout(refreshDeadlineRef.current); cancelAnimationFrame(focusFrameRef.current); }, []);

  function loadObjects(ids) {
    const next = [...new Set([...activeTrackedIds, ...ids])];
    if (mode === "time" && next.length > TIME_OBJECT_LIMIT) { setLimitMessage(`Time Explorer can display up to ${TIME_OBJECT_LIMIT} objects.`); return; }
    setActiveTrackedIds(next);
    setShownOrbitIds((current) => new Set([...current, ...ids]));
    setLimitMessage("");
  }
  function unloadObjects(ids) {
    setActiveTrackedIds((current) => current.filter((id) => !ids.includes(id)));
    setShownOrbitIds((current) => new Set([...current].filter((id) => !ids.includes(id))));
    if (ids.includes(selectedId)) releaseCamera();
  }
  const selectObject = useCallback((id) => {
    if (travelLockRef.current) return;
    releaseCamera();
    setSelectedId(id);
    if (id !== selectedId) {
      setTelemetry(null);
      setTelemetryError(false);
    }
    if (id) openLayer("inspector"); else closeLayer("inspector");
  }, [openLayer, closeLayer, releaseCamera, selectedId]);
  function focusSelected() { if (globeRef.current?.focusSelected()) setCameraFollowing(false); }
  function followSelected() { setCameraFollowing(Boolean(globeRef.current?.followSelected())); }
  function toggleSelectedOrbit() {
    if (!selectedRendered) return;
    setShownOrbitIds((current) => { const next = new Set(current); if (next.has(selectedId)) next.delete(selectedId); else next.add(selectedId); return next; });
  }
  function refresh() {
    if (refreshLockRef.current || refreshBusy) return;
    refreshLockRef.current = true;
    setCooldown(true);
    setRefreshBusy(true);
    refreshDeadlineRef.current = window.setTimeout(() => setRefreshBusy(false), 10500);
    setRefreshNonce((value) => value + 1);
    refreshTimerRef.current = window.setTimeout(() => { refreshLockRef.current = false; setCooldown(false); }, 20000);
  }
  function changeSettings(next) {
    setSettings(next);
    try { localStorage.setItem("orbitwatch_settings", JSON.stringify(next)); } catch { /* Settings still work for this session. */ }
  }
  function changeMode(next) {
    if (travelLockRef.current || !navigation.modeRail) return;
    releaseCamera();
    setLayers([]);
    setSelectedCelestialBody("earth");
    setMode(next);
    setLimitMessage("");
    setSelectedTime(new Date());
    if (next === "time") { setTimeTrackedIds(TIME_DEFAULT_OBJECTS); setTimeShownOrbitIds(new Set(TIME_DEFAULT_OBJECTS)); }
    if (next === "disaster") setSceneMode("3d");
  }
  async function selectCelestialBody(id, reframe = false) {
    if (travelLockRef.current || !navigation.system) return false;
    if (id === selectedCelestialBody && !reframe) { closeLayer("system"); closeLayer("celestial"); return true; }
    travelLockRef.current = true;
    setTravelError("");
    releaseCamera();
    setLayers([]);
    setTravel({ from: selectedCelestialBody, to: id });
    try {
      const result = await globeRef.current?.focusCelestial(id);
      if (result?.handled && !result.cancelled) { setSelectedCelestialBody(id); setDetailState(result.degraded ? "degraded" : "ready"); return true; }
      if (result?.error) { setDetailState(result.degraded ? "degraded" : "ready"); setTravelError("Travel could not finish. Your previous view has been restored. Choose a destination in System to retry."); }
      return false;
    } catch (error) {
      console.warn("OrbitWatch: destination unavailable", error);
      setTravelError("Destination unavailable. Choose a destination in System to retry.");
      return false;
    } finally { setTravel(null); travelLockRef.current = false; }
  }

  useEffect(() => {
    const resolvePanels = () => {
      if (window.innerWidth < 1280) setLayers((current) => {
        if (window.innerWidth < 1100 && current.length > 1) return [current[current.length - 1]];
        if (current.includes("place") && current.includes("explorer")) return current.filter((item) => item !== (current.indexOf("place") < current.indexOf("explorer") ? "place" : "explorer"));
        return current;
      });
    };
    window.addEventListener("resize", resolvePanels);
    return () => window.removeEventListener("resize", resolvePanels);
  }, []);

  // Reserve the actual bottom dock, including wrapped facts and disclosures.
  // One shared clearance keeps every floating panel above its changing height.
  useEffect(() => {
    const shell = shellRef.current;
    const dock = shell?.querySelector(".live-dock, .time-dock, .disaster-dock");
    if (!shell || !dock) return undefined;
    const measure = () => shell.style.setProperty("--hud-dock-height", `${dock.offsetHeight}px`);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(dock);
    window.addEventListener("resize", measure);
    measure();
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); shell.style.removeProperty("--hud-dock-height"); };
  }, [mode]);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (travelLockRef.current || !hudActive) return;
      const key = event.key.toLowerCase();
      if (key === "escape") {
        if (presentation) setPresentation(false);
        else if (layers.length) closeLayer(layers[layers.length - 1]);
        else if (cameraFollowing) releaseCamera();
        return;
      }
      // Escape still dismisses the active panel while its search field is focused.
      // Local dialogs can consume Escape before it reaches this window handler.
      if (event.target instanceof HTMLElement && (event.target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']"))) return;
      if (key === "p") setPresentation((value) => !value);
      else if (presentation) return;
      else if (key === "/" && navigation.explorer) { event.preventDefault(); openLayer("explorer"); setSearchCycle((value) => value + 1); }
      else if (key === "m" && navigation.map) toggleLayer("map");
      else if (key === "c" && navigation.camera) toggleLayer("camera");
      else if (key === "s" && navigation.system) toggleLayer("system");
      else if (key === "f" && selectedRendered && navigation.explorer) followSelected();
      else if (key === "o" && navigation.explorer) toggleSelectedOrbit();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const hidden = presentation || Boolean(travel) || !hudActive;
  return (
    <main ref={shellRef} className={`orbitwatch-shell mode-${mode} ${atEarth ? "at-earth" : "off-earth"} ${layers.includes("place") ? "has-place-search" : ""} ${travel ? "is-travelling" : ""}`}>
      <SceneBoundary onReady={onSceneReady} onReset={() => { setSelectedCelestialBody("earth"); setDetailState("ready"); setCameraFollowing(false); setTravel(null); travelLockRef.current = false; setLayers([]); }}><OrbitGlobe trackedIds={mode === "disaster" ? [] : activeTrackedIds} selectedId={selectedId} selectedTime={selectedTime} mode={mode} startupCountry={startupCountry} selectedCelestialBody={selectedCelestialBody} onCelestialSelect={(id, wide) => { if (travelLockRef.current || mode !== "live") return; if (!wide && id === selectedCelestialBody && id !== "earth") openLayer("body"); else { setCelestialMarker(id); openLayer("celestial"); } }} refreshNonce={refreshNonce} mapStyle={mapStyle} labelsEnabled={labelsEnabled} sceneMode={sceneMode} shownOrbitIds={shownOrbitIds} disasterLayers={disasterLayers} onObjectSelect={selectObject} onScaleChange={setSceneScale} onViewTelemetry={setViewTelemetry} globeRef={globeRef} onSceneReady={onSceneReady} onRefreshComplete={() => setRefreshBusy(false)} onMapStatus={setMapStatus} onDetailReady={(id) => { if (id === selectedCelestialBody) setDetailState("ready"); }} quality={settings.quality} /></SceneBoundary>
      <div className="space-vignette" aria-hidden="true" />
      <div className={`live-interface ${hidden ? "is-hidden" : ""}`} inert={hidden}>
        <CinematicStage cycle={hudCycle} active={hudActive} side="top" loaderAnchor="top" zIndex={30}><TopHud mode={mode} bodyId={selectedCelestialBody} apiState={apiState} currentUser={currentUser} onProfileToggle={() => toggleLayer("profile")} /></CinematicStage>
        {navigation.modeRail && <CinematicStage cycle={hudCycle} active={hudActive} side="left" loaderAnchor="left-rail" zIndex={31}><ModeRail mode={mode} onChange={changeMode} /></CinematicStage>}
        {navigation.explorer && !layers.includes("explorer") && <CinematicStage cycle={hudCycle} active={hudActive} side="left" loaderAnchor="left-upper" zIndex={32}><SpatialSurface as="button" type="button" side="left" className="explorer-trigger" onClick={() => openLayer("explorer")} title="Object search (/)" aria-label="Open object explorer"><Aperture size={18} /><span>OBJECTS</span><b>{catalogObjects.length}</b></SpatialSurface></CinematicStage>}
        {(navigation.map || navigation.camera || navigation.system) && <CinematicStage cycle={hudCycle} active={hudActive} side="right" loaderAnchor="right-upper" zIndex={31}><SceneDock controls={navigation} mapOpen={menu === "map"} cameraOpen={menu === "camera"} systemOpen={menu === "system"} onToggleMap={() => toggleLayer("map")} onToggleCamera={() => toggleLayer("camera")} onToggleSystem={() => toggleLayer("system")} /></CinematicStage>}
        {atEarth && <PlaceSearch open={layers.includes("place")} onOpen={() => openLayer("place")} onClose={() => closeLayer("place")} onVisit={(destination) => { releaseCamera(); globeRef.current?.flyToPlace(destination); }} globeRef={globeRef} />}
        <ProfilePanel open={layers.includes("profile")} user={currentUser} onClose={() => closeLayer("profile")} onLogout={onLogout} settings={settings} onSettingsChange={changeSettings} />
        <CameraMenu open={menu === "camera"} hasSelected={selectedRendered} onPreset={(preset) => { globeRef.current?.setCameraPreset(preset); setCameraFollowing(false); closeLayer("camera"); }} onClose={() => closeLayer("camera")} />
        <AnimatePresence>{layers.includes("celestial") && mode === "live" && <CelestialTravelCard key="CelestialTravelCard" bodyId={celestialMarker} destinationId={selectedCelestialBody} onClose={() => closeLayer("celestial")} onTravel={(id) => selectCelestialBody(id, true)} onInspect={() => { closeLayer("celestial"); if (!atEarth) openLayer("body"); }} />}</AnimatePresence>
        <SystemMenu open={menu === "system"} activeBodyId={selectedCelestialBody} onSelectBody={selectCelestialBody} onClose={() => closeLayer("system")} />
        <MapSettings open={menu === "map"} mapStyle={mapStyle} onMapStyleChange={setMapStyle} labelsEnabled={labelsEnabled} onLabelsChange={setLabelsEnabled} onClose={() => closeLayer("map")} mapStatus={mapStatus} />
        {mode === "live" && <SystemScaleSlider scale={sceneScale} onChange={(value) => globeRef.current?.setCelestialScale(value)} />}
        {travelError && <div className="scene-notice" role="alert"><span>{travelError}</span><button type="button" onClick={() => setTravelError("")}>Dismiss</button></div>}
        <ObjectExplorer open={layers.includes("explorer") && atEarth && mode !== "disaster"} onClose={() => closeLayer("explorer")} objects={catalogObjects} trackedIds={activeTrackedIds} selectedId={selectedId} onSelect={selectObject} onLoad={loadObjects} onUnload={unloadObjects} limitMessage={limitMessage} userId={currentUser?.id} searchCycle={searchCycle} />
        <AnimatePresence>{layers.includes("inspector") && atEarth && mode !== "disaster" && <InspectorPanel key={`${selectedId}:${settings.preview3d}`} object={selectedObject} telemetry={telemetry?.norad_id === selectedId ? telemetry : null} telemetryError={telemetryError} cameraFollowing={cameraFollowing} rendered={selectedRendered} orbitVisible={shownOrbitIds.has(selectedId)} onClose={() => closeLayer("inspector")} onFocus={focusSelected} onFollow={followSelected} onReleaseCamera={releaseCamera} onToggleOrbit={toggleSelectedOrbit} preview3d={settings.preview3d} />}</AnimatePresence>
        <AnimatePresence>{layers.includes("body") && !atEarth && <CelestialInspector key="CelestialInspector" bodyId={selectedCelestialBody} sceneTime={mode === "time" ? selectedTime : null} onClose={() => closeLayer("body")} detailState={detailState} />}</AnimatePresence>
        {mode === "time" && <TimeDock selectedTime={selectedTime} onTimeChange={setSelectedTime} onReturnLive={() => setSelectedTime(new Date())} trackedCount={timeTrackedIds.length} maxTracked={TIME_OBJECT_LIMIT} />}
        {mode === "disaster" && <DisasterDock activeLayers={disasterLayers} onLayersChange={setDisasterLayers} sceneMode={sceneMode} onSceneModeChange={setSceneMode} />}
        <button type="button" className="presentation-toggle" title="Presentation mode (P)" onClick={() => setPresentation(true)}><Maximize2 size={15} /> CLEAN VIEW</button>
        {atEarth && mode === "live" && <button type="button" className={`manual-refresh ${cooldown || refreshBusy ? "is-cooling" : ""}`} disabled={cooldown || refreshBusy} onClick={refresh} title="Refresh satellite positions · 20 second cooldown" aria-label="Refresh satellite positions" aria-busy={refreshBusy}><RefreshCcw size={20} /><span>{refreshBusy ? "SYNCING" : cooldown ? "COOLDOWN" : "SYNC"}</span></button>}
      </div>
      {mode === "live" && !presentation && <CinematicStage cycle={hudCycle} active={hudActive} side="bottom" loaderAnchor="bottom" zIndex={32}><LiveDock bodyId={selectedCelestialBody} travel={travel} detailState={detailState} selectedObject={selectedObject} viewTelemetry={viewTelemetry} trackedCount={activeTrackedIds.length} allOrbitsVisible={allOrbitsVisible} onToggleAllOrbits={() => setShownOrbitIds(allOrbitsVisible ? new Set() : new Set(activeTrackedIds))} feedAge={feedAge} onOpenBody={() => openLayer("body")} /></CinematicStage>}
      {travel && <span className="travel-mark">ORBITWATCH</span>}
      {presentation && <button type="button" className="restore-interface" onClick={() => setPresentation(false)}>RESTORE INTERFACE · P / ESC</button>}
    </main>
  );
}
