import { CLOUD_SOURCE } from '../services/cloudConfig.js';

const time=value=>new Date(value).toLocaleString(undefined,{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'})+' UTC';

function Attribution({frame}) {

 const year=frame?new Date(frame.time).getUTCFullYear():'';

 return <small className="infrared-attribution">This service is based on <a href={CLOUD_SOURCE.information} target="_blank" rel="noreferrer">EUMETSAT EUMETView infrared cloud imagery {year}</a>. EUMETSAT / NOAA / JMA. Licensed under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>. Display modified with cold-cloud brightness-to-opacity emphasis.</small>;

}

export function ObservedCloudLegend({clouds,labelWeatherNote}) {

 if(!clouds.frame)return <aside className="weather-legend" aria-label="Observed cloud legend" role="status"><strong>Clouds</strong><small>{clouds.status==='loading'?'Checking prepared imagery…':'Clouds unavailable · retrying automatically'}</small></aside>;

 return <aside className="weather-legend" aria-label="Observed cloud legend"><strong>OBSERVED CLOUDS · IR EMPHASIS</strong><small>{clouds.status==='stale'?'STALE · ':''}{time(clouds.frame.time)}</small><small><a href={CLOUD_SOURCE.information} target="_blank" rel="noreferrer">EUMETSAT / NOAA / JMA</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a> · {new Date(clouds.frame.time).getUTCFullYear()}</small><details><summary>Coverage &amp; label details</summary><Attribution frame={clouds.frame}/>{labelWeatherNote&&<small>{labelWeatherNote}</small>}</details></aside>;

}

export default function ObservedClouds({clouds,enabled}) {

 const {frame,status,error,diagnostics}=clouds;

 return <div className="observed-clouds" data-cloud-diagnostics={JSON.stringify(diagnostics)}>

  {frame?<><p className="weather-valid">Composite observation <strong>{time(frame.time)}</strong>{status==='stale'?' · STALE':''}</p><p className="weather-source">{frame.width} × {frame.height} display grid · {frame.retrievedAt?`Retrieved ${time(frame.retrievedAt)}`:'Retrieval time unavailable'}</p></>:<p role="status">{enabled?(status==='loading'?'Loading genuine observed infrared imagery…':'Observed infrared imagery unavailable. No substitute clouds are displayed.'):'Enable the weather layer to load satellite imagery.'}</p>}

  {error&&<p className="inline-warning" role="status">{error}{frame?' The previously verified observation is retained with its original timestamp.':''}</p>}

  <button className="secondary-action" disabled={!enabled||status==='loading'||clouds.clock<(diagnostics.retryAt||0)} onClick={clouds.refresh}>CHECK LATEST OBSERVATION</button>

  <details><summary>Infrared imagery & coverage</summary><p>Thermal infrared observes day and night. Bright cloud tops are emphasized; this is not a cloud mask, visible-light photograph, temperature retrieval or cloud fraction. Warm low clouds may disappear; cold land, snow or ice can remain visible. Polar gaps and mosaic seams reflect the source. The timestamp is the composite slot, not a simultaneous scan of every pixel.</p><p>Only the latest valid advertised observation is acquired. The backend shares a bounded file cache and source cooldown across visitors. This view checks OrbitWatch about every five minutes while active; unchanged imagery is reused. Images expire after twelve hours, and observations over six hours old are marked stale.</p><p>The global display grid is approximately {(40075/(frame?.width||1024)).toFixed(1)} km at the equator. Desktop Balanced and Quality use the prepared 2048 × 1024 global variant. Regional acquisition is disabled to preserve the source budget. Resampling and brightness emphasis add no scientific detail. Geostationary viewing geometry and source resolution limit useful sharpness.</p></details>

  <Attribution frame={frame}/>

 </div>;

}
