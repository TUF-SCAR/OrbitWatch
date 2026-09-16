import { useEffect, useRef } from "react";
import {
  getSatelliteModelKind,
  getSatelliteModelUrl,
} from "../data/satelliteModels.js";
import "./SatelliteModelViewer.css";

export default function SatelliteModelViewer({ object }) {
  const viewerRef = useRef(null);
  const modelUrl = getSatelliteModelUrl(object);
  const modelKind = getSatelliteModelKind(object);

  useEffect(() => {
    let cancelled = false;

    import("@google/model-viewer")
      .then(() => {
        if (!cancelled && viewerRef.current) {
          viewerRef.current.autoRotate = true;
        }
      })
      .catch((error) => {
        console.warn(
          "OrbitWatch: 3D overview viewer failed to load.",
          error,
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return undefined;

    function resumeSpin() {
      window.clearTimeout(viewer.__orbitwatchSpinTimer);

      viewer.__orbitwatchSpinTimer = window.setTimeout(() => {
        viewer.cameraOrbit = "38deg 68deg 115%";
        viewer.autoRotate = true;
      }, 900);
    }

    function pauseSpin() {
      viewer.autoRotate = false;
      window.clearTimeout(viewer.__orbitwatchSpinTimer);
    }

    viewer.addEventListener("pointerdown", pauseSpin);
    viewer.addEventListener("pointerup", resumeSpin);
    viewer.addEventListener("pointercancel", resumeSpin);
    viewer.addEventListener("mouseleave", resumeSpin);

    return () => {
      window.clearTimeout(viewer.__orbitwatchSpinTimer);
      viewer.removeEventListener("pointerdown", pauseSpin);
      viewer.removeEventListener("pointerup", resumeSpin);
      viewer.removeEventListener("pointercancel", resumeSpin);
      viewer.removeEventListener("mouseleave", resumeSpin);
    };
  }, [modelUrl]);

  return (
    <section className="satellite-model-stage" data-depth="7">
      <div className="satellite-model-stage__topline">
        <span>3D VEHICLE</span>
        <strong>{modelKind}</strong>
      </div>

      <model-viewer
        ref={viewerRef}
        key={modelUrl}
        class="satellite-model-viewer"
        src={modelUrl}
        alt={`${object?.name || "Satellite"} 3D model`}
        camera-controls
        auto-rotate
        auto-rotate-delay="900"
        rotation-per-second="7deg"
        interaction-prompt="none"
        shadow-intensity="0.45"
        shadow-softness="0.8"
        exposure="1.05"
        camera-orbit="38deg 68deg 115%"
        min-camera-orbit="auto auto 70%"
        max-camera-orbit="auto auto 220%"
        min-field-of-view="18deg"
        max-field-of-view="55deg"
      />

      <div className="satellite-model-stage__hint">
        <span>DRAG TO ROTATE</span>
        <i />
        <span>RELEASE TO AUTO-SPIN</span>
      </div>
    </section>
  );
}
