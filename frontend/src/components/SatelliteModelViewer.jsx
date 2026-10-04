import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { disposeModel } from "../utils/disposeModel.js";
import { getSatelliteModelUrl, VERIFIED_SATELLITE_MODELS } from "../data/satelliteModels.js";
import "./SatelliteModelViewer.css";
export default function SatelliteModelViewer({ object, onUnavailable }) {
  const mountRef = useRef(null);
  const navigationRef = useRef(null);
  const [ready, setReady] = useState(false);
  const modelUrl = getSatelliteModelUrl(object);
  useEffect(() => {
    const mount = mountRef.current;
    let cancelled = false, cleanup = () => {};
    const controller = new AbortController();
    const unavailable = () => {
      if (cancelled) return;
      cancelled = true; clearTimeout(deadline); controller.abort(); navigationRef.current = null; cleanup(); onUnavailable?.();
    };
    // Bound the complete operation, including decoder startup and parsing.
    const deadline = window.setTimeout(() => {
      unavailable();
    }, 10000);
    async function initialize() {
      const [{ GLTFLoader }, { DRACOLoader }] = await Promise.all([import("three/addons/loaders/GLTFLoader.js"), import("three/addons/loaders/DRACOLoader.js")]);
      if (cancelled) return;
      const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "low-power" });
      renderer.setPixelRatio(1); mount.appendChild(renderer.domElement);
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
      camera.position.set(2.7, 1.7, 3.4);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true; controls.enablePan = false; controls.minDistance = 1.6; controls.maxDistance = 7; controls.autoRotateSpeed = 0.5;
      const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      let paused = false, needsRender = true;
      const requestRender = () => { needsRender = true; };
      // A lost optional context should never leave an inert, blank preview.
      const contextLost = (event) => { event.preventDefault(); unavailable(); };
      controls.addEventListener("change", requestRender);
      renderer.domElement.addEventListener("webglcontextlost", contextLost);
      renderer.domElement.addEventListener("webglcontextrestored", requestRender);
      const updateMotion = () => { controls.autoRotate = !paused && !motionQuery.matches; controls.enableDamping = !motionQuery.matches; requestRender(); };
      updateMotion(); motionQuery.addEventListener("change", updateMotion);
      scene.add(new THREE.HemisphereLight(0xcce9ff, 0x596574, 3));
      const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(3, 4, 5); scene.add(light);
      const draco = new DRACOLoader(); draco.setDecoderPath("/decoders/draco/"); draco.setWorkerLimit(1);
      const loader = new GLTFLoader().setDRACOLoader(draco);
      let frame, resumeTimer, model;
      const pause = () => { paused = true; updateMotion(); clearTimeout(resumeTimer); };
      const resume = () => { clearTimeout(resumeTimer); resumeTimer = window.setTimeout(() => { paused = false; updateMotion(); }, 1000); };
      controls.addEventListener("start", pause); controls.addEventListener("end", resume);
      navigationRef.current = (action) => {
        pause();
        const offset = camera.position.clone().sub(controls.target);
        if (action === "left" || action === "right") offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), action === "left" ? 0.2 : -0.2);
        else if (action === "in" || action === "out") offset.setLength(Math.max(controls.minDistance, Math.min(controls.maxDistance, offset.length() * (action === "in" ? 0.85 : 1.15))));
        else { offset.set(2.7, 1.7, 3.4); controls.target.set(0, 0, 0); }
        camera.position.copy(controls.target).add(offset); controls.update(); resume();
      };
      const resize = new ResizeObserver(() => { const rect = mount.getBoundingClientRect(); renderer.setSize(rect.width, rect.height); camera.aspect = rect.width / Math.max(1, rect.height); camera.updateProjectionMatrix(); requestRender(); }); resize.observe(mount);
      let lastFrame = 0;
      function render(time) { frame = requestAnimationFrame(render); if (time - lastFrame < 33 || document.hidden) return; lastFrame = time; controls.update(); if (needsRender) { renderer.render(scene, camera); needsRender = false; } }
      frame = requestAnimationFrame(render);
      cleanup = () => { motionQuery.removeEventListener("change", updateMotion); controls.removeEventListener("change", requestRender); renderer.domElement.removeEventListener("webglcontextlost", contextLost); renderer.domElement.removeEventListener("webglcontextrestored", requestRender); cancelAnimationFrame(frame); clearTimeout(resumeTimer); resize.disconnect(); controls.dispose(); draco.dispose(); if (model) disposeModel(model); renderer.dispose(); if (!renderer.getContext().isContextLost()) renderer.forceContextLoss(); renderer.domElement.remove(); };
      const response = await fetch(modelUrl, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
      if (!response.ok) throw new Error("Model unavailable");
      const gltf = await loader.parseAsync(await response.arrayBuffer(), "");
      if (cancelled) { disposeModel(gltf.scene); return; }
      model = gltf.scene;
      const bounds = new THREE.Box3().setFromObject(model), center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
      const root = new THREE.Group(); scene.add(root); root.add(model); model.position.sub(center); root.scale.setScalar(2 / Math.max(size.x, size.y, size.z));
      requestRender(); clearTimeout(deadline); setReady(true);
    }
    initialize().catch(unavailable);
    return () => { const wasCancelled = cancelled; cancelled = true; clearTimeout(deadline); navigationRef.current = null; controller.abort(); if (!wasCancelled) cleanup(); };
  }, [modelUrl, onUnavailable]);
  const source = VERIFIED_SATELLITE_MODELS[object.noradId];
  return <section className="verified-model-stage"><div ref={mountRef} className="verified-model-canvas" role="img" aria-label={`${object.name} NASA reference model. Drag to rotate and scroll to zoom.`} />{!ready && <span className="model-loading" role="status">Loading reference model…</span>}<div className="model-navigation" aria-label="Model camera controls">{[["left", "Rotate left", "←"], ["right", "Rotate right", "→"], ["in", "Zoom in", "+"], ["out", "Zoom out", "−"], ["reset", "Reset model camera", "↺"]].map(([action, label, icon]) => <button type="button" key={action} aria-label={label} onClick={() => navigationRef.current?.(action)}>{icon}</button>)}</div><a href={source.source} target="_blank" rel="noreferrer" title={source.note}>{source.credit} · reference model ↗</a></section>;
}
