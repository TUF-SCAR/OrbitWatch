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
import CinematicStage from "./components/CinematicStage.jsx";
import ProfilePanel from "./components/ProfilePanel.jsx";
import { fetchSatelliteCatalog, fetchSatellitePosition } from "./services/orbitwatchApi.js";
import { getSpaceObject, SPACE_OBJECTS } from "./data/spaceObjects.js";

const DEFAULT_MAJOR_OBJECTS = [25544, 20580, 48274, 39084];
const TIME_OBJECT_LIMIT = 15;

function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export default function App({ currentUser, onLogout, hudActive = true, onSceneReady, hudCycle = 0, startupCountry = null }) {
  const [mode, setMode] = useState("live");
  const [liveTrackedIds, setLiveTrackedIds] = useState(DEFAULT_MAJOR_OBJECTS);
  const [timeTrackedIds, setTimeTrackedIds] = useState(DEFAULT_MAJOR_OBJECTS);
  const [liveShownOrbitIds, setLiveShownOrbitIds] = useState(() => new Set(DEFAULT_MAJOR_OBJECTS));
  const [timeShownOrbitIds, setTimeShownOrbitIds] = useState(() => new Set(DEFAULT_MAJOR_OBJECTS));
  const [selectedId, setSelectedId] = useState(25544);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [mapSettingsOpen, setMapSettingsOpen] = useState(false);
  const [cameraMenuOpen, setCameraMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
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
  const [catalogObjects, setCatalogObjects] = useState(SPACE_OBJECTS);
  const [viewTelemetry, setViewTelemetry] = useState({ cameraAltitudeKm: null, cursorLatitude: null, cursorLongitude: null });
  const globeRef = useRef(null);
  const sceneReadyReportedRef = useRef(false);

  const activeTrackedIds = mode === "time" ? timeTrackedIds : mode === "live" ? liveTrackedIds : [];
  const setActiveTrackedIds = mode === "time" ? setTimeTrackedIds : setLiveTrackedIds;
  const shownOrbitIds = mode === "time" ? timeShownOrbitIds : liveShownOrbitIds;
  const setShownOrbitIds = mode === "time" ? setTimeShownOrbitIds : setLiveShownOrbitIds;
  const selectedObject = useMemo(
    () => catalogObjects.find((item) => item.noradId === selectedId) ?? getSpaceObject(selectedId),
    [catalogObjects, selectedId],
  );
  const selectedRendered = Boolean(selectedId && activeTrackedIds.includes(selectedId));
  const selectedOrbitVisible = Boolean(selectedId && shownOrbitIds.has(selectedId));

  useEffect(() => {
    const controller = new AbortController();

    async function loadCatalog() {
      try {
        const data = await fetchSatelliteCatalog(controller.signal);
        if (!Array.isArray(data?.objects) || !data.objects.length) return;
        setCatalogObjects(data.objects);
        setApiState("online");
      } catch (error) {
        if (error?.name !== "AbortError") {
          console.warn("OrbitWatch: backend satellite catalog unavailable; using bundled catalog.", error);
        }
      }
    }

    loadCatalog();
    return () => controller.abort();
  }, []);

  const closeFloatingPanels = useCallback(() => {
    setExplorerOpen(false);
    setMapSettingsOpen(false);
    setCameraMenuOpen(false);
    setProfileOpen(false);
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

  const addObjectsToActiveMode = useCallback((noradIds) => {
    if (mode === "disaster") return false;

    const current = mode === "time" ? timeTrackedIds : liveTrackedIds;
    const requested = [...new Set(
      noradIds
        .map((id) => Number(id))
        .filter(Number.isFinite),
    )];
    const newIds = requested.filter((id) => !current.includes(id));

    if (!newIds.length) {
      setLimitMessage("");
      return true;
    }

    if (mode === "time" && current.length + newIds.length > TIME_OBJECT_LIMIT) {
      const available = Math.max(0, TIME_OBJECT_LIMIT - current.length);
      setLimitMessage(
        `Time Explorer can add ${available} more object${available === 1 ? "" : "s"}.`,
      );
      return false;
    }

    setActiveTrackedIds((ids) => [
      ...ids,
      ...newIds.filter((id) => !ids.includes(id)),
    ]);
    setShownOrbitIds((ids) => {
      const next = new Set(ids);
      for (const id of newIds) next.add(id);
      return next;
    });
    setLimitMessage("");
    return true;
  }, [mode, timeTrackedIds, liveTrackedIds, setActiveTrackedIds]);

  const removeObjectsFromActiveMode = useCallback((noradIds) => {
    const removeIds = new Set(noradIds.map((id) => Number(id)));

    setActiveTrackedIds((ids) => ids.filter((id) => !removeIds.has(id)));
    setShownOrbitIds((ids) => {
      const next = new Set(ids);
      for (const id of removeIds) next.delete(id);
      return next;
    });

    if (selectedId && removeIds.has(selectedId)) releaseCamera();
    setLimitMessage("");
    return true;
  }, [setActiveTrackedIds, setShownOrbitIds, selectedId, releaseCamera]);

  const applyTrackedObjects = useCallback((noradIds) => {
    if (mode === "disaster") return false;

    const current = mode === "time" ? timeTrackedIds : liveTrackedIds;
    const nextIds = [...new Set(
      noradIds
        .map((id) => Number(id))
        .filter(Number.isFinite),
    )];

    if (mode === "time" && nextIds.length > TIME_OBJECT_LIMIT) {
      setLimitMessage(`Time Explorer can display up to ${TIME_OBJECT_LIMIT} objects at once.`);
      return false;
    }

    const nextIdSet = new Set(nextIds);
    const addedIds = nextIds.filter((id) => !current.includes(id));

    setActiveTrackedIds(nextIds);
    setShownOrbitIds((ids) => {
      const next = new Set([...ids].filter((id) => nextIdSet.has(id)));
      for (const id of addedIds) next.add(id);
      return next;
    });

    if (selectedId && !nextIdSet.has(selectedId)) releaseCamera();
    setLimitMessage("");
    return true;
  }, [mode, timeTrackedIds, liveTrackedIds, setActiveTrackedIds, setShownOrbitIds, selectedId, releaseCamera]);

  const allLoadedOrbitsVisible = Boolean(
    activeTrackedIds.length && activeTrackedIds.every((id) => shownOrbitIds.has(id)),
  );

  const toggleAllLoadedOrbits = useCallback(() => {
    setShownOrbitIds(
      allLoadedOrbitsVisible ? new Set() : new Set(activeTrackedIds),
    );
  }, [allLoadedOrbitsVisible, activeTrackedIds, setShownOrbitIds]);

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


  useEffect(() => {
    if (
      apiState !== "online" ||
      sceneReadyReportedRef.current
    ) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      sceneReadyReportedRef.current = true;
      onSceneReady?.();
    }, 2600);

    return () => window.clearTimeout(timeoutId);
  }, [apiState, onSceneReady]);

  return (
    <main className={`orbitwatch-shell mode-${mode} ${explorerOpen ? "has-explorer" : ""} ${mapSettingsOpen ? "has-map-settings" : ""}`}>
      <OrbitGlobe
        trackedIds={activeTrackedIds}
        selectedId={selectedId}
        selectedTime={selectedTime}
        mode={mode}
        startupCountry={startupCountry}
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
      {/* CINEMATIC HUD STAGES */}
      <CinematicStage cycle={hudCycle} active={hudActive} side="top" delay={0} loaderAnchor="top" zIndex={30}>
        <TopHud
        mode={mode}
        apiState={apiState}
        currentUser={currentUser}
        onProfileToggle={() => {
          setProfileOpen((value) => !value);
          setExplorerOpen(false);
          setMapSettingsOpen(false);
          setCameraMenuOpen(false);
        }}
      />
      </CinematicStage>
      <CinematicStage cycle={hudCycle} active={hudActive} side="left" delay={0.34} loaderAnchor="left-rail" zIndex={31}>
        <ModeRail mode={mode} onChange={changeMode} />
      </CinematicStage>

      <ProfilePanel
        open={profileOpen}
        user={currentUser}
        onClose={() => setProfileOpen(false)}
        onLogout={onLogout}
      />

      {mode !== "disaster" && !explorerOpen && !mapSettingsOpen && (
        <CinematicStage cycle={hudCycle} active={hudActive} side="left" delay={0.68} loaderAnchor="left-upper" zIndex={32}>
<SpatialSurface as="button" side="left" strength={3.6} className="explorer-trigger" onClick={() => { setExplorerOpen(true); setMapSettingsOpen(false); setCameraMenuOpen(false); }} aria-label="Open object explorer">
          <Aperture size={18} /><span>OBJECTS</span><b>{catalogObjects.length}</b>
        </SpatialSurface>
        </CinematicStage>
      )}

      <CinematicStage cycle={hudCycle} active={hudActive} side="right" delay={1.02} loaderAnchor="right-upper" zIndex={31}>
        <SceneDock
        mode={mode}
        mapOpen={mapSettingsOpen}
        onToggleMap={() => { setMapSettingsOpen((value) => !value); setExplorerOpen(false); setCameraMenuOpen(false); }}
        cameraOpen={cameraMenuOpen}
        onToggleCamera={() => { setCameraMenuOpen((value) => !value); setMapSettingsOpen(false); setExplorerOpen(false); }}
      />
      </CinematicStage>

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
        <CinematicStage cycle={hudCycle} active={hudActive} side="bottom" delay={1.36} loaderAnchor="bottom" zIndex={32}>
          <LiveDock
          selectedObject={selectedObject}
          viewTelemetry={viewTelemetry}
          trackedCount={liveTrackedIds.length}
          allOrbitsVisible={allLoadedOrbitsVisible}
          onToggleAllOrbits={toggleAllLoadedOrbits}
          onRefresh={() => setRefreshNonce((value) => value + 1)}
        />
        </CinematicStage>
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
        objects={catalogObjects}
        trackedIds={activeTrackedIds}
        selectedId={selectedId}
        onSelect={handleObjectSelect}
        onApplyTrackedIds={applyTrackedObjects}
        maxTracked={mode === "time" ? TIME_OBJECT_LIMIT : null}
        limitMessage={limitMessage}
      />

      {!explorerOpen && !mapSettingsOpen && !cameraMenuOpen && mode !== "disaster" && (
        <CinematicStage cycle={hudCycle} active={hudActive} side="right" delay={1.70} loaderAnchor="right" zIndex={33}>
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
        </CinematicStage>
      )}
    </main>
  );
}
