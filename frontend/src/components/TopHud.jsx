import { Crosshair, UserRound, Wifi, WifiOff } from "lucide-react";
import { getApiBaseUrl } from "../services/orbitwatchApi.js";
const modeNames={live:"LIVE ORBIT",time:"TIME EXPLORER",disaster:"DISASTER LAB"};
export default function TopHud({mode,apiState,currentUser,onProfileToggle}){
  return <header className="top-hud">
    <div className="brand-lockup"><div className="brand-lockup__title">ORBITWATCH</div><div className="brand-lockup__sub"><Crosshair size={15}/> spatial orbital intelligence</div></div>
    <div className={`mode-readout mode-readout--${mode}`}><span className="mode-readout__pulse"/><span>{modeNames[mode]}</span></div>
    <div className="system-readout">
      <span className={`system-readout__item ${apiState==="online"?"is-online":apiState==="offline"?"is-offline":""}`} title={getApiBaseUrl()}>{apiState==="online"?<Wifi size={16}/>:<WifiOff size={16}/>} API {apiState.toUpperCase()}</span>
      {currentUser?<button className="session-readout session-readout--button" type="button" onClick={onProfileToggle} aria-label="Open profile" title="Open profile"><UserRound size={15}/><strong>{currentUser.username}</strong></button>:null}
    </div>
  </header>;
}
