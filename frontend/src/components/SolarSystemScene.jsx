import { useEffect, useRef } from "react";
import {
  BoundingSphere,
  Cartesian3,
  Color,
  HeadingPitchRange,
  HeadingPitchRoll,
  Math as CesiumMath,
  Matrix4,
  Material,
  PointPrimitiveCollection,
  PolylineCollection,
  Transforms,
  Viewer,
} from "cesium";
import "./SolarSystemScene.css";

const TAU = Math.PI * 2;
const UNIT = 1_000_000;
const BODY_UNIT = 8.5 * UNIT;
const MOON_UNIT = 4.5 * UNIT;
const START_DISTANCE = 2_150 * UNIT;
const UPDATE_INTERVAL_MS = 220;
const ORBIT_GEOMETRY_INTERVAL_MS = 1000;

const PLANETS = [
  { name: "Mercury", orbit: 240, radius: 2.4, color: "#a8a29b", period: 230, tilt: 7.0, spin: 55 },
  { name: "Venus", orbit: 365, radius: 4.2, color: "#d6b67d", period: 310, tilt: 3.4, spin: 76 },
  { name: "Earth", orbit: 500, radius: 4.6, color: "#4d9ff5", period: 390, tilt: 0.0, spin: 42 },
  { name: "Mars", orbit: 650, radius: 3.2, color: "#d17859", period: 475, tilt: 1.9, spin: 45 },
  {
    name: "Jupiter", orbit: 860, radius: 9.4, color: "#d5ad88", period: 620, tilt: 1.3, spin: 30,
    rings: [
      { ratio: 1.55, alpha: 0.17, color: "#bba896", tilt: 3.1 },
      { ratio: 2.25, alpha: 0.11, color: "#9f8b7e", tilt: 3.1 },
      { ratio: 3.00, alpha: 0.065, color: "#887267", tilt: 3.1 },
    ],
  },
  {
    name: "Saturn", orbit: 1_080, radius: 8.7, color: "#dfc98d", period: 760, tilt: 2.5, spin: 33,
    rings: [
      { ratio: 1.28, alpha: 0.26, color: "#c9b387", tilt: 26.7 },
      { ratio: 1.70, alpha: 0.48, color: "#ead7a6", tilt: 26.7 },
      { ratio: 2.05, alpha: 0.38, color: "#f1e3ba", tilt: 26.7 },
      { ratio: 2.28, alpha: 0.20, color: "#9f865f", tilt: 26.7 },
    ],
  },
  {
    name: "Uranus", orbit: 1_300, radius: 6.2, color: "#8bd8de", period: 920, tilt: 0.8, spin: 38,
    rings: [
      { ratio: 1.60, alpha: 0.14, color: "#abcac8", tilt: 97.8 },
      { ratio: 1.80, alpha: 0.19, color: "#c2dfdc", tilt: 97.8 },
      { ratio: 2.00, alpha: 0.14, color: "#88b5b4", tilt: 97.8 },
    ],
  },
  {
    name: "Neptune", orbit: 1_520, radius: 6.0, color: "#5279ed", period: 1_080, tilt: 1.8, spin: 40,
    rings: [
      { ratio: 1.64, alpha: 0.11, color: "#727c9e", tilt: 28.3 },
      { ratio: 2.10, alpha: 0.14, color: "#9ea7c3", tilt: 28.3 },
      { ratio: 2.54, alpha: 0.10, color: "#b4bdd5", tilt: 28.3 },
    ],
  },
];

const DWARFS = [
  { name: "Ceres", orbit: 760, size: 4.2, color: "#bcb4ab", period: 430, tilt: 10.6 },
  { name: "Pluto", orbit: 1_385, size: 5.2, color: "#d8c9b8", period: 1_050, tilt: 17.0 },
  { name: "Orcus", orbit: 1_445, size: 3.7, color: "#d2cbd0", period: 1_090, tilt: 20.6 },
  { name: "Quaoar", orbit: 1_505, size: 3.8, color: "#a6b5ce", period: 1_130, tilt: 8.0 },
  { name: "Haumea", orbit: 1_570, size: 4.0, color: "#dfe2de", period: 1_190, tilt: 28.2 },
  { name: "Makemake", orbit: 1_635, size: 4.2, color: "#cbb395", period: 1_250, tilt: 29.0 },
  { name: "Gonggong", orbit: 1_700, size: 3.8, color: "#9e7066", period: 1_320, tilt: 30.6 },
  { name: "Eris", orbit: 1_770, size: 4.3, color: "#eef1f5", period: 1_390, tilt: 44.0 },
  { name: "Sedna", orbit: 1_870, size: 3.6, color: "#b76b5b", period: 1_520, tilt: 11.9 },
];

const MOONS = [
  { name: "Moon", parent: "Earth", orbit: 30, size: 3.4, color: "#dfe5e9", period: 58, tilt: 5.1 },
  { name: "Phobos", parent: "Mars", orbit: 17, size: 2.2, color: "#c7b5a3", period: 32, tilt: 1.1 },
  { name: "Deimos", parent: "Mars", orbit: 23, size: 2.0, color: "#afa696", period: 45, tilt: 1.8 },

  { name: "Io", parent: "Jupiter", orbit: 24, size: 3.0, color: "#f1d091", period: 39, tilt: 0.1 },
  { name: "Europa", parent: "Jupiter", orbit: 31, size: 2.8, color: "#d1c2ab", period: 47, tilt: 0.5 },
  { name: "Ganymede", parent: "Jupiter", orbit: 39, size: 3.2, color: "#9ca58c", period: 58, tilt: 0.2 },
  { name: "Callisto", parent: "Jupiter", orbit: 49, size: 3.0, color: "#7c7160", period: 72, tilt: 0.3 },

  { name: "Enceladus", parent: "Saturn", orbit: 23, size: 2.6, color: "#edf1f8", period: 42, tilt: 0.0 },
  { name: "Rhea", parent: "Saturn", orbit: 31, size: 2.7, color: "#c9ccd2", period: 54, tilt: 0.4 },
  { name: "Titan", parent: "Saturn", orbit: 42, size: 3.5, color: "#d5ac76", period: 66, tilt: 0.4 },
  { name: "Iapetus", parent: "Saturn", orbit: 53, size: 2.5, color: "#b8b0a7", period: 86, tilt: 7.5 },

  { name: "Ariel", parent: "Uranus", orbit: 24, size: 2.5, color: "#dfe6ee", period: 46, tilt: 0.3 },
  { name: "Titania", parent: "Uranus", orbit: 34, size: 2.8, color: "#b9c4d4", period: 60, tilt: 0.1 },
  { name: "Oberon", parent: "Uranus", orbit: 43, size: 2.7, color: "#9ea6b4", period: 74, tilt: 0.1 },

  { name: "Proteus", parent: "Neptune", orbit: 22, size: 2.3, color: "#9f9994", period: 43, tilt: 0.1 },
  { name: "Triton", parent: "Neptune", orbit: 34, size: 3.0, color: "#ded9d5", period: 62, tilt: 156.9 },

  { name: "Charon", parent: "Pluto", orbit: 18, size: 2.8, color: "#c4b9b1", period: 45, tilt: 0.1 },
  { name: "Nix", parent: "Pluto", orbit: 29, size: 2.0, color: "#ded0c6", period: 61, tilt: 0.2 },
  { name: "Hydra", parent: "Pluto", orbit: 36, size: 1.9, color: "#e6d9d0", period: 74, tilt: 0.2 },
];

const AUTH_SATELLITES = [
  { name: "ISS", parent: "Earth", orbit: 16, size: 2.8, color: "#85ddf8", period: 18, tilt: 51.6 },
  { name: "Hubble", parent: "Earth", orbit: 20, size: 2.3, color: "#9ebeff", period: 21, tilt: 28.5 },
  { name: "Tiangong", parent: "Earth", orbit: 23, size: 2.5, color: "#d0c2ff", period: 24, tilt: 41.5 },
  { name: "Landsat 8", parent: "Earth", orbit: 26, size: 2.2, color: "#81e8b5", period: 28, tilt: 98.2 },
];

function color(hex, alpha = 1) {
  return Color.fromCssColorString(hex).withAlpha(alpha);
}

function lineMaterial(hex, alpha = 1) {
  return Material.fromType("Color", {
    color: color(hex, alpha),
  });
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function rotateX(point, degrees) {
  const radians = CesiumMath.toRadians(degrees);
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return new Cartesian3(
    point.x,
    point.y * cosine - point.z * sine,
    point.y * sine + point.z * cosine,
  );
}

function positionOnOrbit(body, elapsedSeconds) {
  const angle = body.phase + (elapsedSeconds / body.period) * TAU;
  return rotateX(
    new Cartesian3(
      Math.cos(angle) * body.orbit * UNIT,
      Math.sin(angle) * body.orbit * UNIT,
      Math.sin(angle * 0.73 + body.phase) * body.orbit * UNIT * 0.018,
    ),
    body.tilt || 0,
  );
}

function localMoonPosition(body, elapsedSeconds) {
  const angle = body.phase + (elapsedSeconds / body.period) * TAU;
  return rotateX(
    new Cartesian3(
      Math.cos(angle) * body.orbit * MOON_UNIT,
      Math.sin(angle) * body.orbit * MOON_UNIT,
      0,
    ),
    body.tilt || 0,
  );
}

function add(a, b) {
  return new Cartesian3(a.x + b.x, a.y + b.y, a.z + b.z);
}

function circle(center, radius, tilt = 0, steps = 80) {
  const positions = [];
  for (let index = 0; index <= steps; index += 1) {
    const angle = (index / steps) * TAU;
    positions.push(
      add(
        center,
        rotateX(
          new Cartesian3(
            Math.cos(angle) * radius,
            Math.sin(angle) * radius,
            0,
          ),
          tilt,
        ),
      ),
    );
  }
  return positions;
}

function ringCircle(center, radius, tilt, steps = 96) {
  return circle(center, radius, tilt, steps);
}

export default function SolarSystemScene({ launching = false }) {
  const hostRef = useRef(null);
  const viewerRef = useRef(null);
  const launchedRef = useRef(false);
  const launchTimersRef = useRef([]);
  const bodyRefs = useRef(new Map());
  const pointRefs = useRef([]);
  const movingLinesRef = useRef([]);
  const stateRef = useRef(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const viewer = new Viewer(host, {
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      baseLayer: false,
      requestRenderMode: true,
      maximumRenderTimeChange: Number.POSITIVE_INFINITY,
      scene3DOnly: true,
      showRenderLoopErrors: false,
    });

    viewerRef.current = viewer;
    viewer.resolutionScale = 0.78;
    viewer.targetFrameRate = 30;

    const scene = viewer.scene;
    scene.globe.show = false;
    scene.sun.show = false;
    scene.moon.show = false;
    scene.skyAtmosphere.show = false;
    scene.backgroundColor = color("#01040a");
    scene.fog.enabled = false;
    scene.highDynamicRange = false;
    viewer.imageryLayers.removeAll();

    const controller = scene.screenSpaceCameraController;
    controller.enableInputs = true;
    controller.enableRotate = true;
    controller.enableTilt = true;
    controller.enableLook = true;
    controller.enableZoom = false;
    controller.enableTranslate = false;

    viewer.camera.lookAt(
      Cartesian3.ZERO,
      new HeadingPitchRange(
        CesiumMath.toRadians(-6),
        CesiumMath.toRadians(-18),
        START_DISTANCE,
      ),
    );

    const random = seededRandom(Date.now() % 4_294_967_295);
    const planets = PLANETS.map((body) => ({ ...body, phase: random() * TAU }));
    const dwarfs = DWARFS.map((body) => ({ ...body, phase: random() * TAU }));
    const moons = [...MOONS, ...AUTH_SATELLITES].map((body) => ({
      ...body,
      phase: random() * TAU,
    }));

    const bodyByName = new Map([
      ...planets.map((body) => [body.name, body]),
      ...dwarfs.map((body) => [body.name, body]),
    ]);

    const pointCollection = scene.primitives.add(new PointPrimitiveCollection());
    const lineCollection = scene.primitives.add(new PolylineCollection());

    // Static heliocentric orbit guides.
    [...planets, ...dwarfs].forEach((body) => {
      lineCollection.add({
        positions: circle(
          Cartesian3.ZERO,
          body.orbit * UNIT,
          body.tilt || 0,
          96,
        ),
        width: body.name === "Earth" ? 1.0 : 0.65,
        material: lineMaterial(
          "#69c8e7",
          body.name === "Earth" ? 0.09 : 0.038,
        ),
      });
    });

    // Main asteroid belt: static point primitives are dramatically cheaper than
    // hundreds of dynamic Entity/CallbackProperty objects.
    for (let index = 0; index < 125; index += 1) {
      const radius = (465 + random() * 170) * UNIT;
      const angle = random() * TAU;
      const tilt = CesiumMath.toRadians(-8 + random() * 16);
      const point = rotateX(
        new Cartesian3(
          Math.cos(angle) * radius,
          Math.sin(angle) * radius,
          (random() - 0.5) * 22 * UNIT,
        ),
        CesiumMath.toDegrees(tilt),
      );
      pointCollection.add({
        position: point,
        pixelSize: 1.0 + random() * 1.2,
        color: color(random() > 0.45 ? "#b7a58f" : "#837b73", 0.48),
      });
    }

    // Outer / Kuiper-style belt.
    for (let index = 0; index < 155; index += 1) {
      const radius = (1_610 + random() * 370) * UNIT;
      const angle = random() * TAU;
      const point = rotateX(
        new Cartesian3(
          Math.cos(angle) * radius,
          Math.sin(angle) * radius,
          (random() - 0.5) * 75 * UNIT,
        ),
        -16 + random() * 32,
      );
      pointCollection.add({
        position: point,
        pixelSize: 0.9 + random() * 1.0,
        color: color(random() > 0.6 ? "#9da9ca" : "#cfd5df", 0.36),
      });
    }

    viewer.entities.add({
      name: "Sun",
      position: Cartesian3.ZERO,
      ellipsoid: {
        radii: new Cartesian3(
          BODY_UNIT * 11.5,
          BODY_UNIT * 11.5,
          BODY_UNIT * 11.5,
        ),
        material: color("#ffd878", 1),
        outline: false,
      },
    });

    // Only the eight planets are ellipsoid Entities.  This keeps the scene
    // visibly planetary without forcing Cesium's Entity system to manage the
    // entire asteroid/moon population every frame.
    planets.forEach((body) => {
      const entity = viewer.entities.add({
        name: body.name,
        position: positionOnOrbit(body, 0),
        ellipsoid: {
          radii: new Cartesian3(
            BODY_UNIT * body.radius,
            BODY_UNIT * body.radius,
            BODY_UNIT * body.radius,
          ),
          material: color(body.color, 1),
          outline: false,
        },
      });
      bodyRefs.current.set(body.name, { entity, body });

      body.rings?.forEach((ring) => {
        const center = positionOnOrbit(body, 0);
        const polyline = lineCollection.add({
          positions: ringCircle(
            center,
            BODY_UNIT * body.radius * ring.ratio,
            ring.tilt,
          ),
          width: body.name === "Saturn" ? 1.45 : 0.95,
          material: lineMaterial(ring.color, ring.alpha),
        });
        movingLinesRef.current.push({
          type: "ring",
          parent: body.name,
          body,
          ring,
          polyline,
        });
      });
    });

    // Dwarf planets remain visible as moving points. No labels by design.
    dwarfs.forEach((body) => {
      const point = pointCollection.add({
        position: positionOnOrbit(body, 0),
        pixelSize: body.size,
        color: color(body.color, 0.82),
        outlineColor: color("#eefaff", 0.12),
        outlineWidth: 1,
      });
      pointRefs.current.push({ type: "dwarf", body, point });
      bodyRefs.current.set(body.name, { point, body });
    });

    moons.forEach((body) => {
      const parentBody = bodyByName.get(body.parent);
      if (!parentBody) return;

      const parentPosition = positionOnOrbit(parentBody, 0);
      const point = pointCollection.add({
        position: add(parentPosition, localMoonPosition(body, 0)),
        pixelSize: body.size,
        color: color(body.color, body.name === "ISS" ? 0.94 : 0.74),
        outlineColor: color("#eefaff", 0.09),
        outlineWidth: 1,
      });

      pointRefs.current.push({
        type: "moon",
        body,
        parentBody,
        point,
      });

      const moonOrbit = lineCollection.add({
        positions: circle(
          parentPosition,
          body.orbit * MOON_UNIT,
          body.tilt || 0,
          42,
        ),
        width: AUTH_SATELLITES.some((item) => item.name === body.name)
          ? 0.75
          : 0.55,
        material: lineMaterial(
          "#d9e7ef",
          AUTH_SATELLITES.some((item) => item.name === body.name)
            ? 0.105
            : 0.052,
        ),
      });

      movingLinesRef.current.push({
        type: "moonOrbit",
        body,
        parentBody,
        polyline: moonOrbit,
      });
    });

    stateRef.current = {
      planets,
      dwarfs,
      moons,
      startedAt: performance.now(),
    };

    let geometryTick = 0;

    const update = () => {
      const elapsed = (performance.now() - stateRef.current.startedAt) / 1000;

      planets.forEach((body) => {
        const record = bodyRefs.current.get(body.name);
        if (!record?.entity) return;

        const position = positionOnOrbit(body, elapsed);
        record.entity.position = position;

        // Kept for the later textured-planet pass; harmless with flat colours.
        record.entity.orientation = Transforms.headingPitchRollQuaternion(
          position,
          new HeadingPitchRoll(
            (elapsed / body.spin) * TAU,
            CesiumMath.toRadians(body.tilt || 0),
            0,
          ),
        );
      });

      pointRefs.current.forEach((record) => {
        if (record.type === "dwarf") {
          record.point.position = positionOnOrbit(record.body, elapsed);
          return;
        }

        const parentPosition = positionOnOrbit(record.parentBody, elapsed);
        record.point.position = add(
          parentPosition,
          localMoonPosition(record.body, elapsed),
        );
      });

      geometryTick += UPDATE_INTERVAL_MS;
      if (geometryTick >= ORBIT_GEOMETRY_INTERVAL_MS) {
        geometryTick = 0;

        movingLinesRef.current.forEach((record) => {
          if (record.type === "ring") {
            const center = positionOnOrbit(record.body, elapsed);
            record.polyline.positions = ringCircle(
              center,
              BODY_UNIT * record.body.radius * record.ring.ratio,
              record.ring.tilt,
            );
            return;
          }

          const parentPosition = positionOnOrbit(record.parentBody, elapsed);
          record.polyline.positions = circle(
            parentPosition,
            record.body.orbit * MOON_UNIT,
            record.body.tilt || 0,
            42,
          );
        });
      }

      scene.requestRender();
    };

    update();
    const animationTimer = window.setInterval(update, UPDATE_INTERVAL_MS);

    return () => {
      window.clearInterval(animationTimer);
      launchTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      launchTimersRef.current = [];
      bodyRefs.current.clear();
      pointRefs.current = [];
      movingLinesRef.current = [];
      stateRef.current = null;
      viewerRef.current = null;
      if (!viewer.isDestroyed()) viewer.destroy();
    };
  }, []);

  useEffect(() => {
    if (!launching || launchedRef.current) return undefined;

    const viewer = viewerRef.current;
    const earthRecord = bodyRefs.current.get("Earth");
    if (!viewer || !earthRecord?.entity) return undefined;

    launchedRef.current = true;
    viewer.scene.screenSpaceCameraController.enableInputs = false;
    viewer.camera.cancelFlight();
    viewer.camera.lookAtTransform(Matrix4.IDENTITY);

    const startedAt = performance.now();
    const ZOOM_END_MS = 4_700;
    const TOTAL_MS = 6_350;

    const initialEarth = earthRecord.entity.position.getValue(viewer.clock.currentTime);
    const initialRange = Math.max(
      Cartesian3.distance(viewer.camera.positionWC, initialEarth),
      BODY_UNIT * 70,
    );
    const finalRange = BODY_UNIT * 21;

    function clamp01(value) {
      return Math.min(1, Math.max(0, value));
    }

    function easeInOut(value) {
      const t = clamp01(value);
      return t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function easeOut(value) {
      const t = clamp01(value);
      return 1 - Math.pow(1 - t, 3);
    }

    let frameId = 0;

    const animateCamera = (now) => {
      const elapsed = now - startedAt;
      const activeViewer = viewerRef.current;
      const activeEarth = bodyRefs.current.get("Earth");
      if (!activeViewer || !activeEarth?.entity) return;

      const earthPosition = activeEarth.entity.position.getValue(activeViewer.clock.currentTime);

      const zoomT = easeInOut(elapsed / ZOOM_END_MS);
      const range = initialRange + (finalRange - initialRange) * zoomT;

      // Slight rotation from the beginning.
      const gentleRotation =
        CesiumMath.toRadians(14) * easeOut(elapsed / ZOOM_END_MS);

      // Stronger rotation starts late, overlaps the last part of zoom, then
      // continues ~1.6s after the zoom has already reached its target.
      const lateRotationT = easeInOut(
        (elapsed - 3_150) / (TOTAL_MS - 3_150),
      );
      const heading =
        gentleRotation + CesiumMath.toRadians(76) * lateRotationT;

      const pitch =
        CesiumMath.toRadians(-13) +
        CesiumMath.toRadians(-14) * easeOut(elapsed / TOTAL_MS);

      activeViewer.camera.lookAt(
        earthPosition,
        new HeadingPitchRange(heading, pitch, range),
      );
      activeViewer.scene.requestRender();

      if (elapsed < TOTAL_MS) {
        frameId = window.requestAnimationFrame(animateCamera);
      }
    };

    frameId = window.requestAnimationFrame(animateCamera);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [launching]);

  return (
    <div className={`solar-auth-scene ${launching ? "is-launching" : ""}`}>
      <div ref={hostRef} className="solar-auth-scene__cesium" />
      <div className="solar-auth-scene__vignette" />
    </div>
  );
}
