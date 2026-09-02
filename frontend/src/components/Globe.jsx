import { useEffect, useRef } from "react";
import {
  ArcType,
  Cartesian2,
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  HeadingPitchRange,
  Ion,
  Iso8601,
  JulianDate,
  LagrangePolynomialApproximation,
  NearFarScalar,
  PolylineGlowMaterialProperty,
  SampledPositionProperty,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  TimeInterval,
  VerticalOrigin,
  Viewer,
  defined,
} from "cesium";
import {
  fetchFullOrbit,
  fetchTrajectoryBatch,
} from "../services/orbitwatchApi.js";
import "./Globe.css";
import "cesium/Build/Cesium/Widgets/widgets.css";

const cesiumToken = import.meta.env.VITE_CESIUM_ION_TOKEN;

const TRAIL_STYLES = [
  {
    name: "outer",
    trailTime: 95,
    width: 15,
    glowPower: 0.36,
    color: Color.CYAN.withAlpha(0.055),
  },
  {
    name: "middle",
    trailTime: 58,
    width: 7,
    glowPower: 0.26,
    color: Color.CYAN.withAlpha(0.18),
  },
  {
    name: "core",
    trailTime: 22,
    width: 2.2,
    glowPower: 0.12,
    color: Color.WHITE.withAlpha(0.9),
  },
];

function createPositionProperty() {
  const positionProperty = new SampledPositionProperty();

  positionProperty.setInterpolationOptions({
    interpolationDegree: 2,
    interpolationAlgorithm: LagrangePolynomialApproximation,
  });

  return positionProperty;
}

function addTrajectorySamples(positionProperty, trajectoryPositions) {
  for (const trajectoryPosition of trajectoryPositions) {
    const sampleTime = JulianDate.fromIso8601(trajectoryPosition.timestamp);
    const samplePosition = Cartesian3.fromDegrees(
      trajectoryPosition.longitude,
      trajectoryPosition.latitude,
      trajectoryPosition.altitude_km * 1000,
    );

    positionProperty.addSample(sampleTime, samplePosition);
  }
}

function removeExpiredSamples(positionProperty, currentTime) {
  const sampleCutoff = JulianDate.addSeconds(
    currentTime,
    -35,
    new JulianDate(),
  );

  positionProperty.removeSamples(
    new TimeInterval({
      start: Iso8601.MINIMUM_VALUE,
      stop: sampleCutoff,
    }),
  );
}

function createTrailEntities(viewer, noradId, positionProperty) {
  return TRAIL_STYLES.map((trailStyle) =>
    viewer.entities.add({
      id: `trail-${trailStyle.name}-${noradId}`,
      position: positionProperty,
      path: {
        show: false,
        leadTime: 0,
        trailTime: trailStyle.trailTime,
        width: trailStyle.width,
        resolution: 1,
        material: new PolylineGlowMaterialProperty({
          glowPower: trailStyle.glowPower,
          taperPower: 0.76,
          color: trailStyle.color,
        }),
      },
      properties: {
        noradId,
      },
    }),
  );
}

function createMarkerEntity(viewer, trajectory, positionProperty) {
  return viewer.entities.add({
    id: `space-object-${trajectory.norad_id}`,
    position: positionProperty,
    point: {
      pixelSize: 4.5,
      color: Color.fromCssColorString("#a8c0cc").withAlpha(0.8),
      outlineColor: Color.BLACK.withAlpha(0.55),
      outlineWidth: 1,
      scaleByDistance: new NearFarScalar(1.0e6, 1.25, 5.0e7, 0.62),
      distanceDisplayCondition: new DistanceDisplayCondition(0, 8.0e7),
    },
    label: {
      text: `${trajectory.name} · ${trajectory.norad_id}`,
      show: false,
      font: "500 12px system-ui",
      fillColor: Color.WHITE,
      showBackground: true,
      backgroundColor: Color.BLACK.withAlpha(0.64),
      backgroundPadding: new Cartesian2(8, 5),
      pixelOffset: new Cartesian2(0, -23),
      verticalOrigin: VerticalOrigin.BOTTOM,
    },
    properties: {
      noradId: trajectory.norad_id,
    },
  });
}

function Globe({
  spaceObjects,
  focusedNoradId,
  showFocusedOrbit,
  onSpaceObjectData,
  onSpaceObjectSelect,
  onConnectionStateChange,
}) {
  const globeContainerRef = useRef(null);
  const viewerRef = useRef(null);
  const objectDataMapRef = useRef(new Map());
  const metadataMapRef = useRef(new Map());
  const activeNoradIdsRef = useRef([]);
  const focusedNoradIdRef = useRef(focusedNoradId);
  const showFocusedOrbitRef = useRef(showFocusedOrbit);
  const spaceObjectDataCallbackRef = useRef(onSpaceObjectData);
  const spaceObjectSelectCallbackRef = useRef(onSpaceObjectSelect);
  const connectionCallbackRef = useRef(onConnectionStateChange);
  const refreshAllObjectsRef = useRef(null);
  const focusObjectRef = useRef(null);
  const fullOrbitEntitiesRef = useRef([]);

  useEffect(() => {
    metadataMapRef.current = new Map(
      spaceObjects.map((spaceObject) => [
        Number(spaceObject.noradId),
        spaceObject,
      ]),
    );
    activeNoradIdsRef.current = spaceObjects.map((spaceObject) =>
      Number(spaceObject.noradId),
    );
    refreshAllObjectsRef.current?.();
  }, [spaceObjects]);

  useEffect(() => {
    spaceObjectDataCallbackRef.current = onSpaceObjectData;
  }, [onSpaceObjectData]);

  useEffect(() => {
    spaceObjectSelectCallbackRef.current = onSpaceObjectSelect;
  }, [onSpaceObjectSelect]);

  useEffect(() => {
    connectionCallbackRef.current = onConnectionStateChange;
  }, [onConnectionStateChange]);

  useEffect(() => {
    focusedNoradIdRef.current = focusedNoradId;

    if (focusedNoradId !== null && focusedNoradId !== undefined) {
      focusObjectRef.current?.(Number(focusedNoradId));
    }
  }, [focusedNoradId]);

  useEffect(() => {
    showFocusedOrbitRef.current = showFocusedOrbit;

    for (const orbitEntity of fullOrbitEntitiesRef.current) {
      orbitEntity.show = showFocusedOrbit;
    }
  }, [showFocusedOrbit]);

  useEffect(() => {
    Ion.defaultAccessToken = cesiumToken;

    const viewer = new Viewer(globeContainerRef.current, {
      animation: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      shouldAnimate: true,
    });

    viewerRef.current = viewer;
    viewer.clock.shouldAnimate = true;
    viewer.scene.globe.enableLighting = true;
    viewer.scene.globe.depthTestAgainstTerrain = false;
    viewer.scene.fxaa = true;

    const objectDataMap = objectDataMapRef.current;
    let componentClosed = false;
    let refreshRunning = false;
    let fullOrbitRequestNumber = 0;

    function clearFullOrbit() {
      for (const orbitEntity of fullOrbitEntitiesRef.current) {
        viewer.entities.remove(orbitEntity);
      }

      fullOrbitEntitiesRef.current = [];
    }

    function createFocusedModel(noradId, objectData) {
      const objectMetadata = metadataMapRef.current.get(noradId);

      if (!objectMetadata?.modelUrl || objectData.modelEntity) {
        return;
      }

      objectData.modelEntity = viewer.entities.add({
        id: `model-${noradId}`,
        position: objectData.positionProperty,
        model: {
          uri: objectMetadata.modelUrl,
          minimumPixelSize: 42,
          maximumScale: 250000,
          runAnimations: true,
        },
        properties: {
          noradId,
        },
        show: false,
      });
    }

    function applyFocusAppearance() {
      const focusedId = Number(focusedNoradIdRef.current);

      for (const [noradId, objectData] of objectDataMap) {
        const objectFocused = noradId === focusedId;
        const objectMetadata = metadataMapRef.current.get(noradId);
        const focusedModelAvailable =
          objectFocused && Boolean(objectMetadata?.modelUrl);

        objectData.marker.point.show = !focusedModelAvailable;
        objectData.marker.point.pixelSize = objectFocused ? 14 : 4.5;
        objectData.marker.point.color = objectFocused
          ? Color.WHITE
          : Color.fromCssColorString("#a8c0cc").withAlpha(0.8);
        objectData.marker.point.outlineColor = objectFocused
          ? Color.CYAN.withAlpha(0.94)
          : Color.BLACK.withAlpha(0.55);
        objectData.marker.point.outlineWidth = objectFocused ? 3 : 1;
        objectData.marker.label.show = objectFocused;

        for (const trailEntity of objectData.trailEntities) {
          trailEntity.path.show = objectFocused;
        }

        if (objectData.modelEntity) {
          objectData.modelEntity.show = focusedModelAvailable;
        }
      }
    }

    async function drawFullOrbit(noradId) {
      const requestNumber = ++fullOrbitRequestNumber;
      clearFullOrbit();

      try {
        const orbitResponse = await fetchFullOrbit(noradId);

        if (
          componentClosed ||
          viewer.isDestroyed() ||
          requestNumber !== fullOrbitRequestNumber ||
          Number(focusedNoradIdRef.current) !== noradId
        ) {
          return;
        }

        const orbitPositions = orbitResponse.positions.map((position) =>
          Cartesian3.fromDegrees(
            position.longitude,
            position.latitude,
            position.altitude_km * 1000,
          ),
        );

        const orbitGlow = viewer.entities.add({
          id: `full-orbit-glow-${noradId}`,
          polyline: {
            positions: orbitPositions,
            width: 7,
            arcType: ArcType.NONE,
            material: new PolylineGlowMaterialProperty({
              glowPower: 0.33,
              taperPower: 1,
              color: Color.CYAN.withAlpha(0.07),
            }),
          },
          show: showFocusedOrbitRef.current,
        });

        const orbitCore = viewer.entities.add({
          id: `full-orbit-core-${noradId}`,
          polyline: {
            positions: orbitPositions,
            width: 1.1,
            arcType: ArcType.NONE,
            material: Color.CYAN.withAlpha(0.25),
          },
          show: showFocusedOrbitRef.current,
        });

        fullOrbitEntitiesRef.current = [orbitGlow, orbitCore];
      } catch {
        // The focused full-orbit endpoint will be connected in the backend phase.
      }
    }

    async function focusObject(noradId) {
      focusedNoradIdRef.current = noradId;
      const objectData = objectDataMap.get(noradId);

      if (!objectData) {
        return;
      }

      createFocusedModel(noradId, objectData);
      applyFocusAppearance();
      drawFullOrbit(noradId);

      const cameraRange = Math.max(
        7200000,
        ((objectData.latestAltitudeKm ?? 500) + 6371) * 1000 * 1.15,
      );

      try {
        await viewer.flyTo(objectData.marker, {
          duration: 1.2,
          offset: new HeadingPitchRange(0, -0.48, cameraRange),
        });
      } catch {
        // A new focus can interrupt an existing camera flight.
      }
    }

    focusObjectRef.current = focusObject;

    function createObjectData(trajectory) {
      const noradId = Number(trajectory.norad_id);
      const positionProperty = createPositionProperty();
      const marker = createMarkerEntity(viewer, trajectory, positionProperty);
      const trailEntities = createTrailEntities(
        viewer,
        noradId,
        positionProperty,
      );

      const objectData = {
        marker,
        modelEntity: null,
        positionProperty,
        trailEntities,
        latestAltitudeKm: null,
      };

      objectDataMap.set(noradId, objectData);
      return objectData;
    }

    function updateObjectFromTrajectory(trajectory) {
      const noradId = Number(trajectory.norad_id);
      const objectData =
        objectDataMap.get(noradId) ?? createObjectData(trajectory);

      addTrajectorySamples(objectData.positionProperty, trajectory.positions);
      removeExpiredSamples(objectData.positionProperty, viewer.clock.currentTime);

      objectData.latestAltitudeKm = trajectory.positions[0]?.altitude_km ?? null;

      spaceObjectDataCallbackRef.current?.(noradId, {
        ...trajectory,
        receivedAt: new Date().toISOString(),
      });
    }

    async function refreshAllSpaceObjects() {
      const activeNoradIds = activeNoradIdsRef.current;

      if (componentClosed || refreshRunning || activeNoradIds.length === 0) {
        return;
      }

      refreshRunning = true;
      connectionCallbackRef.current?.("connecting");

      try {
        const trajectoryResponse = await fetchTrajectoryBatch(activeNoradIds);

        for (const trajectory of trajectoryResponse.objects ?? []) {
          updateObjectFromTrajectory(trajectory);
        }

        applyFocusAppearance();
        connectionCallbackRef.current?.("online");
      } catch {
        connectionCallbackRef.current?.("offline");
      } finally {
        refreshRunning = false;
      }
    }

    refreshAllObjectsRef.current = refreshAllSpaceObjects;
    refreshAllSpaceObjects();

    const refreshInterval = window.setInterval(
      refreshAllSpaceObjects,
      60000,
    );

    const clickHandler = new ScreenSpaceEventHandler(viewer.scene.canvas);

    clickHandler.setInputAction((movement) => {
      const pickedObject = viewer.scene.pick(movement.position);

      if (!defined(pickedObject) || !defined(pickedObject.id)) {
        return;
      }

      const noradIdProperty = pickedObject.id.properties?.noradId;

      if (!noradIdProperty) {
        return;
      }

      const selectedNoradId = Number(
        noradIdProperty.getValue(viewer.clock.currentTime),
      );

      spaceObjectSelectCallbackRef.current?.(selectedNoradId);
    }, ScreenSpaceEventType.LEFT_CLICK);

    return () => {
      componentClosed = true;
      refreshAllObjectsRef.current = null;
      focusObjectRef.current = null;
      window.clearInterval(refreshInterval);
      clickHandler.destroy();
      clearFullOrbit();
      objectDataMap.clear();
      viewerRef.current = null;

      if (!viewer.isDestroyed()) {
        viewer.destroy();
      }
    };
  }, []);

  return <div className="globe-container" ref={globeContainerRef} />;
}

export default Globe;
