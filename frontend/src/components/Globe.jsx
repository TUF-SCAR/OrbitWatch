import { useRef, useEffect } from "react";
import {
  Viewer,
  Ion,
  Cartesian3,
  Color,
  SampledPositionProperty,
  JulianDate,
  TimeInterval,
  Iso8601,
} from "cesium";
import "./Globe.css";
import "cesium/Build/Cesium/Widgets/widgets.css";
const token = import.meta.env.VITE_CESIUM_ION_TOKEN;

async function loadTrajectoryItem(norad_id) {
  const response = await fetch(
    `http://127.0.0.1:8000/api/satellites/${norad_id}/trajectory?step_seconds=5&duration_seconds=120`,
  );

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  const item = await response.json();

  return item;
}

function Globe({ norad_ids }) {
  const areaRef = useRef(null);

  useEffect(() => {
    Ion.defaultAccessToken = token;
    const globeViewer = new Viewer(areaRef.current);
    globeViewer.clock.shouldAnimate = true;
    const satelliteObjects = new Map();

    async function updateSatelliteTrajectory(norad_id) {
      const satelliteTrajectory = await loadTrajectoryItem(norad_id);

      let satelliteData = satelliteObjects.get(norad_id);

      if (!satelliteData) {
        satelliteData = {
          marker: null,
          positions: new SampledPositionProperty(),
        };
        satelliteObjects.set(norad_id, satelliteData);
      }

      const positions = satelliteData.positions;

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

        positions.addSample(timestamp, satellitePosition);
      }

      const positionsCutoff = JulianDate.addSeconds(
        globeViewer.clock.currentTime,
        -30,
        new JulianDate(),
      );

      const oldPositions = new TimeInterval({
        start: Iso8601.MINIMUM_VALUE,
        stop: positionsCutoff,
      });

      positions.removeSamples(oldPositions);

      if (!satelliteData.marker) {
        satelliteData.marker = globeViewer.entities.add({
          position: positions,
          point: {
            pixelSize: 14,
            color: Color.GRAY,
          },
          label: {
            text: `${satelliteTrajectory.name} - (${satelliteTrajectory.norad_id})`,
          },
        });
      }
    }

    function refreshAllSatellites() {
      for (const id of norad_ids) {
        updateSatelliteTrajectory(id);
      }
    }
    refreshAllSatellites();
    const satelliteTrajectoryInterval = setInterval(
      refreshAllSatellites,
      60000,
    );

    return () => {
      clearInterval(satelliteTrajectoryInterval);
      globeViewer.destroy();
    };
  }, [norad_ids]);

  return <div className="globe-container" ref={areaRef}></div>;
}

export default Globe;
