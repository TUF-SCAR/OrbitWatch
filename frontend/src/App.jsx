import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Aperture } from "lucide-react";
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
import { fetchSatellitePosition } from "./services/orbitwatchApi.js";
import { getSpaceObject, SPACE_OBJECTS } from "./data/spaceObjects.js";

const DEFAULT_MAJOR_OBJECTS = [25544, 20580, 48274, 39084];
const TIME_OBJECT_LIMIT = 15;

function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export default function App() {
  const [mode, setMode] = useState("live");
  const [liveTrackedIds, setLiveTrackedIds] = useState(DEFAULT_MAJOR_OBJECTS);
  const [timeTrackedIds, setTimeTrackedIds] = useState(DEFAULT_MAJOR_OBJECTS);
  const [liveShownOrbitIds, setLiveShownOrbitIds] = useState(() => new Set(DEFAULT_MAJOR_OBJECTS));
  const [timeShownOrbitIds, setTimeShownOrbitIds] = useState(() => new Set(DEFAULT_MAJOR_OBJECTS));
  const [selectedId, setSelectedId] = useState(25544);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [mapSettingsOpen, setMapSettingsOpen] = useState(false);
  const [cameraMenuOpen, setCameraMenuOpen] = useState(false);
  const [limitMessage, setLimitMessage] = useState("");
  const [telemetry, setTelemetry] = useState(null);
  const [telemetryError, setTelemetryError] = useState(false);
  const [apiState, setApiState] = useState("checking");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [selectedTime, setSelectedTime] = useState(new Date());
  const [mapStyle, setMapStyle] = useState("google");
  const [labelsEnabled, setLabelsEnabled] = useState(true);
  const [sceneMode, setSceneMode] = useState("3d");
  const [cameraFollowing, setCameraFollowing] = useState(false);
  const [disasterLayers, setDisasterLayers] = useState(["wildfires", "severeStorms"]);
  const [viewTelemetry, setViewTelemetry] = useState({ cameraAltitudeKm: null, cursorLatitude: null, cursorLongitude: null });
  const globeRef = useRef(null);

  const activeTrackedIds = mode === "time" ? timeTrackedIds : mode === "live" ? liveTrackedIds : [];
  const setActiveTrackedIds = mode === "time" ? setTimeTrackedIds : setLiveTrackedIds;
  const shownOrbitIds = mode === "time" ? timeShownOrbitIds : liveShownOrbitIds;
  const setShownOrbitIds = mode === "time" ? setTimeShownOrbitIds : setLiveShownOrbitIds;
  const selectedObject = useMemo(() => getSpaceObject(selectedId), [selectedId]);
  const selectedRendered = Boolean(selectedId && activeTrackedIds.includes(selectedId));
  const selectedOrbitVisible = Boolean(selectedId && shownOrbitIds.has(selectedId));

  const closeFloatingPanels = useCallback(() => {
    setExplorerOpen(false);
    setMapSettingsOpen(false);
    setCameraMenuOpen(false);
  }, []);

  const releaseCamera = useCallback(() => {
    globeRef.current?.releaseCamera();
    setCameraFollowing(false);
  }, []);

  const addObjectToActiveMode = useCallback((noradId) => {
    if (mode === "disaster") return false;
    const current = mode === "time" ? timeTrackedIds : liveTrackedIds;
    if (current.includes(noradId)) return true;
    if (mode === "time" && current.length >= TIME_OBJECT_LIMIT) {
      setLimitMessage(`Time Explorer can display up to ${TIME_OBJECT_LIMIT} objects at once.`);
      return false;
    }
    setActiveTrackedIds((ids) => [...ids, noradId]);
    setShownOrbitIds((ids) => new Set(ids).add(noradId));
    setLimitMessage("");
    return true;
  }, [mode, timeTrackedIds, liveTrackedIds, setActiveTrackedIds, setShownOrbitIds]);

  const handleObjectSelect = useCallback((noradId) => {
    const added = addObjectToActiveMode(noradId);
    if (!added) return;
    releaseCamera();
    setSelectedId(noradId);
    closeFloatingPanels();
  }, [addObjectToActiveMode, releaseCamera, closeFloatingPanels]);

  const toggleTracked = useCallback((noradId) => {
    const current = mode === "time" ? timeTrackedIds : liveTrackedIds;
    if (current.includes(noradId)) {
      setActiveTrackedIds((ids) => ids.filter((id) => id !== noradId));
      setShownOrbitIds((ids) => {
        const next = new Set(ids);
        next.delete(noradId);
        return next;
      });
      if (selectedId === noradId) releaseCamera();
      setLimitMessage("");
      return;
    }
    addObjectToActiveMode(noradId);
  }, [mode, timeTrackedIds, liveTrackedIds, setActiveTrackedIds, setShownOrbitIds, selectedId, releaseCamera, addObjectToActiveMode]);

  useEffect(() => {
    if (!selectedId || mode === "disaster") {
      setTelemetry(null);
      setTelemetryError(false);
      return undefined;
    }

    const controller = new AbortController();
    let intervalId;
    async function update() {
      try {
        const data = await fetchSatellitePosition(selectedId, controller.signal);
        setTelemetry(data);
        setTelemetryError(false);
        setApiState("online");
      } catch (error) {
        if (error?.name !== "AbortError") {
          setTelemetryError(true);
          setApiState("offline");
        }
      }
    }

    setApiState("checking");
    update();
    intervalId = window.setInterval(update, 15000);
    return () => {
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [selectedId, mode]);

  useEffect(() => {
    if (mode !== "live") return undefined;
    const intervalId = window.setInterval(() => setRefreshNonce((value) => value + 1), 60000);
    return () => window.clearInterval(intervalId);
  }, [mode]);

  const changeMode = useCallback((nextMode) => {
    releaseCamera();
    closeFloatingPanels();
    setMode(nextMode);
    setLimitMessage("");

    if (nextMode === "live") {
      setSelectedTime(new Date());
      if (!liveTrackedIds.includes(selectedId)) setSelectedId(liveTrackedIds[0] ?? 25544);
    } else if (nextMode === "time") {
      // Time Explorer always starts from a safe, known set rather than carrying
      // a potentially huge Live selection into the heavier historical mode.
      setTimeTrackedIds(DEFAULT_MAJOR_OBJECTS);
      setTimeShownOrbitIds(new Set(DEFAULT_MAJOR_OBJECTS));
      setSelectedId(25544);
      setSelectedTime(new Date());
    } else {
      setSceneMode("3d");
    }
  }, [releaseCamera, closeFloatingPanels, liveTrackedIds, selectedId]);

  useEffect(() => {
    function onKeyDown(event) {
      if (isTypingTarget(event.target)) {
        if (event.key === "Escape") event.target.blur?.();
        return;
      }
      if (event.key === "/" && mode !== "disaster" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setMapSettingsOpen(false);
        setCameraMenuOpen(false);
        setExplorerOpen(true);
        return;
      }
      if (event.key === "Escape") {
        closeFloatingPanels();
        releaseCamera();
        return;
      }
      if (event.key.toLowerCase() === "l") changeMode("live");
      if (event.key.toLowerCase() === "t") changeMode("time");
      if (event.key.toLowerCase() === "d") changeMode("disaster");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, changeMode, closeFloatingPanels, releaseCamera]);

  function focusSelected() {
    const started = globeRef.current?.focusSelected();
    if (started) setCameraFollowing(false);
  }

  function followSelected() {
    const started = globeRef.current?.followSelected();
    setCameraFollowing(Boolean(started));
  }

  function applyCameraPreset(preset) {
    if (preset === "selected") focusSelected();
    else {
      globeRef.current?.setCameraPreset(preset);
      setCameraFollowing(false);
    }
    setCameraMenuOpen(false);
  }

  function toggleSelectedOrbit() {
    if (!selectedId) return;
    setShownOrbitIds((ids) => {
      const next = new Set(ids);
      if (next.has(selectedId)) next.delete(selectedId);
      else next.add(selectedId);
      return next;
    });
  }

  function changeSceneMode(nextMode) {
    releaseCamera();
    setSceneMode(nextMode);
  }

  return (
    <main className={`orbitwatch-shell mode-${mode} ${explorerOpen ? "has-explorer" : ""} ${mapSettingsOpen ? "has-map-settings" : ""}`}>
      <OrbitGlobe
        trackedIds={activeTrackedIds}
        selectedId={selectedId}
        selectedTime={selectedTime}
        mode={mode}
        refreshNonce={refreshNonce}
        mapStyle={mapStyle}
        labelsEnabled={labelsEnabled}
        sceneMode={sceneMode}
        shownOrbitIds={shownOrbitIds}
        disasterLayers={disasterLayers}
        onObjectSelect={handleObjectSelect}
        onViewTelemetry={setViewTelemetry}
        globeRef={globeRef}
      />

      <div className="space-vignette" />
      <div className="coordinate-grid" />

      <TopHud mode={mode} apiState={apiState} />
      <ModeRail mode={mode} onChange={changeMode} />

      {mode !== "disaster" && !explorerOpen && !mapSettingsOpen && (
        <SpatialSurface as="button" side="left" strength={3.6} className="explorer-trigger" onClick={() => { setExplorerOpen(true); setMapSettingsOpen(false); setCameraMenuOpen(false); }} aria-label="Open object explorer">
          <Aperture size={18} /><span>OBJECTS</span><b>{SPACE_OBJECTS.length}</b>
        </SpatialSurface>
      )}

      <SceneDock
        mode={mode}
        mapOpen={mapSettingsOpen}
        onToggleMap={() => { setMapSettingsOpen((value) => !value); setExplorerOpen(false); setCameraMenuOpen(false); }}
        cameraOpen={cameraMenuOpen}
        onToggleCamera={() => { setCameraMenuOpen((value) => !value); setMapSettingsOpen(false); setExplorerOpen(false); }}
      />

      <CameraMenu
        open={cameraMenuOpen}
        hasSelected={selectedRendered}
        onPreset={applyCameraPreset}
        onClose={() => setCameraMenuOpen(false)}
      />

      <MapSettings
        open={mapSettingsOpen && mode !== "disaster"}
        mapStyle={mapStyle}
        onMapStyleChange={(nextMap) => { releaseCamera(); setMapStyle(nextMap); }}
        labelsEnabled={labelsEnabled}
        onLabelsChange={setLabelsEnabled}
        onClose={() => setMapSettingsOpen(false)}
      />

      {!explorerOpen && !mapSettingsOpen && !cameraMenuOpen && mode === "live" && (
        <LiveDock selectedObject={selectedObject} viewTelemetry={viewTelemetry} onRefresh={() => setRefreshNonce((value) => value + 1)} />
      )}

      {!explorerOpen && !mapSettingsOpen && !cameraMenuOpen && mode === "time" && (
        <TimeDock selectedTime={selectedTime} onTimeChange={setSelectedTime} onReturnLive={() => setSelectedTime(new Date())} trackedCount={timeTrackedIds.length} maxTracked={TIME_OBJECT_LIMIT} />
      )}

      {!explorerOpen && !mapSettingsOpen && !cameraMenuOpen && mode === "disaster" && (
        <DisasterDock activeLayers={disasterLayers} onLayersChange={setDisasterLayers} sceneMode={sceneMode} onSceneModeChange={changeSceneMode} />
      )}

      <ObjectExplorer
        open={explorerOpen && mode !== "disaster"}
        onClose={() => setExplorerOpen(false)}
        trackedIds={activeTrackedIds}
        selectedId={selectedId}
        onSelect={handleObjectSelect}
        onToggleTracked={toggleTracked}
        maxTracked={mode === "time" ? TIME_OBJECT_LIMIT : null}
        limitMessage={limitMessage}
      />

      {!explorerOpen && !mapSettingsOpen && !cameraMenuOpen && mode !== "disaster" && (
        <InspectorPanel
          object={selectedObject}
          telemetry={telemetry}
          telemetryError={telemetryError}
          cameraFollowing={cameraFollowing}
          rendered={selectedRendered}
          orbitVisible={selectedOrbitVisible}
          onClose={() => { releaseCamera(); setSelectedId(null); }}
          onFocus={focusSelected}
          onFollow={followSelected}
          onReleaseCamera={releaseCamera}
          onToggleOrbit={toggleSelectedOrbit}
        />
      )}
    </main>
  );
}
