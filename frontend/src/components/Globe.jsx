import { useRef, useEffect } from "react";
import { Viewer, Ion, Cartesian3, Color } from "cesium";
import "./Globe.css";
import "cesium/Build/Cesium/Widgets/widgets.css";
const token = import.meta.env.VITE_CESIUM_ION_TOKEN;

async function loadItem() {
  const response = await fetch(
    "http://127.0.0.1:8000/api/satellites/25544/position",
  );

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  const item = await response.json();

  return item;
}

function Globe() {
  const areaRef = useRef(null);

  useEffect(() => {
    Ion.defaultAccessToken = token;
    const globeViewer = new Viewer(areaRef.current);
    async function innerFunction() {
      const satellite = await loadItem();

      if (!satellite) {
        console.warn("No satellite data recieved");
        return;
      }

      const { latitude, longitude, altitude_km, name, norad_id } = satellite;
      const height = altitude_km * 1000;

      const satellitePosition = Cartesian3.fromDegrees(
        longitude,
        latitude,
        height,
      );

      const satelliteMarker = globeViewer.entities.add({
        position: satellitePosition,
        point: {
          pixelSize: 14,
          color: Color.YELLOW,
        },
        label: {
          text: `${name} - (${norad_id})`,
        },
      });

      globeViewer.zoomTo(satelliteMarker);
    }
    innerFunction();

    return () => {
      globeViewer.destroy();
    };
  }, []);

  return <div className="globe-container" ref={areaRef}></div>;
}

export default Globe;
