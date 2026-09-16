import { useEffect, useRef } from "react";
import "./SolarSystemScene.css";

const TAU = Math.PI * 2;
const BODY_SCALE = 8.5;
const MOON_SCALE = 4.5;
const START_DISTANCE = 2150;
const FINAL_DISTANCE = 145;
const LAUNCH_ZOOM_END_MS = 4700;
const LAUNCH_TOTAL_MS = 6350;

const PLANETS = [
  { name: "Mercury", orbit: 240, radius: 2.4, color: "#a8a29b", period: 230, tilt: 7.0, spin: 55 },
  { name: "Venus", orbit: 365, radius: 4.2, color: "#d6b67d", period: 310, tilt: 3.4, spin: 76 },
  { name: "Earth", orbit: 500, radius: 4.6, color: "#4d9ff5", period: 390, tilt: 0.0, spin: 42 },
  { name: "Mars", orbit: 650, radius: 3.2, color: "#d17859", period: 475, tilt: 1.9, spin: 45 },
  { name: "Jupiter", orbit: 860, radius: 9.4, color: "#d5ad88", period: 620, tilt: 1.3, spin: 30, rings: [1.55, 2.25, 3.0] },
  { name: "Saturn", orbit: 1080, radius: 8.7, color: "#dfc98d", period: 760, tilt: 2.5, spin: 33, rings: [1.28, 1.70, 2.05, 2.28] },
  { name: "Uranus", orbit: 1300, radius: 6.2, color: "#8bd8de", period: 920, tilt: 0.8, spin: 38, rings: [1.60, 1.80, 2.00] },
  { name: "Neptune", orbit: 1520, radius: 6.0, color: "#5279ed", period: 1080, tilt: 1.8, spin: 40, rings: [1.64, 2.10, 2.54] },
];

const DWARFS = [
  { name: "Ceres", orbit: 760, size: 1.7, color: "#bcb4ab", period: 430, tilt: 10.6 },
  { name: "Pluto", orbit: 1385, size: 2.0, color: "#d8c9b8", period: 1050, tilt: 17.0 },
  { name: "Orcus", orbit: 1445, size: 1.45, color: "#d2cbd0", period: 1090, tilt: 20.6 },
  { name: "Quaoar", orbit: 1505, size: 1.5, color: "#a6b5ce", period: 1130, tilt: 8.0 },
  { name: "Haumea", orbit: 1570, size: 1.55, color: "#dfe2de", period: 1190, tilt: 28.2 },
  { name: "Makemake", orbit: 1635, size: 1.6, color: "#cbb395", period: 1250, tilt: 29.0 },
  { name: "Gonggong", orbit: 1700, size: 1.45, color: "#9e7066", period: 1320, tilt: 30.6 },
  { name: "Eris", orbit: 1770, size: 1.7, color: "#eef1f5", period: 1390, tilt: 44.0 },
  { name: "Sedna", orbit: 1870, size: 1.35, color: "#b76b5b", period: 1520, tilt: 11.9 },
];

const MOONS = [
  { name: "Moon", parent: "Earth", orbit: 30, size: 2.2, color: "#dfe5e9", period: 58, tilt: 5.1 },
  { name: "Phobos", parent: "Mars", orbit: 17, size: 1.4, color: "#c7b5a3", period: 32, tilt: 1.1 },
  { name: "Deimos", parent: "Mars", orbit: 23, size: 1.25, color: "#afa696", period: 45, tilt: 1.8 },
  { name: "Io", parent: "Jupiter", orbit: 24, size: 1.8, color: "#f1d091", period: 39, tilt: 0.1 },
  { name: "Europa", parent: "Jupiter", orbit: 31, size: 1.7, color: "#d1c2ab", period: 47, tilt: 0.5 },
  { name: "Ganymede", parent: "Jupiter", orbit: 39, size: 1.9, color: "#9ca58c", period: 58, tilt: 0.2 },
  { name: "Callisto", parent: "Jupiter", orbit: 49, size: 1.8, color: "#7c7160", period: 72, tilt: 0.3 },
  { name: "Enceladus", parent: "Saturn", orbit: 23, size: 1.55, color: "#edf1f8", period: 42, tilt: 0.0 },
  { name: "Rhea", parent: "Saturn", orbit: 31, size: 1.65, color: "#c9ccd2", period: 54, tilt: 0.4 },
  { name: "Titan", parent: "Saturn", orbit: 42, size: 2.0, color: "#d5ac76", period: 66, tilt: 0.4 },
  { name: "Iapetus", parent: "Saturn", orbit: 53, size: 1.5, color: "#b8b0a7", period: 86, tilt: 7.5 },
  { name: "Ariel", parent: "Uranus", orbit: 24, size: 1.5, color: "#dfe6ee", period: 46, tilt: 0.3 },
  { name: "Titania", parent: "Uranus", orbit: 34, size: 1.7, color: "#b9c4d4", period: 60, tilt: 0.1 },
  { name: "Oberon", parent: "Uranus", orbit: 43, size: 1.6, color: "#9ea6b4", period: 74, tilt: 0.1 },
  { name: "Proteus", parent: "Neptune", orbit: 22, size: 1.4, color: "#9f9994", period: 43, tilt: 0.1 },
  { name: "Triton", parent: "Neptune", orbit: 34, size: 1.8, color: "#ded9d5", period: 62, tilt: 156.9 },
  { name: "Charon", parent: "Pluto", orbit: 18, size: 1.7, color: "#c4b9b1", period: 45, tilt: 0.1 },
  { name: "Nix", parent: "Pluto", orbit: 29, size: 1.2, color: "#ded0c6", period: 61, tilt: 0.2 },
  { name: "Hydra", parent: "Pluto", orbit: 36, size: 1.15, color: "#e6d9d0", period: 74, tilt: 0.2 },
  { name: "ISS", parent: "Earth", orbit: 16, size: 1.7, color: "#85ddf8", period: 18, tilt: 51.6 },
  { name: "Hubble", parent: "Earth", orbit: 20, size: 1.45, color: "#9ebeff", period: 21, tilt: 28.5 },
  { name: "Tiangong", parent: "Earth", orbit: 23, size: 1.55, color: "#d0c2ff", period: 24, tilt: 41.5 },
  { name: "Landsat 8", parent: "Earth", orbit: 26, size: 1.35, color: "#81e8b5", period: 28, tilt: 98.2 },
];

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

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

function rotateX(point, radians) {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return {
    x: point.x,
    y: point.y * c - point.z * s,
    z: point.y * s + point.z * c,
  };
}

function rotateView(point, yaw, pitch) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x1 = point.x * cy - point.z * sy;
  const z1 = point.x * sy + point.z * cy;

  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);

  return {
    x: x1,
    y: point.y * cp - z1 * sp,
    z: point.y * sp + z1 * cp,
  };
}

function orbitPosition(body, elapsed) {
  const angle = body.phase + (elapsed / body.period) * TAU;
  return rotateX(
    {
      x: Math.cos(angle) * body.orbit,
      y: Math.sin(angle) * body.orbit,
      z: Math.sin(angle * 0.73 + body.phase) * body.orbit * 0.018,
    },
    (body.tilt || 0) * Math.PI / 180,
  );
}

function localMoonPosition(body, elapsed) {
  const angle = body.phase + (elapsed / body.period) * TAU;
  return rotateX(
    {
      x: Math.cos(angle) * body.orbit * MOON_SCALE,
      y: Math.sin(angle) * body.orbit * MOON_SCALE,
      z: 0,
    },
    (body.tilt || 0) * Math.PI / 180,
  );
}

function add(a, b) {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  };
}

function lerpPoint(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

export default function SolarSystemScene({ launching = false }) {
  const canvasRef = useRef(null);
  const launchingRef = useRef(launching);
  const launchStartedAtRef = useRef(null);

  useEffect(() => {
    launchingRef.current = launching;
    if (launching) {
      launchStartedAtRef.current = performance.now();
    } else {
      launchStartedAtRef.current = null;
    }
  }, [launching]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return undefined;

    const random = seededRandom(0x0b17cafe);
    const planets = PLANETS.map((body) => ({ ...body, phase: random() * TAU }));
    const dwarfs = DWARFS.map((body) => ({ ...body, phase: random() * TAU }));
    const moons = MOONS.map((body) => ({ ...body, phase: random() * TAU }));
    const bodyByName = new Map([
      ...planets.map((body) => [body.name, body]),
      ...dwarfs.map((body) => [body.name, body]),
    ]);

    const stars = Array.from({ length: 420 }, () => ({
      x: random(),
      y: random(),
      size: 0.45 + random() * 1.25,
      alpha: 0.16 + random() * 0.56,
    }));

    const beltPoints = [];
    for (let index = 0; index < 125; index += 1) {
      const radius = 465 + random() * 170;
      const angle = random() * TAU;
      beltPoints.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        z: (random() - 0.5) * 22,
        color: random() > 0.45 ? "#b7a58f" : "#837b73",
        alpha: 0.34 + random() * 0.20,
        size: 0.55 + random() * 0.8,
      });
    }

    for (let index = 0; index < 155; index += 1) {
      const radius = 1610 + random() * 370;
      const angle = random() * TAU;
      beltPoints.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        z: (random() - 0.5) * 75,
        color: random() > 0.6 ? "#9da9ca" : "#cfd5df",
        alpha: 0.20 + random() * 0.15,
        size: 0.45 + random() * 0.7,
      });
    }

    const state = {
      width: 1,
      height: 1,
      dpr: 1,
      yaw: -0.10,
      pitch: -0.30,
      dragging: false,
      pointerId: null,
      lastX: 0,
      lastY: 0,
      startedAt: performance.now(),
      lastDrawAt: 0,
    };

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      state.width = rect.width;
      state.height = rect.height;
      state.dpr = dpr;
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    function currentView(now, elapsed) {
      const launchStart = launchStartedAtRef.current;
      const isLaunching = launchingRef.current && Number.isFinite(launchStart);

      let center = { x: 0, y: 0, z: 0 };
      let distance = START_DISTANCE;
      let yaw = state.yaw;
      let pitch = state.pitch;

      if (isLaunching) {
        const launchElapsed = now - launchStart;
        const earth = planets.find((body) => body.name === "Earth");
        const earthPosition = orbitPosition(earth, elapsed);
        const zoomT = easeInOut(launchElapsed / LAUNCH_ZOOM_END_MS);
        const lateT = easeInOut((launchElapsed - 3150) / (LAUNCH_TOTAL_MS - 3150));

        center = lerpPoint({ x: 0, y: 0, z: 0 }, earthPosition, zoomT);
        distance = START_DISTANCE + (FINAL_DISTANCE - START_DISTANCE) * zoomT;
        yaw += (14 * Math.PI / 180) * easeOut(launchElapsed / LAUNCH_ZOOM_END_MS);
        yaw += (76 * Math.PI / 180) * lateT;
        pitch += (-14 * Math.PI / 180) * easeOut(launchElapsed / LAUNCH_TOTAL_MS);
      }

      return { center, distance, yaw, pitch };
    }

    function project(point, view) {
      const relative = {
        x: point.x - view.center.x,
        y: point.y - view.center.y,
        z: point.z - view.center.z,
      };

      const rotated = rotateView(relative, view.yaw, view.pitch);
      const depth = view.distance - rotated.z;

      if (depth <= 1) return null;

      const focal = Math.min(state.width, state.height) * 1.05;
      const scale = focal / depth;

      return {
        x: state.width * 0.5 + rotated.x * scale,
        y: state.height * 0.5 - rotated.y * scale,
        depth,
        scale,
      };
    }

    function drawOrbit(body, view) {
      context.beginPath();
      let started = false;

      for (let index = 0; index <= 72; index += 1) {
        const angle = index / 72 * TAU;
        const point = rotateX(
          {
            x: Math.cos(angle) * body.orbit,
            y: Math.sin(angle) * body.orbit,
            z: 0,
          },
          (body.tilt || 0) * Math.PI / 180,
        );

        const screen = project(point, view);
        if (!screen) continue;

        if (!started) {
          context.moveTo(screen.x, screen.y);
          started = true;
        } else {
          context.lineTo(screen.x, screen.y);
        }
      }

      context.strokeStyle = body.name === "Earth"
        ? "rgba(105,200,231,0.10)"
        : "rgba(105,200,231,0.040)";
      context.lineWidth = body.name === "Earth" ? 0.9 : 0.55;
      context.stroke();
    }

    function drawBody(body, position, view) {
      const screen = project(position, view);
      if (!screen) return;

      const radius = Math.max(1.2, body.radius * BODY_SCALE * screen.scale);
      if (radius < 0.2) return;

      if (body.rings?.length) {
        context.save();
        context.translate(screen.x, screen.y);
        context.rotate(-0.18);
        for (const ratio of body.rings) {
          context.beginPath();
          context.ellipse(0, 0, radius * ratio, radius * ratio * 0.28, 0, 0, TAU);
          context.strokeStyle = body.name === "Saturn"
            ? "rgba(231,212,169,0.28)"
            : "rgba(188,205,218,0.10)";
          context.lineWidth = body.name === "Saturn" ? 1.2 : 0.75;
          context.stroke();
        }
        context.restore();
      }

      const gradient = context.createRadialGradient(
        screen.x - radius * 0.34,
        screen.y - radius * 0.38,
        radius * 0.08,
        screen.x,
        screen.y,
        radius,
      );
      gradient.addColorStop(0, "rgba(255,255,255,0.96)");
      gradient.addColorStop(0.13, body.color);
      gradient.addColorStop(0.72, body.color);
      gradient.addColorStop(1, "rgba(3,8,14,0.92)");

      context.beginPath();
      context.arc(screen.x, screen.y, radius, 0, TAU);
      context.fillStyle = gradient;
      context.fill();
    }

    function draw(now) {
      const elapsed = (now - state.startedAt) / 1000;
      const view = currentView(now, elapsed);

      context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      context.fillStyle = "#01040a";
      context.fillRect(0, 0, state.width, state.height);

      for (const star of stars) {
        context.globalAlpha = star.alpha;
        context.fillStyle = "#e7eef7";
        context.fillRect(
          star.x * state.width,
          star.y * state.height,
          star.size,
          star.size,
        );
      }
      context.globalAlpha = 1;

      for (const body of [...planets, ...dwarfs]) {
        drawOrbit(body, view);
      }

      for (const point of beltPoints) {
        const screen = project(point, view);
        if (!screen) continue;
        context.globalAlpha = point.alpha;
        context.fillStyle = point.color;
        context.beginPath();
        context.arc(screen.x, screen.y, point.size, 0, TAU);
        context.fill();
      }
      context.globalAlpha = 1;

      const drawables = [];
      const currentPositions = new Map();

      for (const body of planets) {
        const position = orbitPosition(body, elapsed);
        currentPositions.set(body.name, position);
        const screen = project(position, view);
        if (screen) drawables.push({ kind: "planet", body, position, depth: screen.depth });
      }

      for (const body of dwarfs) {
        const position = orbitPosition(body, elapsed);
        currentPositions.set(body.name, position);
        const screen = project(position, view);
        if (screen) drawables.push({ kind: "point", body, position, depth: screen.depth });
      }

      for (const body of moons) {
        const parentBody = bodyByName.get(body.parent);
        const parentPosition = currentPositions.get(body.parent) || (parentBody ? orbitPosition(parentBody, elapsed) : null);
        if (!parentPosition) continue;
        const position = add(parentPosition, localMoonPosition(body, elapsed));
        const screen = project(position, view);
        if (screen) drawables.push({ kind: "point", body, position, depth: screen.depth });
      }

      drawables.sort((a, b) => b.depth - a.depth);

      for (const item of drawables) {
        if (item.kind === "planet") {
          drawBody(item.body, item.position, view);
          continue;
        }

        const screen = project(item.position, view);
        if (!screen) continue;
        const size = Math.max(0.7, item.body.size * Math.min(1.8, Math.max(0.7, screen.scale * 2.5)));
        context.globalAlpha = 0.74;
        context.fillStyle = item.body.color;
        context.beginPath();
        context.arc(screen.x, screen.y, size, 0, TAU);
        context.fill();
      }
      context.globalAlpha = 1;

      // Sun is always at the real center of this schematic scene.
      drawBody(
        { name: "Sun", radius: 11.5, color: "#ffd878", rings: null },
        { x: 0, y: 0, z: 0 },
        view,
      );
    }

    let frameId = 0;

    function frame(now) {
      const launchActive = launchingRef.current;
      const minimumInterval = launchActive ? 1000 / 60 : 1000 / 30;

      if (now - state.lastDrawAt >= minimumInterval) {
        state.lastDrawAt = now;
        draw(now);
      }

      frameId = window.requestAnimationFrame(frame);
    }

    function onPointerDown(event) {
      if (launchingRef.current) return;
      state.dragging = true;
      state.pointerId = event.pointerId;
      state.lastX = event.clientX;
      state.lastY = event.clientY;
      canvas.setPointerCapture?.(event.pointerId);
    }

    function onPointerMove(event) {
      if (!state.dragging || event.pointerId !== state.pointerId) return;
      const dx = event.clientX - state.lastX;
      const dy = event.clientY - state.lastY;
      state.lastX = event.clientX;
      state.lastY = event.clientY;
      state.yaw += dx * 0.0042;
      state.pitch = Math.max(-1.05, Math.min(0.55, state.pitch + dy * 0.0034));
    }

    function stopDragging(event) {
      if (event.pointerId !== state.pointerId) return;
      state.dragging = false;
      state.pointerId = null;
      canvas.releasePointerCapture?.(event.pointerId);
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", stopDragging);
    canvas.addEventListener("pointercancel", stopDragging);

    frameId = window.requestAnimationFrame(frame);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", stopDragging);
      canvas.removeEventListener("pointercancel", stopDragging);
    };
  }, []);

  return (
    <div className={`solar-auth-scene ${launching ? "is-launching" : ""}`}>
      <canvas ref={canvasRef} className="solar-auth-scene__canvas" />
      <div className="solar-auth-scene__vignette" />
    </div>
  );
}
