import { useEffect, useImperativeHandle, useRef } from "react";
import {
  ArcType,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  HeightReference,
  HeadingPitchRange,
  ImageryLayer,
  Ion,
  IonGeocodeProviderType,
  IonImageryProvider,
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
  TimeInterval,
  TimeIntervalCollection,
  Transforms,
  UrlTemplateImageryProvider,
  Viewer,
  createGooglePhotorealistic3DTileset,
  createWorldImageryAsync,
} from "cesium";
import { fetchSatelliteTrajectory } from "../services/orbitwatchApi.js";
import { fetchOpenDisasterEvents } from "../services/eonetApi.js";
import { getSpaceObject } from "../data/spaceObjects.js";
import { PLACE_LABELS } from "../data/placeLabels.js";

const EARTH_RADIUS_KM = 6371.0088;
const EARTH_MU = 3.986004418e14;

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
  "bing-labels": () => createWorldImageryAsync({ style: IonWorldImageryStyle.AERIAL_WITH_LABELS }),
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
  "carto-dark": () => {
    const key = import.meta.env.VITE_CARTO_API_KEY;
    if (!key) return null;
    return new UrlTemplateImageryProvider({
      url: `https://a.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`,
      credit: "CARTO / OpenStreetMap contributors",
      maximumLevel: 20,
    });
  },
  "carto-voyager": () => {
    const key = import.meta.env.VITE_CARTO_API_KEY;
    if (!key) return null;
    return new UrlTemplateImageryProvider({
      url: `https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`,
      credit: "CARTO / OpenStreetMap contributors",
      maximumLevel: 20,
    });
  },
};

function makeAvailability(positions) {
  if (!positions?.length) return undefined;
  return new TimeIntervalCollection([
    new TimeInterval({
      start: JulianDate.fromIso8601(positions[0].timestamp),
      stop: JulianDate.fromIso8601(positions[positions.length - 1].timestamp),
    }),
  ]);
}

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

function setCameraPreset(viewer, preset, followState, selectedEntity) {
  if (!viewer || viewer.isDestroyed()) return false;
  releaseViewerCamera(viewer, followState);

  if (preset === "selected") {
    const target = selectedEntity?.position?.getValue?.(viewer.clock.currentTime);
    if (!target) return false;
    viewer.camera.lookAt(target, new HeadingPitchRange(0, -0.34, 1_200_000));
    const pose = saveWorldCameraPose(viewer);
    restoreWorldCameraPose(viewer, pose);
    return true;
  }

  if (viewer.scene.mode === SceneMode.SCENE2D) {
    if (preset === "north") {
      viewer.camera.flyTo({ destination: Rectangle.fromDegrees(-180, 5, 180, 90), duration: 0.55 });
      return true;
    }
    if (preset === "day" || preset === "night") {
      const dir = sunDirectionFixed(viewer.clock.currentTime);
      if (preset === "night") Cartesian3.negate(dir, dir);
      const cartographic = viewer.scene.globe.ellipsoid.cartesianToCartographic(Cartesian3.multiplyByScalar(dir, EARTH_RADIUS_KM * 1000, new Cartesian3()));
      viewer.camera.flyTo({ destination: Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 16_000_000), duration: 0.65 });
      return true;
    }
    viewer.camera.flyTo({ destination: Rectangle.fromDegrees(-180, -90, 180, 90), duration: 0.55 });
    return true;
  }

  if (preset === "north") {
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(0, 89.8, 20_500_000),
      orientation: { heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 },
      duration: 0.65,
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
    viewer.camera.flyTo({ destination, orientation: { direction: towardEarth, up }, duration: 0.75 });
    return true;
  }

  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(26, 18, 22_000_000),
    orientation: { heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 },
    duration: 0.65,
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

async function fetchFullOrbit(noradId, signal) {
  const seed = await fetchSatelliteTrajectory(noradId, { stepSeconds: 10, durationSeconds: 180, signal });
  if (!seed?.positions?.length) return seed;
  const period = estimateOrbitalPeriodSeconds(seed.positions);
  const stepSeconds = Math.max(15, Math.min(300, Math.round(period / 280)));
  const durationSeconds = Math.ceil(period * 1.04);
  const full = await fetchSatelliteTrajectory(noradId, { stepSeconds, durationSeconds, signal });
  return { ...full, orbitalPeriodSeconds: period };
}

async function runWithConcurrency(items, worker, concurrency = 4) {
  let cursor = 0;
  async function runWorker() {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, runWorker));
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

function makeEarthAtNightLayer() {
  const layer = ImageryLayer.fromProviderAsync(IonImageryProvider.fromAssetId(3812));
  // Cesium ion asset 3812 is NASA Black Marble / Earth at Night. The
  // day/night alpha split keeps the daytime map untouched while the same
  // surface fades to the real night-light composite on the dark hemisphere.
  layer.alpha = 1.0;
  layer.dayAlpha = 0.0;
  layer.nightAlpha = 1.0;
  layer.brightness = 1.16;
  layer.contrast = 1.08;
  layer.saturation = 0.9;
  return layer;
}

async function applyBaseMap(viewer, googleTiles, googleReady, effectiveMap, mapRequestRef) {
  if (!viewer || viewer.isDestroyed()) return;
  const requestId = ++mapRequestRef.current;
  const wantsGoogle = effectiveMap === "google" && viewer.scene.mode !== SceneMode.SCENE2D && Boolean(googleTiles);
  const useGoogle = wantsGoogle && googleReady;

  // Keep the Google tileset visible while its first view streams, but do not
  // remove the raster globe until the initial tiles are actually ready. This
  // prevents the black/empty Earth seen when the 3D tiles need a few seconds
  // to arrive on first load.
  if (googleTiles) googleTiles.show = wantsGoogle;
  viewer.scene.globe.show = !useGoogle;
  viewer.scene.globe.enableLighting = true;
  viewer.scene.globe.dynamicAtmosphereLighting = true;
  viewer.scene.globe.dynamicAtmosphereLightingFromSun = true;

  if (useGoogle) {
    viewer.imageryLayers.removeAll(true);
    viewer.scene.requestRender();
    return;
  }

  // While Google 3D is warming up, show a real Earth underneath instead of an
  // empty ellipsoid. Once initialTilesLoaded fires we atomically switch to the
  // photorealistic tileset.
  const rasterMap = wantsGoogle ? "esri" : effectiveMap;
  const factory = RASTER_MAPS[rasterMap] || RASTER_MAPS.esri;
  let provider;
  try {
    provider = await factory();
  } catch (error) {
    console.warn(`OrbitWatch: ${rasterMap} map unavailable; falling back to Esri.`, error);
  }
  if (!provider) provider = await RASTER_MAPS.esri();
  if (requestId !== mapRequestRef.current || viewer.isDestroyed()) return;

  viewer.imageryLayers.removeAll(true);
  viewer.imageryLayers.addImageryProvider(provider);
  if (import.meta.env.VITE_CESIUM_ION_TOKEN) viewer.imageryLayers.add(makeEarthAtNightLayer());
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
}) {
  const mountRef = useRef(null);
  const viewerRef = useRef(null);
  const googleTilesRef = useRef(null);
  const googleReadyRef = useRef(false);
  const entityMapRef = useRef(new Map());
  const placeEntityIdsRef = useRef([]);
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
  const icrfReadyRef = useRef(Promise.resolve());

  selectedIdRef.current = selectedId;
  labelsEnabledRef.current = labelsEnabled;
  onObjectSelectRef.current = onObjectSelect;
  onViewTelemetryRef.current = onViewTelemetry;
  mapStyleRef.current = mapStyle;
  modeRef.current = mode;
  sceneModeRef.current = sceneMode;
  shownOrbitIdsRef.current = shownOrbitIds;

  useImperativeHandle(globeRef, () => ({
    focusSelected() {
      const viewer = viewerRef.current;
      const entity = entityMapRef.current.get(selectedIdRef.current)?.entity;
      if (!viewer || !entity) return false;
      return setCameraPreset(viewer, "selected", followStateRef, entity);
    },
    followSelected() {
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
      const entity = entityMapRef.current.get(selectedIdRef.current)?.entity;
      return setCameraPreset(viewerRef.current, preset, followStateRef, entity);
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
      geocoder: token ? IonGeocodeProviderType.GOOGLE : false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      terrain: Terrain.fromWorldTerrain({ requestVertexNormals: true, requestWaterMask: true }),
      shouldAnimate: true,
    });

    viewerRef.current = viewer;
    viewer.scene.backgroundColor = Color.fromCssColorString("#01040a");
    viewer.scene.globe.baseColor = Color.fromCssColorString("#07101a");
    viewer.scene.globe.showGroundAtmosphere = true;
    viewer.scene.globe.enableLighting = true;
    viewer.scene.globe.dynamicAtmosphereLighting = true;
    viewer.scene.globe.dynamicAtmosphereLightingFromSun = true;
    viewer.scene.atmosphere.dynamicLighting = DynamicAtmosphereLightingType.SUNLIGHT;
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.skyAtmosphere.perFragmentAtmosphere = true;
    viewer.scene.sun.show = true;
    viewer.scene.moon.show = true;
    viewer.scene.highDynamicRange = true;
    viewer.scene.fog.enabled = true;
    viewer.scene.fog.density = 0.00008;
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 1.0;
    viewer.scene.screenSpaceCameraController.maximumZoomDistance = Number.POSITIVE_INFINITY;
    viewer.scene.screenSpaceCameraController.inertiaSpin = 0.82;
    viewer.scene.screenSpaceCameraController.inertiaTranslate = 0.78;
    viewer.scene.screenSpaceCameraController.inertiaZoom = 0.74;
    viewer.scene.screenSpaceCameraController.zoomFactor = 3.0;
    viewer.clock.shouldAnimate = true;

    const frameWindowCenter = JulianDate.now();
    const frameWindowStart = JulianDate.addDays(frameWindowCenter, -2, new JulianDate());
    const frameWindowStop = JulianDate.addDays(frameWindowCenter, 3, new JulianDate());
    icrfReadyRef.current = Transforms.preloadIcrfFixed(new TimeInterval({ start: frameWindowStart, stop: frameWindowStop }))
      .catch((error) => {
        console.warn("OrbitWatch: inertial reference-frame data could not be preloaded; orbit guides will use the fixed-frame fallback.", error);
      });

    viewer.scene.skyBox = SkyBox.createEarthSkyBox();

    setCameraPreset(viewer, "earth", followStateRef, null);

    let destroyed = false;
    async function loadGoogleEarth(attempt = 0) {
      try {
        const tileset = await createGooglePhotorealistic3DTileset(
          { onlyUsingWithGoogleGeocoder: true },
          {
            maximumScreenSpaceError: 5,
            dynamicScreenSpaceError: true,
            enableCollision: true,
            // Imagery draping is experimental. If a future overlay is slow or
            // unavailable, Google's original photorealistic texture must still
            // render instead of holding every 3D tile in a black loading state.
            asynchronouslyLoadImagery: true,
          },
        );
        if (destroyed || viewer.isDestroyed()) return;
        tileset.show = true;
        googleTilesRef.current = tileset;
        googleReadyRef.current = false;

        const activateGoogleWhenReady = () => {
          if (destroyed || viewer.isDestroyed() || googleReadyRef.current) return;
          googleReadyRef.current = true;
          applyBaseMap(
            viewer,
            tileset,
            true,
            desiredMap(modeRef.current, sceneModeRef.current, mapStyleRef.current),
            mapRequestRef,
          );
        };
        // Register before adding the primitive so the initial-load signal can
        // never race past us on a fast connection/cache hit.
        tileset.initialTilesLoaded?.addEventListener?.(activateGoogleWhenReady);
        tileset.tileFailed?.addEventListener?.((failure) => {
          console.warn("OrbitWatch: a Google Photorealistic tile failed to load; raster Earth remains available underneath.", failure);
        });
        viewer.scene.primitives.add(tileset);

        // Do not drape Black Marble directly over Google 3D here. dayAlpha /
        // nightAlpha is a globe-lighting feature and can make the experimental
        // 3D-Tiles imagery path hide the underlying Google texture. Natural
        // Cesium sun/IBL lighting remains active on the photorealistic tiles.
        await applyBaseMap(
          viewer,
          tileset,
          false,
          desiredMap(modeRef.current, sceneModeRef.current, mapStyleRef.current),
          mapRequestRef,
        );
      } catch (error) {
        if (!destroyed && attempt < 1) {
          window.setTimeout(() => loadGoogleEarth(attempt + 1), 1200);
          return;
        }
        console.warn("OrbitWatch: Google high-detail Earth unavailable; raster fallback will remain active.", error);
      }
    }
    loadGoogleEarth();

    for (const [name, longitude, latitude] of PLACE_LABELS) {
      const position = Cartesian3.fromDegrees(longitude, latitude, 4500);
      const labelId = `place-label-${name}`;
      viewer.entities.add({
        id: labelId,
        position,
        label: {
          show: new CallbackProperty(() => labelsEnabledRef.current, false),
          text: name,
          font: "600 16px Inter, system-ui, sans-serif",
          fillColor: Color.WHITE.withAlpha(0.9),
          outlineColor: Color.BLACK.withAlpha(0.9),
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cartesian2(0, -7),
          scaleByDistance: new NearFarScalar(800_000, 1.0, 22_000_000, 0.45),
          translucencyByDistance: new NearFarScalar(500_000, 0.95, 25_000_000, 0.15),
          distanceDisplayCondition: new DistanceDisplayCondition(150_000, 28_000_000),
        },
      });
      placeEntityIdsRef.current.push(labelId);
    }

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement) => {
      const picked = viewer.scene.pick(movement.position);
      const noradId = picked?.id?.properties?.noradId?.getValue?.();
      if (noradId) onObjectSelectRef.current?.(Number(noradId));
    }, ScreenSpaceEventType.LEFT_CLICK);

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
      if (now - lastViewTelemetryAtRef.current > 180) {
        lastViewTelemetryAtRef.current = now;
        const cameraCartographic = viewer.scene.globe.ellipsoid.cartesianToCartographic(viewer.camera.positionWC);
        onViewTelemetryRef.current?.({
          cameraAltitudeKm: cameraCartographic ? Math.max(0, cameraCartographic.height / 1000) : null,
          cursorLatitude: cursorGeoRef.current.latitude,
          cursorLongitude: cursorGeoRef.current.longitude,
        });
      }

      const follow = followStateRef.current;
      if (!follow) return;
      const data = entityMapRef.current.get(follow.noradId);
      const target = data?.entity?.position?.getValue?.(time);
      if (!target) return;
      const localOffset = Cartesian3.clone(viewer.camera.position);
      const range = Math.max(1, Cartesian3.magnitude(localOffset));
      if (range < 1) Cartesian3.multiplyByScalar(Cartesian3.normalize(localOffset, localOffset), 1, localOffset);
      const transform = Transforms.eastNorthUpToFixedFrame(target);
      viewer.camera.lookAtTransform(transform, localOffset);
    });

    return () => {
      destroyed = true;
      removePreRender();
      handler.destroy();
      viewer.destroy();
      viewerRef.current = null;
      googleTilesRef.current = null;
      googleReadyRef.current = false;
      entityMapRef.current.clear();
      placeEntityIdsRef.current = [];
      disasterEntityIdsRef.current = [];
      followStateRef.current = null;
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (mode === "time") {
      viewer.clock.currentTime = JulianDate.fromDate(selectedTime);
      viewer.clock.shouldAnimate = false;
    } else {
      viewer.clock.currentTime = JulianDate.now();
      viewer.clock.shouldAnimate = mode === "live";
    }
  }, [selectedTime, mode]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return undefined;
    releaseViewerCamera(viewer, followStateRef);

    const wants2D = mode === "disaster" && sceneMode === "2d";
    if (wants2D) viewer.scene.morphTo2D(0.42);
    else viewer.scene.morphTo3D(0.42);

    const timer = window.setTimeout(() => {
      if (!viewer.isDestroyed()) {
        applyBaseMap(viewer, googleTilesRef.current, googleReadyRef.current, desiredMap(mode, sceneMode, mapStyleRef.current), mapRequestRef);
        setCameraPreset(viewer, "earth", followStateRef, null);
      }
    }, 470);
    return () => window.clearTimeout(timer);
  }, [mode, sceneMode]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    applyBaseMap(viewer, googleTilesRef.current, googleReadyRef.current, desiredMap(mode, sceneMode, mapStyle), mapRequestRef);
  }, [mapStyle, mode, sceneMode]);

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
        viewer.entities.remove(data.orbitEntity);
        entityMap.delete(noradId);
        if (followStateRef.current?.noradId === noradId) releaseViewerCamera(viewer, followStateRef);
      }
    }

    const idsToLoad = trackedIds.filter((noradId) => refreshAll || !entityMap.has(noradId));

    async function loadOne(noradId) {
      const object = getSpaceObject(noradId);
      try {
        const trajectory = await fetchFullOrbit(noradId, controller.signal);
        if (!trajectory?.positions?.length || controller.signal.aborted || viewer.isDestroyed()) return;

        const sampled = new SampledPositionProperty();
        const orbitPositions = [];
        const firstSampleTime = JulianDate.fromIso8601(trajectory.positions[0].timestamp);

        // The backend returns geographic positions in Earth's rotating frame.
        // A raw polyline through those samples looks like a drifting ground
        // track, not the orbital plane the user expects. Express every guide
        // point in the Earth orientation at the first sample. The moving entity
        // still uses its true timestamped fixed-frame positions, while the dim
        // guide becomes one continuous inertial revolution around Earth.
        await icrfReadyRef.current;
        const icrfToReferenceFixed = Transforms.computeIcrfToFixedMatrix(firstSampleTime, new Matrix3());

        for (const position of trajectory.positions) {
          const sampleTime = JulianDate.fromIso8601(position.timestamp);
          const fixedPoint = Cartesian3.fromDegrees(position.longitude, position.latitude, position.altitude_km * 1000);
          sampled.addSample(sampleTime, fixedPoint);

          const fixedToIcrf = Transforms.computeFixedToIcrfMatrix(sampleTime, new Matrix3());
          if (fixedToIcrf && icrfToReferenceFixed) {
            const inertialPoint = Matrix3.multiplyByVector(fixedToIcrf, fixedPoint, new Cartesian3());
            orbitPositions.push(Matrix3.multiplyByVector(icrfToReferenceFixed, inertialPoint, new Cartesian3()));
          } else {
            orbitPositions.push(Cartesian3.clone(fixedPoint));
          }
        }

        const existing = entityMap.get(noradId);
        const wasFollowing = followStateRef.current?.noradId === noradId;
        if (existing) {
          viewer.entities.remove(existing.entity);
          viewer.entities.remove(existing.orbitEntity);
        }

        const selected = noradId === selectedIdRef.current;
        const color = CATEGORY_COLORS[object?.category] || Color.WHITE;
        const colorCss = color.toCssColorString();
        const period = trajectory.orbitalPeriodSeconds || estimateOrbitalPeriodSeconds(trajectory.positions);

        const orbitEntity = viewer.entities.add({
          name: `${object?.name || trajectory.name} propagated orbit`,
          properties: { noradId },
          show: shownOrbitIdsRef.current.has(noradId),
          polyline: {
            positions: orbitPositions,
            width: selected ? 2.0 : 1.05,
            material: color.withAlpha(selected ? 0.6 : 0.26),
            arcType: ArcType.NONE,
          },
        });

        const entity = viewer.entities.add({
          name: object?.name || trajectory.name,
          availability: makeAvailability(trajectory.positions),
          position: sampled,
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
            distanceDisplayCondition: new DistanceDisplayCondition(0, 9_000_000),
            scaleByDistance: new NearFarScalar(25_000, 1.35, 8_500_000, 0.55),
          },
          path: {
            leadTime: period * 0.18,
            trailTime: period * 0.07,
            width: selected ? 2.7 : 1.25,
            material: color.withAlpha(selected ? 0.95 : 0.5),
            resolution: Math.max(5, Math.round(period / 280)),
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

        entityMap.set(noradId, { entity, orbitEntity, trajectory, period });
        if (wasFollowing) {
          followStateRef.current = { noradId };
        }
      } catch (error) {
        if (error?.name !== "AbortError") console.warn(`OrbitWatch: orbit load failed for ${noradId}`, error);
      }
    }

    runWithConcurrency(idsToLoad, loadOne, 4);
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
      if (data.entity.path) {
        data.entity.path.width = selected ? 2.7 : 1.25;
        const color = CATEGORY_COLORS[getSpaceObject(noradId)?.category] || Color.WHITE;
        data.entity.path.material = color.withAlpha(selected ? 0.95 : 0.5);
      }
      if (data.orbitEntity?.polyline) {
        const color = CATEGORY_COLORS[getSpaceObject(noradId)?.category] || Color.WHITE;
        data.orbitEntity.polyline.width = selected ? 2.0 : 1.05;
        data.orbitEntity.polyline.material = color.withAlpha(selected ? 0.6 : 0.26);
      }
    }
  }, [selectedId]);

  useEffect(() => {
    for (const [noradId, data] of entityMapRef.current.entries()) {
      data.orbitEntity.show = shownOrbitIds.has(noradId);
    }
  }, [shownOrbitIds]);

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

  return <div className="orbit-globe" ref={mountRef} />;
}
