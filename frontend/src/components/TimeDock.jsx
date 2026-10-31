import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronUp, History, RotateCcw } from "lucide-react";
import SpatialSurface from "./SpatialSurface.jsx";
import SceneTimePicker from './SceneTimePicker.jsx';
import { validSceneTime } from '../utils/sceneCalendar.js';
import { fetchHistoricalCoverage } from '../services/orbitwatchApi.js';

export default function TimeDock({ selectedTime, onTimeChange, onReturnLive, trackedCount, maxTracked, imageryStatus, preparationIssue, onRetryImagery, historicalData, onRetryHistory }) {
  const [pickerOpen,setPickerOpen]=useState(false),[coverage,setCoverage]=useState(null);
  const trigger=useRef(null);
  useEffect(()=>{
    const controller=new AbortController();
    fetchHistoricalCoverage(controller.signal).then(setCoverage).catch(()=>{if(!controller.signal.aborted)setCoverage({state:'unavailable'});});
    return ()=>controller.abort();
  },[]);
  function closePicker() {setPickerOpen(false);requestAnimationFrame(()=>trigger.current?.focus());}
  function adjust(minutes) {const next=new Date(selectedTime.getTime()+minutes*60000);if(validSceneTime(next))onTimeChange(next);}
  return (
    <SpatialSurface side="bottom" strength={3.0} className="time-dock">
      <div className="time-dock__label" data-depth="3"><History size={18} /><span>TIME EXPLORER</span><b>{trackedCount}/{maxTracked}</b></div>
      <button ref={trigger} className="time-dock__moment" aria-label="Scene date and time (local)" aria-haspopup="dialog" aria-expanded={pickerOpen} onClick={()=>setPickerOpen(true)}><CalendarDays size={21}/><span><strong>{selectedTime.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})} <b>{selectedTime.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false})}</b></strong><small>{Intl.DateTimeFormat().resolvedOptions().timeZone} · {selectedTime.toISOString().slice(0,16).replace('T',' ')} UTC</small></span><ChevronUp size={16}/></button>
      {pickerOpen&&<SceneTimePicker time={selectedTime} coverage={coverage} onClose={closePicker} onApply={date=>{onTimeChange(date);closePicker();}}/>}
      <div className="time-dock__scrub" data-depth="6">
        {[[-1440,'−1d'],[-60,'−1h'],[-10,'−10m'],[10,'+10m'],[60,'+1h'],[1440,'+1d']].map(([minutes,label])=><button key={minutes} aria-label={`${minutes<0?'Back':'Forward'} ${Math.abs(minutes)} minutes`} disabled={!validSceneTime(new Date(selectedTime.getTime()+minutes*60000))} onClick={()=>adjust(minutes)}>{label}</button>)}
      </div>
      <p className="time-coverage" role="status">{historicalData?.state==='loading' ? 'Loading stored historical orbital elements…' : historicalData?.state==='ready' ? `${historicalData.objects.length}/${trackedCount} historical positions available · Archived SGP4 reconstruction, not observed telemetry.${historicalData.errors?.length ? ' Other selected objects have no valid archive coverage for this timestamp.' : ''}` : 'Historical archive unavailable for this timestamp. No current satellite positions are substituted.'}</p>
      {(historicalData?.state==='unavailable' || historicalData?.errors?.length>0) && <button onClick={onRetryHistory}>Retry historical data</button>}
      {imageryStatus && <p className="time-coverage" role="status">{imageryStatus.activeMap === 'local-reference' ? 'NASA/JPL/USGS · Static reference texture' : imageryStatus.activeMap === 'esri' ? 'Esri World Imagery · Reference basemap' : 'Reference basemap pending'} · Not imagery from the selected time.</p>}
      {imageryStatus?.message && imageryStatus.state !== 'available' && <p className="time-coverage" role="status">{imageryStatus.message}</p>}
      {preparationIssue && <p className="time-coverage" role="status">{preparationIssue}</p>}
      {(preparationIssue || ['unavailable','unconfigured'].includes(imageryStatus?.state)) && <button onClick={onRetryImagery}>Retry reference basemap</button>}
      <button className="return-live" onClick={onReturnLive} aria-label="Return to Live Mode" data-depth="4"><RotateCcw size={17} /> Now</button>
    </SpatialSurface>
  );
}
