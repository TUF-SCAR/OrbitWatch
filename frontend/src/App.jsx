import { LIVE_EARTH_DEFAULTS } from './data/liveEarthDefaults.js';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { Aperture, Maximize2, RefreshCcw } from "lucide-react";
import ModeRail from "./components/ModeRail.jsx";
import TopHud from "./components/TopHud.jsx";
import OrbitGlobe from "./components/OrbitGlobe.jsx";
import ObjectExplorer from "./components/ObjectExplorer.jsx";
import InspectorPanel from "./components/InspectorPanel.jsx";
import LiveDock from "./components/LiveDock.jsx";
import TimePreparation from "./components/TimePreparation.jsx";
import TimeDock from "./components/TimeDock.jsx";
import SceneDock from "./components/SceneDock.jsx";
import CameraMenu from "./components/CameraMenu.jsx";
import MapSettings from "./components/MapSettings.jsx";
import SpatialSurface from "./components/SpatialSurface.jsx";
import HudAssembly from "./components/HudAssembly.jsx";
import CinematicStage from "./components/CinematicStage.jsx";
import ProfilePanel from "./components/ProfilePanel.jsx";
import SystemMenu from "./components/SystemMenu.jsx";
import SystemScaleSlider from "./components/SystemScaleSlider.jsx";
import CelestialTravelCard from "./components/CelestialTravelCard.jsx";
import CelestialInspector from "./components/CelestialInspector.jsx";
import PlaceSearch from "./components/PlaceSearch.jsx";
import WeatherPanel, { TemperatureLegend } from './components/WeatherPanel.jsx';
import { useObservedClouds } from './services/useObservedClouds.js';
import { ObservedCloudLegend } from './components/ObservedClouds.jsx';
import { useLiveWeather } from './utils/useLiveWeather.js';
import { selectWeatherField } from './services/weatherFields.js';
import { useNaturalEvents } from './utils/useNaturalEvents.js';
import SceneBoundary from "./components/SceneBoundary.jsx";
import { fetchSatelliteCatalog, fetchSatelliteDataStatus, fetchSatellitePosition } from "./services/orbitwatchApi.js";
import { SPACE_OBJECTS } from "./data/spaceObjects.js";
import { navigationVisibility, PRODUCT_MODES, celestialDestinationAllowed } from "./utils/navigationVisibility.js";

const DEFAULT_MAJOR_OBJECTS = [25544, 20580, 48274, 39084, 58990, 26407];
const TIME_DEFAULT_OBJECTS = [25544, 20580, 48274, 39084];
const TIME_OBJECT_LIMIT = 15;

function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("orbitwatch_settings") || "{}");
    if(Object.hasOwn(saved,"orbitStyle")) {
      delete saved.orbitStyle;
      try {localStorage.setItem("orbitwatch_settings",JSON.stringify(saved));} catch { /* Read-only storage still uses the single trajectory renderer. */ }
    }
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
  const [feedSnapshot, setFeedSnapshot] = useState(null);
  const [feedClock, setFeedClock] = useState(Date.now);
  const feedAge = Number.isFinite(feedSnapshot?.age) ? feedSnapshot.age + Math.max(0, (feedClock - feedSnapshot.receivedAt) / 1000) : null;
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const [selectedTime, setSelectedTime] = useState(new Date());
  const [requestedTime,setRequestedTime] = useState(selectedTime);
  const [timeBusy,setTimeBusy] = useState(false);
  const [timeIssue,setTimeIssue] = useState("");
  const [mapStyle, setMapStyle] = useState(LIVE_EARTH_DEFAULTS.mapStyle);
  const [mapStatus, setMapStatus] = useState(null);
  const [mapRetryNonce, setMapRetryNonce] = useState(0);
  const [satelliteStatus, setSatelliteStatus] = useState("");
  const [orbitInfo, setOrbitInfo] = useState({});
  const [labelsEnabled, setLabelsEnabled] = useState(true);
  const [cameraFollowing, setCameraFollowing] = useState(false);
  const [catalogObjects, setCatalogObjects] = useState(SPACE_OBJECTS);
  const [viewTelemetry, setViewTelemetry] = useState({});
  const [weatherEnabled,setWeatherEnabled]=useState(LIVE_EARTH_DEFAULTS.weatherEnabled),[weatherOpacity,setWeatherOpacity]=useState(.55);
  const [weatherVariable,setWeatherVariable]=useState(LIVE_EARTH_DEFAULTS.weatherField);
  const [weatherTab,setWeatherTab]=useState('layers'),[eventsEnabled,setEventsEnabled]=useState(false);
  const [eventCategory,setEventCategory]=useState('all'),[selectedEventId,setSelectedEventId]=useState(null);
  const [weatherRefresh,setWeatherRefresh]=useState(0),[weatherCooling,setWeatherCooling]=useState(false);
  const weatherCooldown=useRef(null),weatherDeadline=useRef(0);
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
  const selectedRendered = mode === "live" && Boolean(selectedId && activeTrackedIds.includes(selectedId));
  const atEarth = selectedCelestialBody === "earth";
  const weatherActive=mode==='live'&&atEarth&&!travel&&hudActive;
  const weatherCompatible=mapStyle!=='google'&&mapStatus?.activeMap!=='google'&&Boolean(mapStatus?.activeMap);
  const observedClouds=useObservedClouds(weatherActive&&weatherEnabled&&weatherCompatible&&weatherVariable==='observedClouds',settings.quality);
  const cloudFallback=weatherVariable==='observedClouds'&&!observedClouds.frame&&observedClouds.status==='unavailable';
  const weather=useLiveWeather(weatherActive&&(weatherVariable!=='observedClouds'||cloudFallback)&&(weatherEnabled||layers.includes('weather')),weatherRefresh);
  const naturalEvents=useNaturalEvents(weatherActive&&(eventsEnabled||(weatherTab==='events'&&layers.includes('weather'))));
  const selectedWeatherField=useMemo(()=>selectWeatherField(weather.field,cloudFallback?'clouds':weatherVariable),[weather.field,weatherVariable,cloudFallback]);
  useEffect(()=>()=>window.clearTimeout(weatherCooldown.current),[]);
  function refreshWeather() {
    if(Date.now()<weatherDeadline.current)return;
    weatherDeadline.current=Date.now()+30000;setWeatherCooling(true);setWeatherRefresh(value=>value+1);
    window.clearTimeout(weatherCooldown.current);weatherCooldown.current=window.setTimeout(()=>setWeatherCooling(false),30000);
  }
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
    if(name==='weather'&&(mode!=='live'||!atEarth))return;
    const available = navigationVisibility(mode, atEarth);
    if (Object.hasOwn(available, name) && !available[name]) return;
    layerTriggersRef.current.set(name, document.activeElement);
    setLayers((current) => {
      const sceneMenu = ["map", "camera", "system", "weather"].includes(name);
      const rightPanel = ["map", "camera", "system", "weather", "inspector", "body", "celestial", "profile"];
      const narrow = window.innerWidth < 1100;
      return [...current.filter((item) => item !== name &&
        !(name === "profile" && rightPanel.includes(item)) &&
        !(rightPanel.includes(name) && item === "place") &&
        !(name === "place" && rightPanel.includes(item)) &&
        !(window.innerWidth < 1280 && ((name === "place" && item === "explorer") || (name === "explorer" && item === "place"))) &&
        !(rightPanel.includes(name) && item === "profile") &&
        !(sceneMenu && ["map", "camera", "system", "weather", "inspector", "body", "celestial"].includes(item)) &&
        !(["inspector", "body", "celestial"].includes(name) && ["map", "camera", "system", "weather", "body", "celestial", "inspector"].includes(item)) &&
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
    const timer = window.setInterval(() => setFeedClock(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer;
    async function update() {
      try {
        const data = await fetchSatelliteDataStatus(controller.signal);
        if (controller.signal.aborted) return;
        setApiState(data.stale || data.missing_supported_objects || !Number.isFinite(data.age_seconds) ? "stale" : "online");
        const receivedAt = Date.now(); setFeedClock(receivedAt);
        setFeedSnapshot({ age: data.age_seconds, receivedAt });
      } catch (error) {
        if (!controller.signal.aborted) setApiState(error.kind === "offline" ? "offline" : "unavailable");
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(update, 60000);
      }
    }
    update();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [refreshNonce]);

  useEffect(() => {
    if (!selectedId || mode !== "live") return undefined;
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
  function queueSceneTime(next) {
    setRequestedTime(next);
    setTimeIssue("");setSelectedTime(next);
  }
  function timePrepared(result) {
    if(result.timestamp===selectedTime.getTime() && requestedTime.getTime()===selectedTime.getTime()) {
      setTimeBusy(false);setTimeIssue(result.error || "");
    }
  }

  async function changeMode(next) {
    if (travelLockRef.current || (!navigation.modeRail && !(mode === "time" && next === "live")) || !PRODUCT_MODES.includes(next)) return;
    if (!atEarth && !await selectCelestialBody("earth")) return;
    releaseCamera();
    setLayers([]);
    setSelectedCelestialBody("earth");
    if(next === "time") {setTimeBusy(true);setTimeIssue("");setSelectedTime(requestedTime);}
    else setTimeBusy(false);
    setMode(next);
    setLimitMessage("");
  }
  async function selectCelestialBody(id, reframe = false) {
    if (travelLockRef.current || !navigation.system || !celestialDestinationAllowed(mode,id)) return false;
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
    const dock = shell?.querySelector(".live-dock, .time-dock");
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
      if (shellRef.current?.closest(".hud-assembly")?.dataset.hudState !== "ready") return;
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
      else if (key === "w" && mode==='live'&&atEarth) toggleLayer('weather');
      else if (key === "f" && selectedRendered && navigation.explorer) followSelected();
      else if (key === "o" && navigation.explorer) toggleSelectedOrbit();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const hidden = presentation || Boolean(travel) || !hudActive;
  return (
    <HudAssembly active={hudActive} cycle={hudCycle}><main ref={shellRef} className={`orbitwatch-shell mode-${mode} ${atEarth ? "at-earth" : "off-earth"} ${layers.includes("place") ? "has-place-search" : ""} ${travel ? "is-travelling" : ""}`}>
      <SceneBoundary onReady={onSceneReady} onReset={() => { setSelectedCelestialBody("earth"); setDetailState("ready"); setCameraFollowing(false); setTravel(null); travelLockRef.current = false; setLayers([]); }}><OrbitGlobe trackedIds={activeTrackedIds} selectedId={selectedId} selectedTime={selectedTime} mode={mode} startupCountry={startupCountry} selectedCelestialBody={selectedCelestialBody} onCelestialSelect={(id, wide) => { if (travelLockRef.current || !celestialDestinationAllowed(mode,id)) return; if (!wide && id === selectedCelestialBody && id !== "earth") openLayer("body"); else { setCelestialMarker(id); openLayer("celestial"); } }} refreshNonce={refreshNonce} mapStyle={mapStyle} mapRetryNonce={mapRetryNonce} labelsEnabled={labelsEnabled} shownOrbitIds={shownOrbitIds} onObjectSelect={selectObject} onScaleChange={setSceneScale} onViewTelemetry={setViewTelemetry} globeRef={globeRef} onSceneReady={onSceneReady} onRefreshComplete={() => setRefreshBusy(false)} onSatelliteStatus={setSatelliteStatus} onMapStatus={setMapStatus} onTimeReady={timePrepared} onDetailReady={(id) => { if (id === selectedCelestialBody) setDetailState("ready"); }} naturalEvents={naturalEvents.events} eventsVisible={eventsEnabled&&weatherActive} eventCategory={eventCategory} selectedEventId={selectedEventId} onEventSelect={id=>{setSelectedEventId(id);setWeatherTab('events');openLayer('weather');}} cloudService={observedClouds.service} cloudPlaying={observedClouds.playing} cloudReady={observedClouds.status==='ready'} onCloudError={observedClouds.reportError} cloudFrame={weatherVariable==='observedClouds'?observedClouds.frame:null} weatherField={selectedWeatherField} weatherVisible={weatherEnabled&&weatherActive} weatherOpacity={weatherOpacity} weatherCompatible={weatherCompatible} quality={settings.quality} onOrbitInfo={setOrbitInfo} /></SceneBoundary>
      <div className="space-vignette" aria-hidden="true" />
      <div className={`live-interface ${hidden ? "is-hidden" : ""}`} inert={hidden || timeBusy}>
        <CinematicStage active={hudActive} side="top" loaderAnchor="top" zIndex={30}><TopHud sceneTime={selectedTime} mode={mode} bodyId={selectedCelestialBody} apiState={apiState} currentUser={currentUser} onProfileToggle={() => toggleLayer("profile")} /></CinematicStage>
        {navigation.modeRail && <CinematicStage active={hudActive} side="left" loaderAnchor="left-rail" zIndex={31}><ModeRail mode={mode} onChange={changeMode} /></CinematicStage>}
        {navigation.explorer && !layers.includes("explorer") && <CinematicStage active={hudActive} side="left" loaderAnchor="left-upper" zIndex={32}><SpatialSurface as="button" type="button" side="left" className="explorer-trigger" onClick={() => openLayer("explorer")} title="Object search (/)" aria-label="Open object explorer"><Aperture size={18} /><span>OBJECTS</span><b>{catalogObjects.length}</b></SpatialSurface></CinematicStage>}
        {(navigation.map || navigation.camera || navigation.system) && <CinematicStage active={hudActive} side="right" loaderAnchor="right-upper" zIndex={31}><SceneDock controls={navigation} mapOpen={menu === "map"} cameraOpen={menu === "camera"} systemOpen={menu === "system"} onToggleMap={() => toggleLayer("map")} onToggleCamera={() => toggleLayer("camera")} onToggleSystem={() => toggleLayer("system")} weatherAvailable={mode==="live"&&atEarth} weatherOpen={layers.includes("weather")} onToggleWeather={()=>toggleLayer("weather")} /></CinematicStage>}
        {atEarth && <CinematicStage active={hudActive} loaderAnchor="place" zIndex={36}><PlaceSearch open={layers.includes("place")} onOpen={() => openLayer("place")} onClose={() => closeLayer("place")} onVisit={(destination) => { releaseCamera(); globeRef.current?.flyToPlace(destination); }} globeRef={globeRef} /></CinematicStage>}
        <ProfilePanel open={layers.includes("profile")} user={currentUser} onClose={() => closeLayer("profile")} onLogout={onLogout} settings={settings} onSettingsChange={changeSettings} />
        <CameraMenu open={menu === "camera"} hasSelected={selectedRendered} onPreset={(preset) => { globeRef.current?.setCameraPreset(preset); setCameraFollowing(false); closeLayer("camera"); }} onClose={() => closeLayer("camera")} />
        <AnimatePresence>{layers.includes("celestial") && <CelestialTravelCard key="CelestialTravelCard" bodyId={celestialMarker} destinationId={selectedCelestialBody} onClose={() => closeLayer("celestial")} onTravel={(id) => selectCelestialBody(id, true)} onInspect={() => { closeLayer("celestial"); if (!atEarth) openLayer("body"); }} />}</AnimatePresence>
        <SystemMenu mode={mode} open={menu === "system"} activeBodyId={selectedCelestialBody} onSelectBody={(id)=>selectCelestialBody(id,mode === "time")} onClose={() => closeLayer("system")} />
        <MapSettings open={menu === "map"} mapStyle={mapStyle} onMapStyleChange={(id)=>{setMapStyle(id);setMapRetryNonce(value=>value+1);}} labelsEnabled={labelsEnabled} onLabelsChange={setLabelsEnabled} onClose={() => closeLayer("map")} mapStatus={mapStatus} />
        <WeatherPanel cameraAltitudeKm={viewTelemetry.cameraAltitudeKm} cloudFallback={cloudFallback} observedClouds={observedClouds} tab={weatherTab} onTab={setWeatherTab} events={naturalEvents} eventsEnabled={eventsEnabled} onEventsEnabled={setEventsEnabled} eventCategory={eventCategory} onEventCategory={value=>{setEventCategory(value);setSelectedEventId(null);}} selectedEventId={selectedEventId} onEventSelect={setSelectedEventId} open={weatherActive&&layers.includes('weather')} onClose={()=>closeLayer('weather')} weather={{...weather,field:selectedWeatherField,bundle:weather.field}} variable={weatherVariable} onVariable={setWeatherVariable} enabled={weatherEnabled} onEnabled={setWeatherEnabled} opacity={weatherOpacity} onOpacity={setWeatherOpacity} compatible={weatherCompatible} onCompatibleMap={()=>{setMapStyle('esri');setMapRetryNonce(v=>v+1);}} onRefresh={refreshWeather} refreshCooling={weatherCooling} onViewCenter={()=>globeRef.current?.weatherViewCenter()}/>
        {weatherActive&&weatherEnabled&&weatherCompatible&&weatherVariable==='observedClouds'&&!cloudFallback&&!hidden&&!layers.includes('weather')&&!layers.includes('explorer')&&<ObservedCloudLegend clouds={observedClouds}/>}
        {weatherActive&&weatherEnabled&&weatherCompatible&&selectedWeatherField&&!hidden&&!layers.includes('weather')&&!layers.includes('explorer')&&<TemperatureLegend field={selectedWeatherField} state={weather.state}/>}
        {<SystemScaleSlider scale={sceneScale} onChange={(value) => globeRef.current?.setCelestialScale(value)} />}
        {travelError && <div className="scene-notice" role="alert"><span>{travelError}</span><button type="button" onClick={() => setTravelError("")}>Dismiss</button></div>}
        {atEarth && mode === "live" && !travel && satelliteStatus && <div className="scene-notice" role="status">{satelliteStatus}</div>}
        <ObjectExplorer open={layers.includes("explorer") && atEarth} onClose={() => closeLayer("explorer")} objects={catalogObjects} trackedIds={activeTrackedIds} selectedId={selectedId} onSelect={selectObject} onLoad={loadObjects} onUnload={unloadObjects} limitMessage={limitMessage} userId={currentUser?.id} searchCycle={searchCycle} coverageUnavailable={mode === "time"} />
        <AnimatePresence>{layers.includes("inspector") && atEarth && <InspectorPanel key={`${selectedId}:${settings.preview3d}`} object={selectedObject} telemetry={mode === "live" && telemetry?.norad_id === selectedId ? telemetry : null} telemetryError={mode === "live" && telemetryError} cameraFollowing={cameraFollowing} rendered={selectedRendered} orbitVisible={shownOrbitIds.has(selectedId)} onClose={() => closeLayer("inspector")} onFocus={focusSelected} onFollow={followSelected} onReleaseCamera={releaseCamera} onToggleOrbit={toggleSelectedOrbit} preview3d={settings.preview3d} orbitDescription={orbitInfo.selectedDescription} orbitMetadata={orbitInfo.selectedMetadata} coverageUnavailable={mode === "time"} />}</AnimatePresence>
        <AnimatePresence>{layers.includes("body") && !atEarth && <CelestialInspector key="CelestialInspector" bodyId={selectedCelestialBody} sceneTime={mode === "time" ? selectedTime : null} onClose={() => closeLayer("body")} detailState={detailState} />}</AnimatePresence>
        {mode === "time" && <TimeDock selectedTime={requestedTime} onTimeChange={queueSceneTime} onReturnLive={() => changeMode("live")} trackedCount={timeTrackedIds.length} maxTracked={TIME_OBJECT_LIMIT} imageryStatus={atEarth ? mapStatus : null} preparationIssue={timeIssue} onRetryImagery={()=>{setTimeBusy(true);setMapRetryNonce(v=>v+1);}} />}
        <CinematicStage active={hudActive} loaderAnchor="clean" zIndex={42}><button type="button" className="presentation-toggle" title="Presentation mode (P)" onClick={() => setPresentation(true)}><Maximize2 size={15} /> CLEAN VIEW</button></CinematicStage>
        {atEarth && mode === "live" && <CinematicStage active={hudActive} loaderAnchor="refresh" zIndex={42}><button type="button" className={`manual-refresh ${cooldown || refreshBusy ? "is-cooling" : ""}`} disabled={cooldown || refreshBusy} onClick={refresh} title="Refresh satellite positions · 20 second cooldown" aria-label="Refresh satellite positions" aria-busy={refreshBusy}><RefreshCcw size={20} /><span>{refreshBusy ? "SYNCING" : cooldown ? "COOLDOWN" : "SYNC"}</span></button></CinematicStage>}
      </div>
      {mode === "live" && !presentation && <CinematicStage active={hudActive} side="bottom" loaderAnchor="bottom" zIndex={32}><LiveDock bodyId={selectedCelestialBody} travel={travel} detailState={detailState} selectedObject={selectedObject} viewTelemetry={viewTelemetry} trackedCount={activeTrackedIds.length} allOrbitsVisible={allOrbitsVisible} onToggleAllOrbits={() => setShownOrbitIds(allOrbitsVisible ? new Set() : new Set(activeTrackedIds))} feedAge={feedAge} onOpenBody={() => openLayer("body")} /></CinematicStage>}
      <AnimatePresence>{mode === "time" && timeBusy && <TimePreparation key="time-preparation" time={requestedTime} onTimeChange={queueSceneTime} />}</AnimatePresence>
      {travel && <span className="travel-mark">ORBITWATCH</span>}
      {presentation && <button type="button" className="restore-interface" onClick={() => setPresentation(false)}>RESTORE INTERFACE · P / ESC</button>}
    </main></HudAssembly>
  );
}
