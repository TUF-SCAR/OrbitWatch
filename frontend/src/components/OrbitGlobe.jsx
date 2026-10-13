import { useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  ArcType,
  BoundingSphere,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  ClockStep,
  Color,
  DistanceDisplayCondition,
  HeightReference,
  HeadingPitchRange,
  Ion,
  IonGeocodeProviderType,
  IonGeocoderService,
  JulianDate,
  LabelStyle,
  Math as CesiumMath,
  Matrix3,
  Matrix4,
  NearFarScalar,
  Rectangle,
  SceneMode,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Simon1994PlanetaryPositions,
  DynamicAtmosphereLightingType,
  SkyBox,
  Terrain,
  Transforms,
  VelocityOrientationProperty,
  Viewer,
} from "cesium";
import { fetchSatelliteOrbit, fetchSatelliteTrajectories } from "../services/orbitwatchApi.js";
import { getSpaceObject } from "../data/spaceObjects.js";
import { createSolarSystemLayer, pickSolarSystemObject } from "../services/solarSystemLayer.js";
import { attachSatelliteOrbit, removeSatelliteOrbit, styleSatelliteOrbit, updateSatelliteOrbit, setSatelliteOrbitDisplay } from "../services/orbitVisuals.js";
import { createSatelliteOrbitState, createSatelliteTrack, satelliteOrbitRefreshDue, satelliteTrajectoryRefreshDue } from "../services/satelliteOrbitState.js";
import { orbitStyleDisclosure } from "../services/guidedOrbit.js";
import { createSatelliteRequestQueue } from "../services/satelliteRequestQueue.js";
import { StableOrbitCollection } from "../services/stableOrbitCollection.js";
import { createSpaceBackground } from "../services/spaceBackground.js";
import { populationQuality } from "../data/proceduralPopulations.js";
import { createSelectedSatelliteDetail } from "../services/selectedSatelliteDetail.js";
import { loadGoogleEarthTiles } from "../services/googleEarth.js";
import { createNasaImageryService } from "../services/nasaImagery.js";
import { createEarthMapFactories } from "../services/earthMapProviders.js";
import { applyBaseMap as updateBaseMap, providerErrorSummary, setEarthMapVisibility } from "../services/baseMap.js";
import { createPlaceLabelLayer } from "../services/placeLabelLayer.js";
import { createPlaceSearch } from "../services/placeSearch.js";
import { cameraDuration } from "../utils/motionPreferences.js";

const EARTH_RADIUS_KM = 6371.0088;
const EARTH_MU = 3.986004418e14;


const MIB = 1024 * 1024;

function detectOrbitWatchMemoryProfile() {
  const reportedGb =
    typeof navigator !== "undefined" && Number.isFinite(Number(navigator.deviceMemory))
      ? Number(navigator.deviceMemory)
      : 8;

  if (reportedGb <= 4) {
    return {
      name: "low",
      reportedGb,
      resolutionScale: 0.72,
      targetFrameRate: 30,
      googleCacheBytes: 96 * MIB,
      googleOverflowBytes: 24 * MIB,
      googleSse: 14,
      terrainTileCacheSize: 28,
      perFragmentAtmosphere: false,
      highDynamicRange: false,
      msaaSamples: 1,
      skipLevelOfDetail: true,
    };
  }

  if (reportedGb <= 8) {
    return {
      name: "balanced-low-memory",
      reportedGb,
      resolutionScale: 0.82,
      targetFrameRate: 30,
      googleCacheBytes: 128 * MIB,
      googleOverflowBytes: 32 * MIB,
      googleSse: 12,
      terrainTileCacheSize: 42,
      perFragmentAtmosphere: false,
      highDynamicRange: false,
      msaaSamples: 1,
      skipLevelOfDetail: true,
    };
  }

  return {
    name: "high",
    reportedGb,
    resolutionScale: 0.95,
    targetFrameRate: 45,
    googleCacheBytes: 192 * MIB,
    googleOverflowBytes: 48 * MIB,
    googleSse: 9,
    terrainTileCacheSize: 64,
    perFragmentAtmosphere: true,
    highDynamicRange: true,
    msaaSamples: 2,
    skipLevelOfDetail: false,
  };
}

const ORBITWATCH_MEMORY_PROFILE = detectOrbitWatchMemoryProfile();

const CATEGORY_COLORS = {
  Stations: Color.fromCssColorString("#8be8ff"),
  Observatories: Color.fromCssColorString("#c0adff"),
  "Earth Observation": Color.fromCssColorString("#78f0b6"),
  Weather: Color.fromCssColorString("#ffd278"),
  Navigation: Color.fromCssColorString("#8faaff"),
};



function saveWorldCameraPose(viewer) {
  const camera = viewer.camera;
  return {
    position: Cartesian3.clone(camera.positionWC),
    direction: Cartesian3.clone(camera.directionWC),
    up: Cartesian3.clone(camera.upWC),
  };
}

function restoreWorldCameraPose(viewer, pose) {
  if (!pose) return;
  viewer.camera.lookAtTransform(Matrix4.IDENTITY);
  viewer.camera.setView({
    destination: pose.position,
    orientation: { direction: pose.direction, up: pose.up },
  });
}

function releaseViewerCamera(viewer, followState) {
  if (!viewer || viewer.isDestroyed()) return;
  const pose = saveWorldCameraPose(viewer);
  followState.current = null;
  viewer.trackedEntity = undefined;
  viewer.camera.cancelFlight();
  restoreWorldCameraPose(viewer, pose);

  const controller = viewer.scene.screenSpaceCameraController;
  controller.enableRotate = true;
  controller.enableTranslate = true;
  controller.enableZoom = true;
  controller.enableTilt = true;
  controller.enableLook = true;
  controller.minimumZoomDistance = 1.0;
  controller.maximumZoomDistance = Number.POSITIVE_INFINITY;
}

function sunDirectionFixed(time) {
  const sunInertial = Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(time, new Cartesian3());
  const icrfToFixed = Transforms.computeIcrfToFixedMatrix(time, new Matrix3());
  const fixed = icrfToFixed ? Matrix3.multiplyByVector(icrfToFixed, sunInertial, new Cartesian3()) : sunInertial;
  return Cartesian3.normalize(fixed, fixed);
}

function setStartupRegionView(viewer, startupCountry) {
  if (!viewer || viewer.isDestroyed() || !startupCountry) return false;

  const west = Number(startupCountry.west);
  const south = Number(startupCountry.south);
  const east = Number(startupCountry.east);
  const north = Number(startupCountry.north);

  if (
    !Number.isFinite(west) ||
    !Number.isFinite(south) ||
    !Number.isFinite(east) ||
    !Number.isFinite(north)
  ) {
    return false;
  }

  viewer.trackedEntity = undefined;
  viewer.camera.cancelFlight();
  viewer.camera.lookAtTransform(Matrix4.IDENTITY);

  viewer.camera.setView({
    destination: Cartesian3.fromDegrees((west + east) / 2, (south + north) / 2, 27_000_000),
    orientation: { heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 },
  });

  viewer.scene.requestRender();
  return true;
}

function setCameraPreset(viewer, preset, followState, selectedEntity) {
  if (!viewer || viewer.isDestroyed()) return false;
  releaseViewerCamera(viewer, followState);

  if (preset === "selected") {
    const target = selectedEntity?.position?.getValue?.(viewer.clock.currentTime);
    if (!target) return false;
    viewer.camera.flyToBoundingSphere(new BoundingSphere(target, 1), { duration: cameraDuration(1.1), offset: new HeadingPitchRange(0, -0.34, 1_200_000) });
    return true;
  }

  if (viewer.scene.mode === SceneMode.SCENE2D) {
    if (preset === "north") {
      viewer.camera.flyTo({ destination: Rectangle.fromDegrees(-180, 5, 180, 90), duration: cameraDuration(0.55) });
      return true;
    }
    if (preset === "day" || preset === "night") {
      const dir = sunDirectionFixed(viewer.clock.currentTime);
      if (preset === "night") Cartesian3.negate(dir, dir);
      const cartographic = viewer.scene.globe.ellipsoid.cartesianToCartographic(Cartesian3.multiplyByScalar(dir, EARTH_RADIUS_KM * 1000, new Cartesian3()));
      viewer.camera.flyTo({ destination: Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 16_000_000), duration: cameraDuration(0.65) });
      return true;
    }
    viewer.camera.flyTo({ destination: Rectangle.fromDegrees(-180, -90, 180, 90), duration: cameraDuration(0.55) });
    return true;
  }

  if (preset === "north") {
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(0, 89.8, 20_500_000),
      orientation: { heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 },
      duration: cameraDuration(0.65),
    });
    return true;
  }

  if (preset === "day" || preset === "night") {
    const direction = sunDirectionFixed(viewer.clock.currentTime);
    if (preset === "night") Cartesian3.negate(direction, direction);
    const destination = Cartesian3.multiplyByScalar(direction, 22_500_000, new Cartesian3());
    const towardEarth = Cartesian3.negate(Cartesian3.normalize(destination, new Cartesian3()), new Cartesian3());
    const upCandidate = Math.abs(Cartesian3.dot(towardEarth, Cartesian3.UNIT_Z)) > 0.95 ? Cartesian3.UNIT_Y : Cartesian3.UNIT_Z;
    const right = Cartesian3.normalize(Cartesian3.cross(towardEarth, upCandidate, new Cartesian3()), new Cartesian3());
    const up = Cartesian3.normalize(Cartesian3.cross(right, towardEarth, new Cartesian3()), new Cartesian3());
    viewer.camera.flyTo({ destination, orientation: { direction: towardEarth, up }, duration: cameraDuration(0.75) });
    return true;
  }

  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(26, 18, 22_000_000),
    orientation: { heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 },
    duration: cameraDuration(0.65),
  });
  return true;
}

function estimateOrbitalPeriodSeconds(positions) {
  const altitudes = positions.map((item) => Number(item.altitude_km)).filter(Number.isFinite).sort((a, b) => a - b);
  const altitude = altitudes.length ? altitudes[Math.floor(altitudes.length / 2)] : 500;
  const semiMajor = (EARTH_RADIUS_KM + Math.max(100, altitude)) * 1000;
  const period = 2 * Math.PI * Math.sqrt((semiMajor ** 3) / EARTH_MU);
  return Math.min(90_000, Math.max(4_500, period));
}

function satelliteIconDataUri(colorCss, category) {
  const body = category === "Stations"
    ? '<rect x="13" y="10" width="6" height="12" rx="1"/><rect x="2" y="12" width="10" height="8" rx="1"/><rect x="20" y="12" width="10" height="8" rx="1"/><path d="M16 5v5M16 22v5"/>'
    : '<rect x="12" y="10" width="8" height="12" rx="2"/><path d="M4 11h7v10H4zM21 11h7v10h-7zM16 5v5M16 22v5"/>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><g fill="none" stroke="${colorCss}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">${body}</g><circle cx="16" cy="16" r="2.5" fill="${colorCss}"/></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}


function controllerIdle(viewer) { return viewer.scene.screenSpaceCameraController.enableInputs; }

function applyQuality(viewer, tileset, quality) {
  const choices = {
    performance: { resolutionScale: 0.65, targetFrameRate: 30, googleCacheBytes: 80 * MIB, googleOverflowBytes: 16 * MIB, googleSse: 18, terrainTileCacheSize: 24 },
    balanced: { resolutionScale: 0.82, targetFrameRate: 30, googleCacheBytes: 128 * MIB, googleOverflowBytes: 24 * MIB, googleSse: 12, terrainTileCacheSize: 40 },
    quality: { resolutionScale: 1, targetFrameRate: 45, googleCacheBytes: 192 * MIB, googleOverflowBytes: 48 * MIB, googleSse: 9, terrainTileCacheSize: 64 },
  };
  const profile = choices[quality] || ORBITWATCH_MEMORY_PROFILE;
  viewer.resolutionScale = profile.resolutionScale;
  viewer.targetFrameRate = profile.targetFrameRate;
  viewer.scene.globe.tileCacheSize = profile.terrainTileCacheSize;
  if (tileset) {
    tileset.cacheBytes = profile.googleCacheBytes;
    tileset.maximumCacheOverflowBytes = profile.googleOverflowBytes;
    tileset.maximumScreenSpaceError = profile.googleSse;
    tileset.trimLoadedTiles();
  }
  viewer.scene.requestRender();
}



export default function OrbitGlobe({
  trackedIds,
  selectedId,
  selectedTime,
  mode,
  refreshNonce,
  mapStyle,
  mapRetryNonce = 0,
  labelsEnabled,
  shownOrbitIds,
  onObjectSelect,
  onViewTelemetry,
  globeRef,
  startupCountry,
  selectedCelestialBody,
  onCelestialSelect,
  onScaleChange,
  onSceneReady,
  onRefreshComplete,
  onSatelliteStatus,
  onMapStatus,
  quality = "auto",
  orbitStyle = "guided",
  onOrbitInfo,
  onDetailReady,
}) {
  const mountRef = useRef(null);
  const viewerRef = useRef(null);
  const placeSearchRef = useRef(null);
  const startupCameraCommittedRef = useRef(false);
  const initialModeCameraResetRef = useRef(true);
  const initialCountryRef = useRef(startupCountry);
  const callbacksRef = useRef({ onSceneReady, onRefreshComplete, onMapStatus, onDetailReady, onScaleChange, onSatelliteStatus, onOrbitInfo });
  const mapFactoriesRef = useRef(null);
  const selectedTimeRef = useRef(selectedTime);
  const googleLoaderRef = useRef(null);
  const googleEventsRef = useRef([]);
  const googleRetryNonceRef = useRef(-1);
  const applyBaseMap = (viewer,tiles,ready,map,request,labels) => updateBaseMap(viewer,tiles,ready,modeRef.current === "time" ? "nasa-time" : map,request,labels,mapFactoriesRef.current,(status)=>callbacksRef.current.onMapStatus?.(status),8000,modeRef.current === "time" ? selectedTimeRef.current.getTime()>Date.now() ? "future-reference" : selectedTimeRef.current.toISOString().slice(0,10) : "");
  const earthActiveRef = useRef(true);
  const lastInteractionRef = useRef(0);
  const qualityRef = useRef(quality);
  const orbitStyleRef = useRef(orbitStyle);
  const backgroundQualityRef = useRef(null);
  const [entityRevision, setEntityRevision] = useState(0);
  const [automaticRefresh, setAutomaticRefresh] = useState(0);
  const trajectoryRetryRef = useRef(new Map());
  const trajectoryLoadingRef = useRef(null);
  const orbitRetryRef = useRef(new Map());
  const orbitQueueRef = useRef(null);
  const [sceneError, setSceneError] = useState(null);
  const googleTilesRef = useRef(null);
  const googleReadyRef = useRef(false);
  const entityMapRef = useRef(new Map());
  const followStateRef = useRef(null);
  const selectedIdRef = useRef(selectedId);
  const labelsEnabledRef = useRef(labelsEnabled);
  const hoveredIdRef = useRef(null);
  const lastRefreshRef = useRef(refreshNonce);
  const onObjectSelectRef = useRef(onObjectSelect);
  const onViewTelemetryRef = useRef(onViewTelemetry);
  const cursorGeoRef = useRef({ latitude: null, longitude: null });
  const lastViewTelemetryAtRef = useRef(0);
  const mapRequestRef = useRef(0);
  const mapStyleRef = useRef(mapStyle);
  const modeRef = useRef(mode);
  const shownOrbitIdsRef = useRef(shownOrbitIds);
  const solarSystemLayerRef = useRef(null);
  const satelliteModelDetailRef = useRef(null);
  const satelliteOrbitCollectionRef = useRef(null);
  const onCelestialSelectRef = useRef(onCelestialSelect);

  useEffect(() => {
  selectedIdRef.current = selectedId;
  labelsEnabledRef.current = labelsEnabled;
  onObjectSelectRef.current = onObjectSelect;
  onViewTelemetryRef.current = onViewTelemetry;
  mapStyleRef.current = mapStyle;
  modeRef.current = mode;
  selectedTimeRef.current = selectedTime;
  shownOrbitIdsRef.current = shownOrbitIds;
  onCelestialSelectRef.current = onCelestialSelect;
  callbacksRef.current = { onSceneReady, onRefreshComplete, onMapStatus, onDetailReady, onScaleChange, onSatelliteStatus, onOrbitInfo };
  qualityRef.current = quality;
  orbitStyleRef.current = orbitStyle;
  }, [selectedTime, selectedId, labelsEnabled, onObjectSelect, onViewTelemetry, mapStyle, mode, shownOrbitIds, onCelestialSelect, onSceneReady, onRefreshComplete, onMapStatus, onDetailReady, onScaleChange, onSatelliteStatus, quality, orbitStyle, onOrbitInfo]);

  useImperativeHandle(globeRef, () => ({
    focusSelected() {
      lastInteractionRef.current = performance.now();
      const viewer = viewerRef.current;
      const entity = entityMapRef.current.get(selectedIdRef.current)?.entity;
      if (!viewer || !entity) return false;
      return setCameraPreset(viewer, "selected", followStateRef, entity);
    },
    followSelected() {
      lastInteractionRef.current = performance.now();
      const viewer = viewerRef.current;
      const entity = entityMapRef.current.get(selectedIdRef.current)?.entity;
      if (!viewer || !entity || viewer.scene.mode === SceneMode.SCENE2D) return false;
      const target = entity.position?.getValue?.(viewer.clock.currentTime);
      if (!target) return false;
      releaseViewerCamera(viewer, followStateRef);
      const transform = Transforms.eastNorthUpToFixedFrame(target);
      viewer.camera.lookAtTransform(transform, new HeadingPitchRange(0.22, -0.28, 850_000));
      followStateRef.current = { noradId: selectedIdRef.current };
      const controller = viewer.scene.screenSpaceCameraController;
      controller.enableTranslate = false;
      controller.enableRotate = true;
      controller.enableZoom = true;
      controller.enableTilt = true;
      controller.enableLook = false;
      controller.minimumZoomDistance = 1.0;
      controller.maximumZoomDistance = Number.POSITIVE_INFINITY;
      return true;
    },
    releaseCamera() {
      releaseViewerCamera(viewerRef.current, followStateRef);
    },
    setCameraPreset(preset) {
      lastInteractionRef.current = performance.now();
      const entity = entityMapRef.current.get(selectedIdRef.current)?.entity;
      return setCameraPreset(viewerRef.current, preset, followStateRef, entity);
    },
    focusCelestial(bodyId) {
      lastInteractionRef.current = performance.now();
      const viewer = viewerRef.current;

      if (!viewer) {
        return false;
      }

      releaseViewerCamera(
        viewer,
        followStateRef,
      );

      return solarSystemLayerRef.current?.focus(bodyId || "earth");
    },
    setCelestialScale(value) {
      lastInteractionRef.current = performance.now();
      const changed = solarSystemLayerRef.current?.setScale(value);
      if (changed) viewerRef.current?.camera.cancelFlight();
      return changed;
    },
    selectCelestialMarker(id) { solarSystemLayerRef.current?.selectMarker(id); },
    async searchPlaces(query, signal) {
      const viewer = viewerRef.current;
      const token = import.meta.env.VITE_CESIUM_ION_TOKEN;
      if (!viewer || !token) throw new Error("Place search requires a Cesium ion token with Google geocoding enabled.");
      if (!placeSearchRef.current) {
        const geocoder = new IonGeocoderService({ scene: viewer.scene, accessToken: token, geocodeProviderType: IonGeocodeProviderType.GOOGLE });
        placeSearchRef.current = createPlaceSearch(geocoder, viewer.scene.frameState.creditDisplay, () => viewer.scene.requestRender());
      }
      return placeSearchRef.current.search(query, signal);
    },
    flyToPlace(destination) {
      const viewer = viewerRef.current;
      if (!viewer) return;
      releaseViewerCamera(viewer, followStateRef);
      lastInteractionRef.current = performance.now();
      viewer.camera.flyTo({ destination, duration: cameraDuration(1.7) });
    },
    followCelestial(bodyId) {
      const viewer = viewerRef.current;
      if (!viewer) return false;

      releaseViewerCamera(viewer, followStateRef);
      return Boolean(
        solarSystemLayerRef.current?.follow(bodyId),
      );
    },
  }), []);

  useEffect(() => {
    if (!mountRef.current) return undefined;

    const googleEvents=googleEventsRef.current;
    const token = import.meta.env.VITE_CESIUM_ION_TOKEN;
    mapFactoriesRef.current=createEarthMapFactories({ionToken:token,cartoKey:import.meta.env.VITE_CARTO_API_KEY,nasa:createNasaImageryService(),selectedTime:()=>selectedTimeRef.current});
    if (token) Ion.defaultAccessToken = token;

    const viewer = new Viewer(mountRef.current, {
      animation: false,
      timeline: false,
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      showRenderLoopErrors: false,
      terrain: token ? Terrain.fromWorldTerrain({ requestVertexNormals: false, requestWaterMask: false }) : undefined,
      requestRenderMode: true,
      maximumRenderTimeChange: 1 / 30,
      msaaSamples: ORBITWATCH_MEMORY_PROFILE.msaaSamples,
      shouldAnimate: true,
    });

    viewerRef.current = viewer;
    const orbitRequests = createSatelliteRequestQueue(4);
    orbitQueueRef.current = orbitRequests;
    satelliteOrbitCollectionRef.current = viewer.scene.primitives.add(new StableOrbitCollection());
    satelliteModelDetailRef.current = createSelectedSatelliteDetail(viewer, CATEGORY_COLORS);
    // Asset/geometry readiness must not pause live orbital time. Otherwise each
    // refresh can accumulate lag until fresh trajectory samples are out of range.
    viewer.allowDataSourcesToSuspendAnimation = false;
    const removeRenderError = viewer.scene.renderError.addEventListener((_scene, error) => setSceneError(error));
    viewer.resolutionScale = ORBITWATCH_MEMORY_PROFILE.resolutionScale;
    viewer.targetFrameRate = ORBITWATCH_MEMORY_PROFILE.targetFrameRate;
    viewer.scene.globe.tileCacheSize = ORBITWATCH_MEMORY_PROFILE.terrainTileCacheSize;
    viewer.scene.globe.showWaterEffect = false;
    viewer.scene.backgroundColor = Color.fromCssColorString("#01040a");
    viewer.scene.globe.baseColor = Color.fromCssColorString("#07101a");
    viewer.scene.globe.showGroundAtmosphere = true;
    viewer.scene.globe.enableLighting = true;
    viewer.scene.globe.dynamicAtmosphereLighting = true;
    viewer.scene.globe.dynamicAtmosphereLightingFromSun = true;
    viewer.scene.atmosphere.dynamicLighting = DynamicAtmosphereLightingType.SUNLIGHT;
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.skyAtmosphere.perFragmentAtmosphere = ORBITWATCH_MEMORY_PROFILE.perFragmentAtmosphere;
    viewer.scene.sun.show = false;
    viewer.scene.moon.show = false;
    viewer.scene.highDynamicRange = ORBITWATCH_MEMORY_PROFILE.highDynamicRange;
    viewer.scene.fog.enabled = true;
    viewer.scene.fog.density = 0.00008;
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 1.0;
    viewer.scene.screenSpaceCameraController.maximumZoomDistance = Number.POSITIVE_INFINITY;
    viewer.scene.screenSpaceCameraController.inertiaSpin = 0.82;
    viewer.scene.screenSpaceCameraController.inertiaTranslate = 0.78;
    viewer.scene.screenSpaceCameraController.inertiaZoom = 0.74;
    viewer.scene.screenSpaceCameraController.zoomFactor = 3.0;
    viewer.clock.shouldAnimate = true;

    const backgroundQuality = populationQuality(qualityRef.current, ORBITWATCH_MEMORY_PROFILE.reportedGb);
    const originalSky = viewer.scene.skyBox;
    try { viewer.scene.skyBox = createSpaceBackground(backgroundQuality); }
    catch { viewer.scene.skyBox = SkyBox.createEarthSkyBox(); }
    originalSky?.destroy();
    backgroundQualityRef.current = backgroundQuality;

    if (setStartupRegionView(viewer, initialCountryRef.current)) {
      startupCameraCommittedRef.current = true;
    } else {
      setCameraPreset(
        viewer,
        "earth",
        followStateRef,
        null,
      );
    }

    let destroyed = false;
    const entityMap = entityMapRef.current;
    lastInteractionRef.current = performance.now();
    let googleLoading = false;
    const removeReady = viewer.scene.postRender.addEventListener(() => { removeReady(); callbacksRef.current.onSceneReady?.(); });
    let idleState = "waiting", pointerHeld = false, lastIdleFrame = performance.now(), lastIdleInteraction = lastInteractionRef.current;
    const touchCamera = () => { lastInteractionRef.current = performance.now(); if (idleState === "framing") viewer.camera.cancelFlight(); idleState = "waiting"; };
    let pointerStart = null, cameraDragged = false;
    const pointerDown = (event) => { pointerHeld = true; pointerStart = { x: event.clientX, y: event.clientY }; cameraDragged = false; touchCamera(); };
    const pointerMove = (event) => { if (pointerHeld && pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) cameraDragged = true; };
    const pointerUp = () => { if (pointerHeld) { pointerHeld = false; touchCamera(); } };
    viewer.scene.canvas.addEventListener("pointerdown", pointerDown);
    viewer.scene.canvas.addEventListener("pointermove", pointerMove);
    window.addEventListener("pointerup", pointerUp);
    viewer.scene.canvas.addEventListener("wheel", touchCamera, { passive: true });
    viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    async function loadGoogleEarth() {
      if (googleLoading || destroyed || !earthActiveRef.current || modeRef.current !== "live" || mapStyleRef.current !== "google" || googleTilesRef.current || !token) return;
      googleLoading = true;
      try {
        const tileset = await loadGoogleEarthTiles({
            maximumScreenSpaceError: ORBITWATCH_MEMORY_PROFILE.googleSse,
            cacheBytes: ORBITWATCH_MEMORY_PROFILE.googleCacheBytes,
            maximumCacheOverflowBytes: ORBITWATCH_MEMORY_PROFILE.googleOverflowBytes,
            dynamicScreenSpaceError: true,
            dynamicScreenSpaceErrorFactor: 28.0,
            skipLevelOfDetail: ORBITWATCH_MEMORY_PROFILE.skipLevelOfDetail,
            baseScreenSpaceError: 1024,
            skipScreenSpaceErrorFactor: 16,
            skipLevels: 1,
            immediatelyLoadDesiredLevelOfDetail: false,
            loadSiblings: false,
            cullWithChildrenBounds: true,
            foveatedScreenSpaceError: true,
            foveatedTimeDelay: 0.25,
            preloadWhenHidden: false,
            preloadFlightDestinations: false,
            enableCollision: true,
          });
        if (destroyed || viewer.isDestroyed() || !earthActiveRef.current || modeRef.current!=="live" || mapStyleRef.current!=="google") { tileset.destroy(); return; }
        tileset.show = true;
        googleTilesRef.current = tileset;
        applyQuality(viewer, tileset, qualityRef.current);
        googleReadyRef.current = false;

        const activateGoogleWhenReady = () => {
          if (destroyed || viewer.isDestroyed() || googleTilesRef.current!==tileset || googleReadyRef.current) return;
          googleReadyRef.current = true;
          if (!earthActiveRef.current) return;

          applyBaseMap(
            viewer,
            tileset,
            true,
            mapStyleRef.current,
            mapRequestRef,
            labelsEnabledRef.current,
          );
        };
        // Register before adding the primitive so the initial-load signal can
        // never race past us on a fast connection/cache hit.
        googleEventsRef.current.push(tileset.initialTilesLoaded?.addEventListener?.(activateGoogleWhenReady));
        let reportedGoogleFailure=false;
        googleEventsRef.current.push(tileset.tileFailed?.addEventListener?.((failure) => {
          if(destroyed || viewer.isDestroyed() || googleTilesRef.current!==tileset || reportedGoogleFailure) return;
          reportedGoogleFailure=true;
          mapRequestRef.googleError=providerErrorSummary(failure);
          console.warn("OrbitWatch: Google tile unavailable:",mapRequestRef.googleError);
          if(mapStyleRef.current === "google" && modeRef.current === "live") {
            if(!googleReadyRef.current) applyBaseMap(viewer,tileset,false,"google",mapRequestRef,labelsEnabledRef.current);
            else callbacksRef.current.onMapStatus?.({requestedMap:"google",activeMap:"google",state:"unavailable",message:`Some Google tiles failed (${mapRequestRef.googleError}); cached Google imagery remains. Select Google to retry.`,providers:{...mapRequestRef.providers,google:"unavailable"}});
          }
        }));
        viewer.scene.primitives.add(tileset);

        // Do not drape Black Marble directly over Google 3D here. dayAlpha /
        // nightAlpha is a globe-lighting feature and can make the experimental
        // 3D-Tiles imagery path hide the underlying Google texture. Natural
        // Cesium sun/IBL lighting remains active on the photorealistic tiles.
        if (!earthActiveRef.current) { tileset.show = false; return; }
        await applyBaseMap(
          viewer,
          tileset,
          false,
          mapStyleRef.current,
          mapRequestRef,
          labelsEnabledRef.current,
        );
      } catch (error) {
        if (destroyed || !earthActiveRef.current) return;
        mapRequestRef.googleError=providerErrorSummary(error);
        console.warn("OrbitWatch: Google detail unavailable:",mapRequestRef.googleError);
        if (mapStyleRef.current === "google" && modeRef.current === "live") applyBaseMap(viewer,null,false,"google",mapRequestRef,labelsEnabledRef.current);
      } finally { googleLoading = false; }
    }
    googleLoaderRef.current=loadGoogleEarth;
    if(token) loadGoogleEarth();
    else mapRequestRef.googleError="Unconfigured Cesium ion token";

    const placeLabels = createPlaceLabelLayer(viewer);

    // LiveEarthWarmup on the auth screen does not pass onCelestialSelect.
    // Keep that hidden viewer Earth-only. The full solar system is created
    // only for the real authenticated OrbitWatch App.
    if (typeof onCelestialSelectRef.current === "function") {
      solarSystemLayerRef.current = createSolarSystemLayer(
        viewer,
        {
          isLive: () => true,
          onDetailReady: (id) => callbacksRef.current.onDetailReady?.(id),
          onScaleChange: (state) => callbacksRef.current.onScaleChange?.(state),
          getQuality: () => qualityRef.current,
          memoryGb: ORBITWATCH_MEMORY_PROFILE.reportedGb,
          setEarthRepresentation: (show) => {
            if (!earthActiveRef.current) return;
            const loadingGoogle=modeRef.current === "live" && mapStyleRef.current === "google" && !googleReadyRef.current;
            setEarthMapVisibility(viewer,googleTilesRef.current,show,mapRequestRef.activeMap,loadingGoogle);
          },
          hideEarthDetail: () => {
            earthActiveRef.current = false;
            mapRequestRef.current += 1;
            mapRequestRef.abort?.();
            mapRequestRef.removeError?.();
            mapRequestRef.removeError = null;
            const googleTiles =
              googleTilesRef.current;

            if (googleTiles) {
              googleEventsRef.current.splice(0).forEach(remove=>remove?.());
              viewer.scene.primitives.remove(googleTiles);
              googleTilesRef.current = null;
              googleReadyRef.current = false;
            }

            viewer.scene.globe.show = false;
            viewer.imageryLayers.removeAll(true);

            for (
              const data
              of entityMapRef.current.values()
            ) {
              data.entity.show = false;

              if (data.orbitEntity) {
                data.orbitEntity.show = false;
              }
            }

            satelliteModelDetailRef.current?.clear();
          },

          showEarthDetail: () => {
            earthActiveRef.current = true;
            viewer.scene.globe.show = true;

            const googleTiles =
              googleTilesRef.current;

            if (googleTiles) {
              googleTiles.show = true;
            } else if (token) loadGoogleEarth();

            for (
              const [noradId, data]
              of entityMapRef.current.entries()
            ) {
              data.entity.show = true;

              if (data.orbitEntity) {
                data.orbitEntity.show =
                  shownOrbitIdsRef.current.has(
                    noradId,
                  );
              }
            }

            satelliteModelDetailRef.current?.update(
              getSpaceObject(selectedIdRef.current),
              entityMapRef.current.get(selectedIdRef.current)?.entity,
              true,
            );

            applyBaseMap(
              viewer,
              googleTilesRef.current,
              googleReadyRef.current,
              mapStyleRef.current,
              mapRequestRef,
              labelsEnabledRef.current,
            );
          },
        },
      );
      solarSystemLayerRef.current?.setSelected(
        "earth",
      );
    }

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    const pickSceneObject = (position) => pickSolarSystemObject(viewer.scene, position, solarSystemLayerRef.current?.isWide());
    handler.setInputAction((movement) => {
      if (cameraDragged) return;
      const picked = pickSceneObject(movement.position);

      const celestialId =
        picked?.id?.properties?.celestialId?.getValue?.();

      if (celestialId) {
        const bodyId = String(celestialId);
        onCelestialSelectRef.current?.(bodyId, solarSystemLayerRef.current?.isWide());
        return;
      }

      const noradId =
        picked?.id?.properties?.noradId?.getValue?.();

      if (earthActiveRef.current) onObjectSelectRef.current?.(noradId ? Number(noradId) : null);
    }, ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction((movement) => {
      if (cameraDragged) return;
      const picked = pickSceneObject(movement.position);

      const celestialId =
        picked?.id?.properties?.celestialId?.getValue?.();

      if (!celestialId) return;

      const bodyId = String(celestialId);
      onCelestialSelectRef.current?.(bodyId, solarSystemLayerRef.current?.isWide());

      // Double click follows the real moving body in this same Cesium viewer.
      if (!solarSystemLayerRef.current?.isWide()) solarSystemLayerRef.current?.follow(bodyId);
    }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    handler.setInputAction((movement) => {
      const picked = viewer.scene.pick(movement.endPosition);
      const nextId = Number(picked?.id?.properties?.noradId?.getValue?.()) || null;
      if (nextId !== hoveredIdRef.current) {
        const previous = entityMapRef.current.get(hoveredIdRef.current)?.entity;
        if (previous?.label && hoveredIdRef.current !== selectedIdRef.current) previous.label.show = false;
        hoveredIdRef.current = nextId;
        const next = entityMapRef.current.get(nextId)?.entity;
        if (next?.label) next.label.show = true;
        viewer.scene.canvas.style.cursor = nextId ? "pointer" : "default";
      }

      let earthPoint;
      if (viewer.scene.pickPositionSupported) earthPoint = viewer.scene.pickPosition(movement.endPosition);
      if (!earthPoint) earthPoint = viewer.camera.pickEllipsoid(movement.endPosition, viewer.scene.globe.ellipsoid);
      if (earthPoint) {
        const cartographic = viewer.scene.globe.ellipsoid.cartesianToCartographic(earthPoint);
        cursorGeoRef.current = {
          latitude: CesiumMath.toDegrees(cartographic.latitude),
          longitude: CesiumMath.toDegrees(cartographic.longitude),
        };
      } else {
        cursorGeoRef.current = { latitude: null, longitude: null };
      }
    }, ScreenSpaceEventType.MOUSE_MOVE);

    let lastSatelliteStatus = "", lastOrbitInfo = "";
    // Before Primitive.update copies model matrices into this frame's commands.
    // preRender would leave orbit transforms one frame behind entity positions.
    const removeSatelliteUpdate = viewer.scene.preUpdate.addEventListener((_scene, time) => {
      let stale = 0, staleOrbits = 0, eccentric = 0;
      for (const data of entityMap.values()) {
        updateSatelliteOrbit(data, time);
        if (data.orbitGuide?.eccentric && data.orbitLine) eccentric++;
        const expired = data.track?.isStale(time) || false;
        if (expired) stale++;
        else if (data.orbitState?.stale) staleOrbits++;
        if (data.track && data.track.stale !== expired) {
          data.track.stale = expired;
          data.entity.label.text = `${data.entity.name}${expired ? " · position stale" : ""}`;
        }
      }
      const orbitInfo={ description:orbitStyleRef.current === "guided" ? `Guided Orbit · schematic circles · ${eccentric} eccentric path${eccentric === 1 ? "" : "s"} use real geometry` : "Scientific Orbit · real SGP4-sampled paths",
        selectedDescription:orbitStyleDisclosure(orbitStyleRef.current,entityMap.get(selectedIdRef.current)?.orbitGuide) };
      const infoKey=JSON.stringify(orbitInfo);
      if(infoKey!==lastOrbitInfo) {lastOrbitInfo=infoKey;callbacksRef.current.onOrbitInfo?.(orbitInfo);}
      const status = stale ? `${stale} satellite position${stale === 1 ? " is" : "s are"} stale. Showing the last valid samples; retrying automatically.`
        : staleOrbits ? `${staleOrbits} orbit${staleOrbits === 1 ? " is" : "s are"} awaiting updated propagation. Moving highlights resume when aligned.` : "";
      if (status !== lastSatelliteStatus) { lastSatelliteStatus = status; callbacksRef.current.onSatelliteStatus?.(status); }
    });
    const removePreRender = viewer.scene.preRender.addEventListener((_scene, time) => {
      const now = performance.now();
      const height = viewer.camera.positionCartographic.height;
      for (const [id, data] of entityMap) styleSatelliteOrbit(data, CATEGORY_COLORS[getSpaceObject(id)?.category] || Color.WHITE, id === selectedIdRef.current, shownOrbitIdsRef.current.size, height);
      placeLabels.update(now, labelsEnabledRef.current && earthActiveRef.current, mapRequestRef.activeMap);
      if (now - lastViewTelemetryAtRef.current > 500) {
        lastViewTelemetryAtRef.current = now;
        const cameraCartographic = viewer.scene.globe.ellipsoid.cartesianToCartographic(viewer.camera.positionWC);
        onViewTelemetryRef.current?.({
          cameraAltitudeKm: cameraCartographic ? Math.max(0, cameraCartographic.height / 1000) : null,
          cursorLatitude: cursorGeoRef.current.latitude,
          cursorLongitude: cursorGeoRef.current.longitude,
        });
      }

      const follow = followStateRef.current;
      if (lastIdleInteraction !== lastInteractionRef.current) { idleState = "waiting"; lastIdleInteraction = lastInteractionRef.current; }
      const idleEligible = !solarSystemLayerRef.current?.isSystemScale() && !follow && !pointerHeld && viewer.camera.positionCartographic.height > 100_000 && modeRef.current === "live" && earthActiveRef.current && controllerIdle(viewer) && now - lastInteractionRef.current > 30000 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (idleEligible) {
        if (idleState === "waiting") {
          idleState = "framing";
          const location = viewer.camera.positionCartographic;
          viewer.camera.flyTo({ destination: Cartesian3.fromRadians(location.longitude, location.latitude, 27_000_000), orientation: { heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 }, duration: 2, complete: () => { idleState = "rotating"; }, cancel: () => { idleState = "waiting"; } });
        } else if (idleState === "rotating") viewer.camera.rotate(Cartesian3.UNIT_Z, Math.min(100, now - lastIdleFrame) * 0.0000012);
      }
      lastIdleFrame = now;
      if (!follow) return;
      const data = entityMapRef.current.get(follow.noradId);
      const target = data?.entity?.position?.getValue?.(time);
      if (!target) return;
      const localOffset = Cartesian3.clone(viewer.camera.position);
      const direction = Cartesian3.clone(viewer.camera.direction), up = Cartesian3.clone(viewer.camera.up);
      const range = Math.max(1, Cartesian3.magnitude(localOffset));
      if (range < 1) Cartesian3.multiplyByScalar(Cartesian3.normalize(localOffset, localOffset), 1, localOffset);
      const transform = Transforms.eastNorthUpToFixedFrame(target);
      viewer.camera.lookAtTransform(transform, localOffset);
      Cartesian3.clone(direction, viewer.camera.direction);
      Cartesian3.clone(up, viewer.camera.up);
      Cartesian3.cross(direction, up, viewer.camera.right);
    });

    return () => {
      destroyed = true;
      mapRequestRef.current += 1;
      mapRequestRef.removeError?.();
      mapRequestRef.removeError = null;
      removeReady();
      removeRenderError();
      viewer.scene.canvas.removeEventListener("pointerdown", pointerDown);
      viewer.scene.canvas.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("pointerup", pointerUp);
      viewer.scene.canvas.removeEventListener("wheel", touchCamera);
      removePreRender();
      removeSatelliteUpdate();
      placeLabels.destroy();
      placeSearchRef.current?.destroy();
      placeSearchRef.current = null;
      handler.destroy();

      const solarLayer = solarSystemLayerRef.current;
      solarSystemLayerRef.current = null;
      solarLayer?.destroy();

      satelliteModelDetailRef.current?.clear();
      satelliteModelDetailRef.current = null;
      orbitRequests.destroy();
      orbitQueueRef.current = null;
      viewer.scene.primitives.remove(satelliteOrbitCollectionRef.current);
      satelliteOrbitCollectionRef.current = null;
      entityMap.clear();
      googleEvents.splice(0).forEach(remove=>remove?.());
      googleTilesRef.current = null;
      googleReadyRef.current = false;
      mapRequestRef.abort?.();
      googleLoaderRef.current=null;
      followStateRef.current = null;

      viewer.destroy();
      viewerRef.current = null;
      backgroundQualityRef.current = null;
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (viewer && !viewer.isDestroyed()) {
      applyQuality(viewer, googleTilesRef.current, quality);
      const backgroundQuality = populationQuality(quality, ORBITWATCH_MEMORY_PROFILE.reportedGb);
      if (backgroundQualityRef.current !== backgroundQuality) {
        try {
          const nextSky = createSpaceBackground(backgroundQuality), previousSky = viewer.scene.skyBox;
          viewer.scene.skyBox = nextSky; previousSky?.destroy();
          backgroundQualityRef.current = backgroundQuality;
        } catch { /* Preserve the existing background if the canvas is unavailable. */ }
      }
      viewer.scene.requestRender();
    }
  }, [quality]);

  useEffect(() => {
    solarSystemLayerRef.current?.setSelected(selectedCelestialBody);
  }, [selectedCelestialBody]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (mode === "time") {
      viewer.clock.currentTime = JulianDate.fromDate(selectedTime);
      viewer.clock.shouldAnimate = false;
      viewer.scene.maximumRenderTimeChange = Number.POSITIVE_INFINITY;
    } else {
      viewer.clock.currentTime = JulianDate.now();
      viewer.clock.shouldAnimate = mode === "live";
      if (mode === "live") viewer.clock.clockStep = ClockStep.SYSTEM_CLOCK;
      viewer.scene.maximumRenderTimeChange =
        mode === "live" ? 1 / ORBITWATCH_MEMORY_PROFILE.targetFrameRate : Number.POSITIVE_INFINITY;
    }
    viewer.scene.requestRender();
  }, [selectedTime, mode]);

  useEffect(() => {
    if (mode !== "live" || selectedCelestialBody !== "earth") return undefined;
    // Cheap lifecycle check, not an animation timer. Actual motion uses scene
    // time; requests occur only near coverage expiry or orbit refresh deadlines.
    const timer = window.setInterval(() => { if (!trajectoryLoadingRef.current) setAutomaticRefresh(value => value + 1); }, 15000);
    return () => window.clearInterval(timer);
  }, [mode, selectedCelestialBody]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return undefined;
    releaseViewerCamera(viewer, followStateRef);

    if (viewer.scene.mode !== SceneMode.SCENE3D) viewer.scene.morphTo3D(cameraDuration(0.42));

    const timer = window.setTimeout(() => {
      if (!viewer.isDestroyed()) {
        applyBaseMap(viewer, googleTilesRef.current, googleReadyRef.current, mapStyleRef.current, mapRequestRef, labelsEnabledRef.current);
        if (
          initialModeCameraResetRef.current &&
          startupCameraCommittedRef.current &&
          initialCountryRef.current
        ) {
          initialModeCameraResetRef.current = false;
          setStartupRegionView(
            viewer,
            initialCountryRef.current,
          );
        } else {
          initialModeCameraResetRef.current = false;
          setCameraPreset(
            viewer,
            "earth",
            followStateRef,
            null,
          );
        }
      }
    }, cameraDuration(0.47) * 1000);
    return () => window.clearTimeout(timer);
  }, [mode]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !earthActiveRef.current) return;
    if(mode === "live" && mapStyle === "google" && mapRequestRef.googleError && mapRetryNonce>0 && googleRetryNonceRef.current!==mapRetryNonce) {
      googleRetryNonceRef.current=mapRetryNonce;
      // Keep a valid raster surface before releasing failed/cached Google data.
      applyBaseMap(viewer,googleTilesRef.current,googleReadyRef.current,"esri",mapRequestRef,labelsEnabled).then(()=>{
        if(viewer.isDestroyed() || modeRef.current!=="live" || mapStyleRef.current!=="google") return;
        googleEventsRef.current.splice(0).forEach(remove=>remove?.());
        if(googleTilesRef.current) viewer.scene.primitives.remove(googleTilesRef.current);
        googleTilesRef.current=null;googleReadyRef.current=false;mapRequestRef.googleError=null;
        googleLoaderRef.current?.();
      });
      return;
    }
    if(mode === "live" && mapStyle === "google" && !mapRequestRef.googleError) googleLoaderRef.current?.();
    applyBaseMap(viewer, googleTilesRef.current, googleReadyRef.current, mapStyle, mapRequestRef, labelsEnabled);
  }, [mapStyle, mode, labelsEnabled, selectedTime, mapRetryNonce]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return undefined;

    const controller = new AbortController();
    const entityMap = entityMapRef.current;
    const permittedIds = mode === "live" ? trackedIds : [];
    const refreshAll = lastRefreshRef.current !== refreshNonce;
    lastRefreshRef.current = refreshNonce;

    for (const [noradId, data] of entityMap.entries()) {
      if (!permittedIds.includes(noradId)) {
        viewer.entities.remove(data.entity);
        removeSatelliteOrbit(data, satelliteOrbitCollectionRef.current);
        if (data.orbitEntity) viewer.entities.remove(data.orbitEntity);
        entityMap.delete(noradId);
        trajectoryRetryRef.current.delete(noradId);
        orbitRetryRef.current.delete(noradId);
        orbitQueueRef.current?.cancel(noradId);
        if (followStateRef.current?.noradId === noradId) {
          releaseViewerCamera(viewer, followStateRef);
        }
      }
    }

    const now = Date.now();
    const idsToLoad = permittedIds.filter(noradId => refreshAll ||
      (now >= (trajectoryRetryRef.current.get(noradId) || 0) && satelliteTrajectoryRefreshDue(entityMap.get(noradId), viewer.clock.currentTime, now)));

    if (!idsToLoad.length) { callbacksRef.current.onRefreshComplete?.(); return () => controller.abort(); }

    async function loadTrackedSatellites() {
      trajectoryLoadingRef.current = controller;
      // Bound repeated failed/out-of-window attempts, including simulated jumps.
      idsToLoad.forEach(id => trajectoryRetryRef.current.set(id, Date.now() + 30000));
      try {
        for (let offset = 0; offset < idsToLoad.length; offset += 24) {
        const batch = await fetchSatelliteTrajectories(idsToLoad.slice(offset, offset + 24), {
          stepSeconds: 5,
          durationSeconds: 300,
          signal: controller.signal,
        });

        if (controller.signal.aborted || viewer.isDestroyed()) return;

        for (const item of batch?.errors || []) {
          console.warn(
            `OrbitWatch: trajectory load failed for ${item.norad_id}`,
            item.message,
          );
        }

        for (const trajectory of batch?.objects || []) {
          const noradId = Number(trajectory.norad_id);
          if (!Number.isFinite(noradId) || !trajectory?.positions?.length) continue;

          const object = getSpaceObject(noradId);
          const existing = entityMap.get(noradId);
          let track;
          try {
            track = existing?.track || createSatelliteTrack(trajectory);
            if (existing?.track) track.merge(trajectory);
          } catch (error) { console.warn(`OrbitWatch: invalid trajectory for ${noradId}`, error); continue; }
          const sampled = track.position;
          const selected = noradId === selectedIdRef.current;
          const color = CATEGORY_COLORS[object?.category] || Color.WHITE;
          const colorCss = color.toCssColorString();
          const backendPeriod = Number(trajectory.orbital_period_minutes) * 60;
          const period = Number.isFinite(backendPeriod) && backendPeriod > 0
            ? backendPeriod
            : estimateOrbitalPeriodSeconds(trajectory.positions);

          if (existing?.entity) {
            // Atomic refresh: the existing entity stays rendered while the
            // backend request is in flight, then only its position property is
            // swapped. No remove/re-add flash and no availability gap.
            existing.entity.position = sampled;
            existing.entity.orientation = new VelocityOrientationProperty(sampled);
            existing.entity.name = object?.name || trajectory.name;
            existing.trajectory = trajectory;
            existing.period = period;
            existing.track = track;
            continue;
          }

          const entity = viewer.entities.add({
            name: object?.name || trajectory.name,
            show: earthActiveRef.current && modeRef.current === "live",
            position: sampled,
            orientation: new VelocityOrientationProperty(sampled),
            properties: { noradId },
            point: {
              pixelSize: selected ? 8 : 4.5,
              color,
              outlineColor: Color.BLACK.withAlpha(0.9),
              outlineWidth: selected ? 2 : 1,
              heightReference: HeightReference.NONE,
              scaleByDistance: new NearFarScalar(2.0e6, 1.25, 1.2e8, 0.72),
              distanceDisplayCondition: new DistanceDisplayCondition(7_000_000, Number.MAX_VALUE),
            },
            billboard: {
              image: satelliteIconDataUri(colorCss, object?.category),
              width: selected ? 35 : 27,
              height: selected ? 35 : 27,
              distanceDisplayCondition: new DistanceDisplayCondition(0, 10_500_000),
              scaleByDistance: new NearFarScalar(25_000, 1.35, 8_500_000, 0.55),
            },
            label: {
              show: selected,
              text: object?.name || trajectory.name,
              font: "600 16px Inter, system-ui, sans-serif",
              fillColor: Color.WHITE,
              outlineColor: Color.BLACK,
              outlineWidth: 4,
              style: LabelStyle.FILL_AND_OUTLINE,
              pixelOffset: new Cartesian2(0, -25),
              scaleByDistance: new NearFarScalar(100_000, 1.0, 18_000_000, 0.6),
              distanceDisplayCondition: new DistanceDisplayCondition(0, 35_000_000),
            },
          });

          entityMap.set(noradId, {
            entity,
            orbitEntity: null,
            trajectory,
            period,
            track,
          });
        }

        if ((batch?.objects || []).length) {
          setEntityRevision((value) => value + 1);
          viewer.scene.requestRender();
        }
        }
      } catch (error) {
        if (error?.name !== "AbortError") {
          console.warn("OrbitWatch: batch satellite load failed", error);
        }
      } finally {
        if (trajectoryLoadingRef.current === controller) trajectoryLoadingRef.current = null;
        if (!controller.signal.aborted) callbacksRef.current.onRefreshComplete?.();
      }
    }

    loadTrackedSatellites();
    return () => controller.abort();
  }, [trackedIds, refreshNonce, automaticRefresh, mode]);

  useEffect(() => {
    for (const [noradId, data] of entityMapRef.current.entries()) {
      const selected = noradId === selectedId;
      if (data.entity.point) {
        data.entity.point.pixelSize = selected ? 8 : 4.5;
        data.entity.point.outlineWidth = selected ? 2 : 1;
      }
      if (data.entity.billboard) {
        data.entity.billboard.width = selected ? 35 : 27;
        data.entity.billboard.height = selected ? 35 : 27;
      }
      if (data.entity.label) data.entity.label.show = selected || hoveredIdRef.current === noradId;
      if (data.orbitEntity?.polyline) {
        const color = CATEGORY_COLORS[getSpaceObject(noradId)?.category] || Color.WHITE;
        styleSatelliteOrbit(data, color, selected, shownOrbitIdsRef.current.size, viewerRef.current?.camera.positionCartographic.height);
      }
    }
  }, [selectedId]);
  useEffect(() => {
    satelliteModelDetailRef.current?.update(
      getSpaceObject(selectedId),
      entityMapRef.current.get(selectedId)?.entity,
      mode === "live" && selectedCelestialBody === "earth" && earthActiveRef.current,
    );
  }, [selectedId, selectedCelestialBody, entityRevision, trackedIds, mode]);


  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return undefined;

    const queue = orbitQueueRef.current;
    if (!queue) return undefined;
    for (const [noradId, data] of entityMapRef.current.entries()) {
      const shouldShow = mode === "live" && shownOrbitIds.has(noradId);

      if (!shouldShow) {
        queue.cancel(noradId);
        orbitRetryRef.current.delete(noradId);
        removeSatelliteOrbit(data, satelliteOrbitCollectionRef.current);
        if (data.orbitEntity) {
          viewer.entities.remove(data.orbitEntity);
          data.orbitEntity = null;
        }
        continue;
      }

      // Trajectory overlap does not invalidate the full orbit. Refresh its
      // true propagated geometry on a bounded deadline or changed TLE epoch.
      if (queue.has(noradId) || !satelliteOrbitRefreshDue(data) || Date.now() < (orbitRetryRef.current.get(noradId) || 0)) continue;

      async function loadOrbit(signal) {
        if (signal.aborted) return;
        const orbitEpoch = data.trajectory?.tle_epoch;
        orbitRetryRef.current.set(noradId, Date.now() + 30000);
        try {
          const orbit = await fetchSatelliteOrbit(noradId, {
            // Slow/eccentric periods need denser temporal sampling near perigee.
            // Preserve the scientific samples for both display styles.
            samples: data.period > 18 * 3600 ? 2000 : data.period > 3 * 3600 ? 960 : 480,
            signal,
          });

          if (
            signal.aborted ||
            viewer.isDestroyed() ||
            !orbit?.positions?.length ||
            (!shownOrbitIdsRef.current.has(noradId) || modeRef.current !== "live")
          ) return;

          const orbitState = createSatelliteOrbitState(orbit);
          const orbitPositions = orbitState.positions;

          const currentData = entityMapRef.current.get(noradId);
          if (
            !currentData ||
            signal.aborted ||
            viewer.isDestroyed() ||
            (!shownOrbitIdsRef.current.has(noradId) || modeRef.current !== "live")
          ) return;

          const object = getSpaceObject(noradId);
          const selected = noradId === selectedIdRef.current;
          const color = CATEGORY_COLORS[object?.category] || Color.WHITE;

          if (currentData.orbitEntity?.polyline) {
            currentData.orbitEntity.polyline.positions = orbitPositions;
            attachSatelliteOrbit(currentData, satelliteOrbitCollectionRef.current, orbitPositions, orbitState);
            setSatelliteOrbitDisplay(currentData,orbitStyleRef.current);
            currentData.orbitEpoch = orbitEpoch;
            styleSatelliteOrbit(currentData, color, selected, shownOrbitIdsRef.current.size, viewer.camera.positionCartographic.height);
            currentData.orbitEntity.show = earthActiveRef.current;
            viewer.scene.requestRender();
            return;
          }

          currentData.orbitEntity = viewer.entities.add({
            name: `${object?.name || orbit.name} full orbit`,
            show: earthActiveRef.current && modeRef.current === "live",
            properties: { noradId },
            polyline: {
              positions: orbitPositions,
              width: 1.05,
              material: color.withAlpha(0.19),
              arcType: ArcType.NONE,
            },
          });
          styleSatelliteOrbit(currentData, color, selected, shownOrbitIdsRef.current.size, viewer.camera.positionCartographic.height);
          attachSatelliteOrbit(currentData, satelliteOrbitCollectionRef.current, orbitPositions, orbitState);
            setSatelliteOrbitDisplay(currentData,orbitStyleRef.current);
          currentData.orbitEpoch = orbitEpoch;
          styleSatelliteOrbit(currentData, color, selected, shownOrbitIdsRef.current.size, viewer.camera.positionCartographic.height);
          viewer.scene.requestRender();
        } catch (error) {
          if (error?.name !== "AbortError") {
            console.warn(`OrbitWatch: full orbit load failed for ${noradId}`, error);
          }
        }
      }

      queue.enqueue(noradId, loadOrbit);
    }
    // A trajectory/selection refresh must not cancel queued unrelated paths.
    // Per-ID controllers are aborted only on hide/unload or Viewer destruction.
    return undefined;
  }, [shownOrbitIds, entityRevision, automaticRefresh, mode]);


  useEffect(() => {
    const viewer=viewerRef.current;
    if(!viewer) return;
    for(const data of entityMapRef.current.values()) {
      setSatelliteOrbitDisplay(data,orbitStyle);
      updateSatelliteOrbit(data,viewer.clock.currentTime);
    }
    viewer.scene.requestRender();
  },[orbitStyle]);

  if (sceneError) throw sceneError;
  return <div className="orbit-globe" ref={mountRef} />;
}
