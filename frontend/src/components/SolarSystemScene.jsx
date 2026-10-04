import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CELESTIAL_BODIES, SOLAR_PLANETS } from "../data/celestialBodies.js";
import "./SolarSystemScene.css";
export default function SolarSystemScene({ launching, interactive, startupCountry }) {
  const mountRef = useRef(null);
  const stateRef = useRef({ launching, interactive, startupCountry });
  useEffect(() => { stateRef.current = { launching, interactive, startupCountry }; }, [launching, interactive, startupCountry]);
  useEffect(() => {
    const mount = mountRef.current;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "low-power" }); } catch { return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color("#02050a");
    const camera = new THREE.PerspectiveCamera(43, 1, 0.02, 800);
    camera.position.set(0, 58, 93);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.06; controls.enablePan = false;
    controls.minDistance = 35; controls.maxDistance = 160; controls.minPolarAngle = 0.22; controls.maxPolarAngle = Math.PI * 0.48;
    const loader = new THREE.TextureLoader(), textures = [];
    const materials = [], geometries = [];
    let disposed = false, needsRender = true;
    const requestRender = () => { needsRender = true; };
    controls.addEventListener("change", requestRender);
    renderer.domElement.addEventListener("webglcontextrestored", requestRender);
    const geometry = new THREE.SphereGeometry(1, 32, 20); geometries.push(geometry);
    const sun = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: "#ffd596" })); materials.push(sun.material); sun.scale.setScalar(3.4); scene.add(sun);
    scene.add(new THREE.AmbientLight(0xc5dbff, 1.3));
    const lamp = new THREE.PointLight(0xffffff, 1000, 0, 1.1); scene.add(lamp);
    const bodies = [];
    SOLAR_PLANETS.forEach((id, index) => {
      const body = CELESTIAL_BODIES[id], radius = [0.42, 0.75, 0.85, 0.57, 2.1, 1.85, 1.25, 1.2][index], distance = 7 + index * 5.4;
      const material = new THREE.MeshStandardMaterial({ color: body.color, roughness: 0.95 }); materials.push(material);
      const mesh = new THREE.Mesh(geometry, material); mesh.scale.setScalar(radius);
      const angle = [0.6, 2.2, -0.9, 3.7, 1.9, 5, 3.2, 0.15][index];
      mesh.position.set(Math.cos(angle) * distance, 0, Math.sin(angle) * distance); scene.add(mesh);
      const texture = loader.load(body.texture, () => { if (disposed) { texture.dispose(); return; } material.map = texture; material.color.set("white"); material.needsUpdate = true; requestRender(); }, undefined, () => {}); texture.colorSpace = THREE.SRGBColorSpace; textures.push(texture);
      const points = Array.from({ length: 129 }, (_, k) => new THREE.Vector3(Math.cos(k / 128 * Math.PI * 2) * distance, 0, Math.sin(k / 128 * Math.PI * 2) * distance));
      const ringGeometry = new THREE.BufferGeometry().setFromPoints(points), ringMaterial = new THREE.LineBasicMaterial({ color: body.color, transparent: true, opacity: 0.2 }); geometries.push(ringGeometry); materials.push(ringMaterial); scene.add(new THREE.Line(ringGeometry, ringMaterial));
      if (id === "saturn") { const ring = new THREE.RingGeometry(1.3, 2.2, 48); const mat = new THREE.MeshBasicMaterial({ color: "#d2bf98", side: THREE.DoubleSide, transparent: true, opacity: 0.65 }); geometries.push(ring); materials.push(mat); const rings = new THREE.Mesh(ring, mat); rings.rotation.x = Math.PI / 2.5; mesh.add(rings); }
      bodies.push({ id, mesh, radius });
    });
    const starData = new Float32Array(1200 * 3);
    // Deterministic stars and an asteroid belt, with a single draw call each.
    for (let k = 0; k < 1200; k++) { const a = k * 2.39996, y = 1 - 2 * (k + 0.5) / 1200, r = Math.sqrt(1 - y * y); starData.set([Math.cos(a) * r * 250, y * 250, Math.sin(a) * r * 250], k * 3); }
    const stars = new THREE.BufferGeometry(); stars.setAttribute("position", new THREE.BufferAttribute(starData, 3)); geometries.push(stars); const starMat = new THREE.PointsMaterial({ color: "#c8d8eb", size: 0.27, sizeAttenuation: true }); materials.push(starMat); scene.add(new THREE.Points(stars, starMat));
    const belt = new Float32Array(450 * 3); for (let k = 0; k < 450; k++) { const a = k * 2.39996, r = 25 + Math.sin(k * 7.1) * 1.2; belt.set([Math.cos(a) * r, Math.sin(k * 5) * 0.45, Math.sin(a) * r], k * 3); }
    const beltGeometry = new THREE.BufferGeometry(); beltGeometry.setAttribute("position", new THREE.BufferAttribute(belt, 3)); geometries.push(beltGeometry); const beltMaterial = new THREE.PointsMaterial({ color: "#8a8274", size: 0.08 }); materials.push(beltMaterial); scene.add(new THREE.Points(beltGeometry, beltMaterial));
    const earth = bodies.find((body) => body.id === "earth");
    let travelStart = null, startPosition, startTarget, frame = 0, lastFrame = 0;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motionQuery.matches;
    const updateMotion = () => { reduced = motionQuery.matches; controls.enableDamping = !reduced; requestRender(); };
    updateMotion(); motionQuery.addEventListener("change", updateMotion);
    const resize = new ResizeObserver(() => { const { width, height } = mount.getBoundingClientRect(); renderer.setSize(width, height); camera.aspect = width / Math.max(1, height); camera.fov = 2 * Math.atan(Math.tan(Math.PI / 6) / Math.max(1, camera.aspect)) * 180 / Math.PI; camera.updateProjectionMatrix(); requestRender(); }); resize.observe(mount);
    function animate(time) {
      frame = requestAnimationFrame(animate);
      if (time - lastFrame < 1000 / 30 || document.hidden) return;
      lastFrame = time;
      const state = stateRef.current;
      controls.enabled = Boolean(state.interactive && !state.launching);
      if (state.launching) {
        if (travelStart === null) { travelStart = time; startPosition = camera.position.clone(); startTarget = controls.target.clone(); }
        const progress = reduced ? 1 : Math.min(1, (time - travelStart) / 2200); const eased = progress * progress * (3 - 2 * progress);
        const region = state.startupCountry; const longitude = ((region?.west ?? 67) + (region?.east ?? 98)) / 2 * Math.PI / 180; const latitude = ((region?.south ?? 5) + (region?.north ?? 37)) / 2 * Math.PI / 180;
        earth.mesh.rotation.y = -longitude;
        const destination = earth.mesh.position.clone().add(new THREE.Vector3(0, Math.sin(latitude) * 4.45, Math.cos(latitude) * 4.45));
        camera.position.lerpVectors(startPosition, destination, eased); controls.target.lerpVectors(startTarget, earth.mesh.position, eased); camera.lookAt(controls.target);
      } else { controls.update(); if (!reduced) for (const body of bodies) body.mesh.rotation.y += 0.0015; }
      // Reduced-motion idle previews have no animated content. Still redraw
      // after input, image arrival, resize or context restoration.
      if (needsRender || !reduced || state.launching) { renderer.render(scene, camera); needsRender = false; }
    }
    frame = requestAnimationFrame(animate);
    return () => { disposed = true; motionQuery.removeEventListener("change", updateMotion); controls.removeEventListener("change", requestRender); renderer.domElement.removeEventListener("webglcontextrestored", requestRender); cancelAnimationFrame(frame); resize.disconnect(); controls.dispose(); for (const value of [...textures, ...materials, ...geometries]) value.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); scene.clear(); };
  }, []);
  return <div className="solar-system-webgl" ref={mountRef} aria-label="Interactive solar system preview" />;
}
