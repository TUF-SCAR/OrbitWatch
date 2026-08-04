import "./App.css";
import { useState } from "react";
import Globe from "./components/Globe.jsx";

const satellites = [
  { name: "ISS (ZARYA)", noradId: 25544 },
  { name: "Hubble Space Telescope (HST)", noradId: 20580 },
  { name: "Tiangong / CSS (TIANHE)", noradId: 48274 },
  { name: "AQUA", noradId: 27424 },
  { name: "AURA", noradId: 28376 },
  { name: "LANDSAT 8", noradId: 39084 },
  { name: "LANDSAT 9", noradId: 49260 },
  { name: "GPM-CORE", noradId: 39574 },
  { name: "SENTINEL-1A", noradId: 39634 },
  { name: "SENTINEL-2A", noradId: 40697 },
];

function App() {
  const [selectedId, setSelectedId] = useState(25544);

  return (
    <header>
      <select
        value={selectedId}
        onChange={(event) => setSelectedId(Number(event.target.value))}
      >
        {satellites.map((satellite) => (
          <option key={satellite.noradId} value={satellite.noradId}>
            {satellite.name}
          </option>
        ))}
      </select>

      <Globe norad_id={selectedId} />
    </header>
  );
}

export default App;
