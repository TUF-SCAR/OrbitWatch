import { Camera, Map, Orbit, Thermometer } from "lucide-react";
import SpatialSurface from "./SpatialSurface.jsx";
import {usePhoneDisclosure,usePhoneUI} from '../utils/usePhoneUI.js';

export default function SceneDock({
  controls,
  mapOpen,
  onToggleMap,
  cameraOpen,
  onToggleCamera,
  systemOpen,
  onToggleSystem,
  weatherAvailable,
  weatherOpen,
  onToggleWeather,
  historicalWeather=false,
}) {
  const phone=usePhoneUI(),[expanded,setExpanded]=usePhoneDisclosure('tools');
  if(phone)return <aside className="phone-tools" aria-label="Scene controls"><button type="button" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>Tools</button>{expanded&&<div>
   {!historicalWeather&&controls.map&&<button onClick={()=>{onToggleMap();setExpanded(false);}}><Map size={18}/> Map</button>}
   {!historicalWeather&&controls.camera&&<button onClick={()=>{onToggleCamera();setExpanded(false);}}><Camera size={18}/> Camera</button>}
   {controls.system&&<button onClick={()=>{onToggleSystem();setExpanded(false);}}><Orbit size={18}/> System</button>}
   {weatherAvailable&&<button onClick={()=>{onToggleWeather();setExpanded(false);}}><Thermometer size={18}/> {historicalWeather?'Archive':'Weather'}</button>}
  </div>}</aside>;
  return (
    <SpatialSurface as="aside" side="right" strength={3.1} className={`scene-dock ${weatherAvailable ? 'scene-dock--weather' : ''}`} aria-label="Scene controls">
      {controls.map ? (
        <button aria-pressed={mapOpen} className={`scene-tool ${mapOpen ? "is-active" : ""}`} onClick={onToggleMap} title="Map settings (M)" data-depth="3">
          <Map size={19} /><span>Map</span>
        </button>
      ) : null}

      {controls.camera && <button aria-pressed={cameraOpen} className={`scene-tool ${cameraOpen ? "is-active" : ""}`} onClick={onToggleCamera} title="Camera angles (C)" data-depth="4">
        <Camera size={19} /><span>Camera</span>
      </button>}

      {controls.system && <button aria-pressed={systemOpen} className={`scene-tool ${systemOpen ? "is-active" : ""}`} onClick={onToggleSystem} title="Solar system (S)" data-depth="5">
        <Orbit size={19} /><span>System</span>
      </button>}
      {weatherAvailable && <button aria-label={historicalWeather?'Historical weather':'Weather'} aria-pressed={weatherOpen} className={`scene-tool ${weatherOpen?'is-active':''}`} onClick={onToggleWeather} title={historicalWeather?'Historical weather (W)':'Live Earth weather (W)'} data-depth="3"><Thermometer size={19}/><span>{historicalWeather?'Archive':'Weather'}</span></button>}
    </SpatialSurface>
  );
}
