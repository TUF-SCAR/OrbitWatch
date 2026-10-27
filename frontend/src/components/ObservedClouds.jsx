import { CLOUD_SOURCE } from '../services/cloudConfig.js';

const time=value=>new Date(value).toLocaleString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false})+' UTC';
export function ObservedCloudLegend({clouds}) {
  if(!clouds.frame)return null;
  return <aside className="weather-legend" aria-label="Observed cloud legend"><strong>OBSERVED CLOUDS · INFRARED</strong><small>Composite slot {time(clouds.frame.time)}</small><small>Cold-cloud emphasis · not cloud fraction. Polar gaps and cold-surface ambiguity.</small><small><a href={CLOUD_SOURCE.information} target="_blank" rel="noreferrer">EUMETSAT / NOAA / JMA</a>{clouds.error?' · CACHED FRAME':''}</small></aside>;
}
export default function ObservedClouds({clouds,enabled}) {
  const {frame,frames,index,status,error,playing,reduced,diagnostics}=clouds;
  return <div className="observed-clouds" data-cloud-diagnostics={JSON.stringify(diagnostics)}>
    {frame?<><p className="weather-valid">Observed composite slot <strong>{time(frame.time)}</strong></p><p className="weather-source">{CLOUD_SOURCE.credit}<br/>Three-hourly · {frame.width} × {frame.height} display grid</p></>:<p role="status">{enabled?(status==='loading'?'Loading observed infrared imagery…':'Observed imagery is not loaded.'):'Enable the weather layer to load satellite imagery.'}</p>}
    {status==='loading'&&frame&&<p className="weather-source" role="status">Preparing real observation frames…</p>}
    {frame&&clouds.clock-Date.parse(frame.time)>21600000&&<p className="weather-source">This composite is more than six hours old. Its original time is retained.</p>}
    {error&&<p className="inline-warning" role="status">{frame?'Cached observation retained. ':'No observed layer available. '}{error}. Model fallback is used when no observation is available.</p>}
    <div className="cloud-playback"><button className="secondary-action" disabled={!enabled||frames.length<2||reduced||status==='loading'} onClick={clouds.toggle}>{playing?'PAUSE':'PLAY OBSERVATIONS'}</button><label>Observation frame<input aria-label="Cloud observation frame" type="range" min="0" max={Math.max(0,frames.length-1)} step="1" value={index} disabled={!enabled||frames.length<2} onChange={e=>clouds.select(e.target.value)}/></label></div>
    <p className="weather-source">{reduced?'Reduced motion: choose still frames manually. ':''}Playback advances through actual composite slots and stops at the latest. Crossfades are display transitions, not intermediate observations.</p>
    <button className="secondary-action" disabled={!enabled||status==='loading'||clouds.clock<(diagnostics.retryAt||0)} onClick={clouds.refresh}>CHECK OBSERVATIONS</button>
    <details><summary>Infrared imagery & coverage</summary><p>Thermal infrared observes day and night. Bright cloud tops are emphasized over the map; this is not a cloud-only mask, visible-light photograph or cloud fraction retrieval. Warm low clouds can disappear and cold land, snow or ice can remain visible. Geostationary viewing leaves polar gaps and mosaic seams. The time is the provider’s composite slot, not a simultaneous scan of every pixel. Globe lighting dims the display at night; it does not imply missing observations.</p><p>Global display spacing is approximately {(40075/(frame?.width||2048)).toFixed(1)} km at the equator. Balanced and Quality request a bounded regional image after the camera settles. It samples the same observed slot more closely; actual source detail, polar gaps and viewing geometry remain limiting. Playback uses the global frames. No procedural cloud texture is added.</p><a href={CLOUD_SOURCE.information} target="_blank" rel="noreferrer">Product and attribution</a> · <a href="https://www.eumetsat.int/legal-framework/data-policy" target="_blank" rel="noreferrer">EUMETSAT data policy</a></details>
  </div>;
}
