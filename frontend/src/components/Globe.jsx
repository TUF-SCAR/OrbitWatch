import { useRef, useEffect } from "react";
import {
  Viewer,
  Ion,
  Cartesian3,
  Color,
  SampledPositionProperty,
  JulianDate,
} from "cesium";
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

async function loadTrajectoryItem() {
  const response = await fetch(
    "http://127.0.0.1:8000/api/satellites/20580/trajectory?step_seconds=5&duration_seconds=120",
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
    let satelliteMarker = null;

    async function updateSatelliteTrajectory() {
      const satelliteTrajectory = await loadTrajectoryItem();

      const satellitePositions = new SampledPositionProperty();

      for (const position of satelliteTrajectory.positions) {
        const timestamp = JulianDate.fromIso8601(position.timestamp);

        const latitude = position.latitude;
        const longitude = position.longitude;
        const altitude_km = position.altitude_km;
        const height = altitude_km * 1000;

        const satellitePosition = Cartesian3.fromDegrees(
          longitude,
          latitude,
          height,
        );

        satellitePositions.addSample(timestamp, satellitePosition);
      }

      const satelliteMarker2 = globeViewer.entities.add({
        position: satellitePositions,
        point: {
          pixelSize: 14,
          color: Color.GRAY,
        },
        label: {
          text: `${satelliteTrajectory.name} - (${satelliteTrajectory.norad_id})`,
        },
      });
      globeViewer.clock.currentTime = JulianDate.fromIso8601(
        satelliteTrajectory.positions[0].timestamp,
      );
      globeViewer.clock.shouldAnimate = true;
      globeViewer.zoomTo(satelliteMarker2);

      console.log(satellitePositions);
    }

    async function getSatellitePosition() {
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

      return {
        satellitePosition,
        name,
        norad_id,
      };
    }

    async function updateSatellitePosition() {
      const { satellitePosition, name, norad_id } =
        await getSatellitePosition();

      if (!satelliteMarker) {
        satelliteMarker = globeViewer.entities.add({
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
      } else {
        satelliteMarker.position.setValue(satellitePosition);
      }
    }
    updateSatelliteTrajectory();
    //updateSatellitePosition();
    //const updateSatelliteInterval = setInterval(updateSatellitePosition, 5000);

    return () => {
      //clearInterval(updateSatelliteInterval);
      globeViewer.destroy();
    };
  }, []);

  return <div className="globe-container" ref={areaRef}></div>;
}

export default Globe;
