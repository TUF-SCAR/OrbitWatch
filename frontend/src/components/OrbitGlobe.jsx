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
  ExtrapolationType,
  HeightReference,
  HeadingPitchRange,
  Ion,
  IonGeocodeProviderType,
  IonGeocoderService,
  IonWorldImageryStyle,
  JulianDate,
  LabelStyle,
  Math as CesiumMath,
  Matrix3,
  Matrix4,
  NearFarScalar,
  Rectangle,
  SampledPositionProperty,
  SceneMode,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Simon1994PlanetaryPositions,
  DynamicAtmosphereLightingType,
  SkyBox,
  Terrain,
  Transforms,
  UrlTemplateImageryProvider,
  VelocityOrientationProperty,
  Viewer,
  createGooglePhotorealistic3DTileset,
  createWorldImageryAsync,
} from "cesium";
import { fetchSatelliteOrbit, fetchSatelliteTrajectories } from "../services/orbitwatchApi.js";
import { fetchOpenDisasterEvents } from "../services/eonetApi.js";
import { getSpaceObject } from "../data/spaceObjects.js";
import { createSolarSystemLayer, pickSolarSystemObject } from "../services/solarSystemLayer.js";
import { createSelectedSatelliteDetail } from "../services/selectedSatelliteDetail.js";
import { applyBaseMap as updateBaseMap } from "../services/baseMap.js";
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

const DISASTER_COLORS = {
  wildfires: Color.fromCssColorString("#ff805e"),
  severeStorms: Color.fromCssColorString("#e6b86a"),
  floods: Color.fromCssColorString("#65c6ff"),
  volcanoes: Color.fromCssColorString("#ff9a67"),
};

const RASTER_MAPS = {
  bing: () => createWorldImageryAsync({ style: IonWorldImageryStyle.AERIAL }),
  "bing-labels": (labels) => createWorldImageryAsync({ style: labels ? IonWorldImageryStyle.AERIAL_WITH_LABELS : IonWorldImageryStyle.AERIAL }),
  "bing-road": () => createWorldImageryAsync({ style: IonWorldImageryStyle.ROAD }),
  esri: () => new UrlTemplateImageryProvider({
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    credit: "Esri World Imagery",
    maximumLevel: 19,
  }),
  osm: () => new UrlTemplateImageryProvider({
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    credit: "OpenStreetMap contributors",
    maximumLevel: 19,
  }),
  "carto-dark": (labels) => {
    const key = import.meta.env.VITE_CARTO_API_KEY;
    if (!key) return null;
    return new UrlTemplateImageryProvider({
      url: `https://a.basemaps.cartocdn.com/${labels ? "dark_all" : "dark_nolabels"}/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`,
      credit: "CARTO / OpenStreetMap contributors",
      maximumLevel: 20,
    });
  },
  "carto-voyager": (labels) => {
    const key = import.meta.env.VITE_CARTO_API_KEY;
    if (!key) return null;
    return new UrlTemplateImageryProvider({
      url: `https://a.basemaps.cartocdn.com/rastertiles/${labels ? "voyager" : "voyager_nolabels"}/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`,
      credit: "CARTO / OpenStreetMap contributors",
      maximumLevel: 20,
    });
  },
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

function desiredMap(mode, sceneMode, mapStyle) {
  return mode === "disaster" ? (sceneMode === "3d" ? "google" : "esri") : mapStyle;
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


function latestEventCoordinate(event) {
  const geometry = Array.isArray(event?.geometry) ? event.geometry[event.geometry.length - 1] : null;
  if (!geometry?.coordinates) return null;
  if (geometry.type === "Point" && geometry.coordinates.length >= 2) {
    return { longitude: Number(geometry.coordinates[0]), latitude: Number(geometry.coordinates[1]) };
  }
  if (geometry.type === "Polygon") {
    const ring = geometry.coordinates?.[0];
    if (!Array.isArray(ring) || !ring.length) return null;
    const valid = ring.filter((point) => Array.isArray(point) && point.length >= 2);
    if (!valid.length) return null;
    return {
      longitude: valid.reduce((sum, point) => sum + Number(point[0]), 0) / valid.length,
      latitude: valid.reduce((sum, point) => sum + Number(point[1]), 0) / valid.length,
    };
  }
  return null;
}

export default function OrbitGlobe({
  trackedIds,
  selectedId,
  selectedTime,
  mode,
  refreshNonce,
  mapStyle,
  labelsEnabled,
  sceneMode,
  shownOrbitIds,
  disasterLayers,
  onObjectSelect,
  onViewTelemetry,
  globeRef,
  startupCountry,
  selectedCelestialBody,
  onCelestialSelect,
  onScaleChange,
  onSceneReady,
  onRefreshComplete,
  onMapStatus,
  quality = "auto",
  onDetailReady,
}) {
  const mountRef = useRef(null);
  const viewerRef = useRef(null);
  const placeSearchRef = useRef(null);
  const startupCameraCommittedRef = useRef(false);
  const initialModeCameraResetRef = useRef(true);
  const initialCountryRef = useRef(startupCountry);
  const callbacksRef = useRef({ onSceneReady, onRefreshComplete, onMapStatus, onDetailReady, onScaleChange });
  const applyBaseMap = (...args) => updateBaseMap(...args, RASTER_MAPS, (status) => callbacksRef.current.onMapStatus?.(status));
  const earthActiveRef = useRef(true);
  const lastInteractionRef = useRef(0);
  const qualityRef = useRef(quality);
  const [entityRevision, setEntityRevision] = useState(0);
  const [sceneError, setSceneError] = useState(null);
  const googleTilesRef = useRef(null);
  const googleReadyRef = useRef(false);
  const entityMapRef = useRef(new Map());
  const disasterEntityIdsRef = useRef([]);
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
  const sceneModeRef = useRef(sceneMode);
  const shownOrbitIdsRef = useRef(shownOrbitIds);
  const solarSystemLayerRef = useRef(null);
  const satelliteModelDetailRef = useRef(null);
  const onCelestialSelectRef = useRef(onCelestialSelect);

  useEffect(() => {
  selectedIdRef.current = selectedId;
  labelsEnabledRef.current = labelsEnabled;
  onObjectSelectRef.current = onObjectSelect;
  onViewTelemetryRef.current = onViewTelemetry;
  mapStyleRef.current = mapStyle;
  modeRef.current = mode;
  sceneModeRef.current = sceneMode;
  shownOrbitIdsRef.current = shownOrbitIds;
  onCelestialSelectRef.current = onCelestialSelect;
  callbacksRef.current = { onSceneReady, onRefreshComplete, onMapStatus, onDetailReady, onScaleChange };
  qualityRef.current = quality;
  }, [selectedId, labelsEnabled, onObjectSelect, onViewTelemetry, mapStyle, mode, sceneMode, shownOrbitIds, onCelestialSelect, onSceneReady, onRefreshComplete, onMapStatus, onDetailReady, onScaleChange, quality]);

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

    const token = import.meta.env.VITE_CESIUM_ION_TOKEN;
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

    viewer.scene.skyBox = SkyBox.createEarthSkyBox();

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
    let googleRetry, googleLoading = false;
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
    async function loadGoogleEarth(attempt = 0) {
      if (googleLoading || destroyed || !earthActiveRef.current) return;
      googleLoading = true;
      try {
        const tileset = await createGooglePhotorealistic3DTileset(
          { onlyUsingWithGoogleGeocoder: true },
          {
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
          },
        );
        if (destroyed || viewer.isDestroyed() || !earthActiveRef.current) { tileset.destroy(); return; }
        tileset.show = true;
        googleTilesRef.current = tileset;
        applyQuality(viewer, tileset, qualityRef.current);
        googleReadyRef.current = false;

        const activateGoogleWhenReady = () => {
          if (destroyed || viewer.isDestroyed() || googleReadyRef.current) return;
          googleReadyRef.current = true;
          if (!earthActiveRef.current) return;
          callbacksRef.current.onMapStatus?.(null);
          applyBaseMap(
            viewer,
            tileset,
            true,
            desiredMap(modeRef.current, sceneModeRef.current, mapStyleRef.current),
            mapRequestRef,
            labelsEnabledRef.current,
          );
        };
        // Register before adding the primitive so the initial-load signal can
        // never race past us on a fast connection/cache hit.
        tileset.initialTilesLoaded?.addEventListener?.(activateGoogleWhenReady);
        tileset.tileFailed?.addEventListener?.((failure) => {
          console.warn("OrbitWatch: a Google Photorealistic tile failed to load.", failure);
        });
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
          desiredMap(modeRef.current, sceneModeRef.current, mapStyleRef.current),
          mapRequestRef,
          labelsEnabledRef.current,
        );
      } catch (error) {
        if (destroyed || !earthActiveRef.current) return;
        if (!destroyed && attempt < 1) {
          googleRetry = window.setTimeout(() => loadGoogleEarth(attempt + 1), 1200);
          return;
        }
        console.warn("OrbitWatch: Google high-detail Earth unavailable; raster fallback will remain active.", error);
        if (desiredMap(modeRef.current, sceneModeRef.current, mapStyleRef.current) === "google") callbacksRef.current.onMapStatus?.("Google imagery unavailable. Esri satellite fallback is active.");
      } finally { googleLoading = false; }
    }
    if (token) loadGoogleEarth();
    else callbacksRef.current.onMapStatus?.("Google / Bing unavailable: no Cesium ion token. Esri satellite is active.");

    const placeLabels = createPlaceLabelLayer(viewer);

    // LiveEarthWarmup on the auth screen does not pass onCelestialSelect.
    // Keep that hidden viewer Earth-only. The full solar system is created
    // only for the real authenticated OrbitWatch App.
    if (typeof onCelestialSelectRef.current === "function") {
      solarSystemLayerRef.current = createSolarSystemLayer(
        viewer,
        {
          isLive: () => modeRef.current === "live" && sceneModeRef.current === "3d",
          onDetailReady: (id) => callbacksRef.current.onDetailReady?.(id),
          onScaleChange: (state) => callbacksRef.current.onScaleChange?.(state),
          setEarthRepresentation: (show) => {
            if (!earthActiveRef.current) return;
            viewer.scene.globe.show = show;
            if (googleTilesRef.current) googleTilesRef.current.show = show;
          },
          hideEarthDetail: () => {
            earthActiveRef.current = false;
            mapRequestRef.current += 1;
            mapRequestRef.removeError?.();
            mapRequestRef.removeError = null;
            const googleTiles =
              googleTilesRef.current;

            if (googleTiles) {
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
              desiredMap(
                modeRef.current,
                sceneModeRef.current,
                mapStyleRef.current,
              ),
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

    const removePreRender = viewer.scene.preRender.addEventListener((_scene, time) => {
      const now = performance.now();
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
      window.clearTimeout(googleRetry);
      removeReady();
      removeRenderError();
      viewer.scene.canvas.removeEventListener("pointerdown", pointerDown);
      viewer.scene.canvas.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("pointerup", pointerUp);
      viewer.scene.canvas.removeEventListener("wheel", touchCamera);
      removePreRender();
      placeLabels.destroy();
      placeSearchRef.current?.destroy();
      placeSearchRef.current = null;
      handler.destroy();

      const solarLayer = solarSystemLayerRef.current;
      solarSystemLayerRef.current = null;
      solarLayer?.destroy();

      satelliteModelDetailRef.current?.clear();
      satelliteModelDetailRef.current = null;
      entityMap.clear();
      disasterEntityIdsRef.current = [];
      googleTilesRef.current = null;
      googleReadyRef.current = false;
      followStateRef.current = null;

      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (viewer && !viewer.isDestroyed()) applyQuality(viewer, googleTilesRef.current, quality);
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
    const viewer = viewerRef.current;
    if (!viewer) return undefined;
    releaseViewerCamera(viewer, followStateRef);

    const wants2D = mode === "disaster" && sceneMode === "2d";
    if (wants2D) viewer.scene.morphTo2D(cameraDuration(0.42));
    else viewer.scene.morphTo3D(cameraDuration(0.42));

    const timer = window.setTimeout(() => {
      if (!viewer.isDestroyed()) {
        applyBaseMap(viewer, googleTilesRef.current, googleReadyRef.current, desiredMap(mode, sceneMode, mapStyleRef.current), mapRequestRef, labelsEnabledRef.current);
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
  }, [mode, sceneMode]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !earthActiveRef.current) return;
    applyBaseMap(viewer, googleTilesRef.current, googleReadyRef.current, desiredMap(mode, sceneMode, mapStyle), mapRequestRef, labelsEnabled);
  }, [mapStyle, mode, sceneMode, labelsEnabled]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return undefined;

    const controller = new AbortController();
    const entityMap = entityMapRef.current;
    const refreshAll = lastRefreshRef.current !== refreshNonce;
    lastRefreshRef.current = refreshNonce;

    for (const [noradId, data] of entityMap.entries()) {
      if (!trackedIds.includes(noradId)) {
        viewer.entities.remove(data.entity);
        if (data.orbitEntity) viewer.entities.remove(data.orbitEntity);
        entityMap.delete(noradId);
        if (followStateRef.current?.noradId === noradId) {
          releaseViewerCamera(viewer, followStateRef);
        }
      }
    }

    const idsToLoad = trackedIds.filter(
      (noradId) => refreshAll || !entityMap.has(noradId),
    );

    if (!idsToLoad.length) { callbacksRef.current.onRefreshComplete?.(); return () => controller.abort(); }

    async function loadTrackedSatellites() {
      try {
        const batch = await fetchSatelliteTrajectories(idsToLoad, {
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
          const sampled = new SampledPositionProperty();
          sampled.backwardExtrapolationType = ExtrapolationType.HOLD;
          sampled.backwardExtrapolationDuration = 30;
          sampled.forwardExtrapolationType = ExtrapolationType.HOLD;
          sampled.forwardExtrapolationDuration = 120;

          for (const position of trajectory.positions) {
            sampled.addSample(
              JulianDate.fromIso8601(position.timestamp),
              Cartesian3.fromDegrees(
                position.longitude,
                position.latitude,
                position.altitude_km * 1000,
              ),
            );
          }

          const existing = entityMap.get(noradId);
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
            continue;
          }

          const entity = viewer.entities.add({
            name: object?.name || trajectory.name,
            show: earthActiveRef.current,
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
          });
        }

        if ((batch?.objects || []).length) {
          setEntityRevision((value) => value + 1);
        }
      } catch (error) {
        if (error?.name !== "AbortError") {
          console.warn("OrbitWatch: batch satellite load failed", error);
        }
      } finally { if (!controller.signal.aborted) callbacksRef.current.onRefreshComplete?.(); }
    }

    loadTrackedSatellites();
    return () => controller.abort();
  }, [trackedIds, refreshNonce]);

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
        data.orbitEntity.polyline.width = selected ? 2.0 : 1.05;
        data.orbitEntity.polyline.material = color.withAlpha(selected ? 0.6 : 0.26);
      }
    }
  }, [selectedId]);
  useEffect(() => {
    satelliteModelDetailRef.current?.update(
      getSpaceObject(selectedId),
      entityMapRef.current.get(selectedId)?.entity,
      selectedCelestialBody === "earth" && earthActiveRef.current,
    );
  }, [selectedId, selectedCelestialBody, entityRevision, trackedIds]);


  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return undefined;

    const controller = new AbortController();
    const jobs = [];
    for (const [noradId, data] of entityMapRef.current.entries()) {
      const shouldShow = shownOrbitIds.has(noradId);

      if (!shouldShow) {
        if (data.orbitEntity) {
          viewer.entities.remove(data.orbitEntity);
          data.orbitEntity = null;
        }
        continue;
      }

      async function loadOrbit() {
        try {
          const orbit = await fetchSatelliteOrbit(noradId, {
            samples: 480,
            signal: controller.signal,
          });

          if (
            controller.signal.aborted ||
            viewer.isDestroyed() ||
            !orbit?.positions?.length ||
            !shownOrbitIdsRef.current.has(noradId)
          ) return;

          // The backend already propagated one entire orbital period. Render
          // those geographic points directly. This is the exact future path
          // relative to the rotating Earth, so the moving satellite follows
          // the same line instead of a separately reconstructed frontend orbit.
          const orbitPositions = orbit.positions.map((position) =>
            Cartesian3.fromDegrees(
              position.longitude,
              position.latitude,
              position.altitude_km * 1000,
            ),
          );

          const currentData = entityMapRef.current.get(noradId);
          if (
            !currentData ||
            controller.signal.aborted ||
            viewer.isDestroyed() ||
            !shownOrbitIdsRef.current.has(noradId)
          ) return;

          const object = getSpaceObject(noradId);
          const selected = noradId === selectedIdRef.current;
          const color = CATEGORY_COLORS[object?.category] || Color.WHITE;

          if (currentData.orbitEntity?.polyline) {
            currentData.orbitEntity.polyline.positions = orbitPositions;
            currentData.orbitEntity.polyline.width = selected ? 2.2 : 1.25;
            currentData.orbitEntity.polyline.material = color.withAlpha(
              selected ? 0.66 : 0.32,
            );
            currentData.orbitEntity.show = earthActiveRef.current;
            return;
          }

          currentData.orbitEntity = viewer.entities.add({
            name: `${object?.name || orbit.name} full orbit`,
            show: earthActiveRef.current,
            properties: { noradId },
            polyline: {
              positions: orbitPositions,
              width: selected ? 2.2 : 1.25,
              material: color.withAlpha(selected ? 0.66 : 0.32),
              arcType: ArcType.NONE,
            },
          });
        } catch (error) {
          if (error?.name !== "AbortError") {
            console.warn(`OrbitWatch: full orbit load failed for ${noradId}`, error);
          }
        }
      }

      jobs.push(loadOrbit);
    }
    // Bound decoding and request bursts when a large collection is loaded.
    let next = 0;
    async function worker() { while (!controller.signal.aborted && next < jobs.length) await jobs[next++](); }
    for (let index = 0; index < Math.min(4, jobs.length); index += 1) worker();

    return () => controller.abort();
  }, [shownOrbitIds, entityRevision]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return undefined;
    for (const id of disasterEntityIdsRef.current) viewer.entities.removeById(id);
    disasterEntityIdsRef.current = [];
    if (mode !== "disaster" || !disasterLayers.length) return undefined;

    const controller = new AbortController();
    async function loadEvents() {
      try {
        const events = await fetchOpenDisasterEvents(controller.signal);
        if (controller.signal.aborted || viewer.isDestroyed()) return;
        for (const event of events) {
          const eventCategories = Array.isArray(event.categories) ? event.categories.map((item) => item.id) : [];
          const category = disasterLayers.find((id) => eventCategories.includes(id));
          if (!category) continue;
          const coordinate = latestEventCoordinate(event);
          if (!coordinate || !Number.isFinite(coordinate.longitude) || !Number.isFinite(coordinate.latitude)) continue;
          const entityId = `eonet-${event.id}-${category}`;
          viewer.entities.add({
            id: entityId,
            name: event.title,
            position: Cartesian3.fromDegrees(coordinate.longitude, coordinate.latitude, 18_000),
            point: {
              pixelSize: 9,
              color: DISASTER_COLORS[category] || Color.ORANGE,
              outlineColor: Color.WHITE.withAlpha(0.7),
              outlineWidth: 1,
              scaleByDistance: new NearFarScalar(1.0e6, 1.2, 3.0e7, 0.55),
            },
            label: {
              show: true,
              text: event.title,
              font: "600 14px Inter, system-ui, sans-serif",
              fillColor: Color.WHITE.withAlpha(0.92),
              outlineColor: Color.BLACK,
              outlineWidth: 3,
              style: LabelStyle.FILL_AND_OUTLINE,
              pixelOffset: new Cartesian2(0, -16),
              scaleByDistance: new NearFarScalar(1.0e6, 0.95, 9.0e6, 0),
            },
          });
          disasterEntityIdsRef.current.push(entityId);
        }
      } catch (error) {
        if (error?.name !== "AbortError") console.warn("OrbitWatch: EONET feed unavailable", error);
      }
    }
    loadEvents();
    return () => controller.abort();
  }, [mode, disasterLayers]);

  if (sceneError) throw sceneError;
  return <div className="orbit-globe" ref={mountRef} />;
}
