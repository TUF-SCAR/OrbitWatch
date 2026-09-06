import { useMemo, useRef } from "react";
import OrbitGlobe from "./OrbitGlobe.jsx";
import "./LiveEarthWarmup.css";

export default function LiveEarthWarmup() {
  const globeRef = useRef(null);
  const emptySet = useMemo(() => new Set(), []);
  const selectedTime = useMemo(() => new Date(), []);

  return (
    <div className="live-earth-warmup" aria-hidden="true">
      <OrbitGlobe
        trackedIds={[]}
        selectedId={null}
        selectedTime={selectedTime}
        mode="live"
        refreshNonce={0}
        mapStyle="google"
        labelsEnabled={true}
        sceneMode="3d"
        shownOrbitIds={emptySet}
        disasterLayers={[]}
        onObjectSelect={() => {}}
        onViewTelemetry={() => {}}
        globeRef={globeRef}
      />
    </div>
  );
}
