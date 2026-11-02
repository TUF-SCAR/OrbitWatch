import { useRef, useState } from 'react';
import { CalendarDays, ChevronUp, History, RotateCcw, X } from "lucide-react";
import SpatialSurface from "./SpatialSurface.jsx";
import SceneTimePicker from './SceneTimePicker.jsx';
import { validSceneTime } from '../utils/sceneCalendar.js';
import {MAP_OPTIONS} from '../data/mapOptions.js';

export default function TimeDock({ selectedTime, onTimeChange, onReturnLive, trackedCount, maxTracked, imageryStatus, preparationIssue, onRetryImagery, historicalData, onRetryHistory, draftTime=selectedTime, onLoad, busy=false, bodyId='earth', coverage, notice, onDismissNotice, onRetryScene }) {
  const [pickerOpen,setPickerOpen]=useState(false);
  const changed=draftTime.getTime()!==selectedTime.getTime();
  const mapName=imageryStatus?.activeMap==='local-reference'?'NASA/JPL/USGS · Static reference texture':MAP_OPTIONS.find(map=>map.id===imageryStatus?.activeMap)?.name;
  const trigger=useRef(null);
  function closePicker() {setPickerOpen(false);requestAnimationFrame(()=>trigger.current?.focus());}
  function adjust(minutes) {const next=new Date(draftTime.getTime()+minutes*60000);if(validSceneTime(next))onTimeChange(next);}
  return (
    <SpatialSurface side="bottom" strength={3.0} className={`time-dock ${busy?'is-loading':''}`} aria-label="Time Explorer date controls" data-tracked-count={trackedCount}>
      <div className="time-dock__label" data-depth="3"><History size={18} /><span>TIME EXPLORER</span><b>{trackedCount}/{maxTracked}</b></div>
      <button ref={trigger} className="time-dock__moment" aria-label="Scene date and time (local)" aria-haspopup="dialog" aria-expanded={pickerOpen} onClick={()=>setPickerOpen(true)}><CalendarDays size={21}/><span><strong>{draftTime.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})} <b>{draftTime.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false})}</b></strong><small>{Intl.DateTimeFormat().resolvedOptions().timeZone} · {draftTime.toISOString().slice(0,16).replace('T',' ')} UTC{changed?' · DRAFT':''}</small></span><ChevronUp size={16}/></button>
      {pickerOpen&&<SceneTimePicker time={draftTime} coverage={coverage} onClose={closePicker} onApply={date=>{onTimeChange(date);closePicker();}}/>}
      <div className="time-dock__scrub" data-depth="6">
        {[[-1440,'−1d'],[-60,'−1h'],[-10,'−10m'],[10,'+10m'],[60,'+1h'],[1440,'+1d']].map(([minutes,label])=><button key={minutes} aria-label={`${minutes<0?'Back':'Forward'} ${Math.abs(minutes)} minutes`} disabled={!validSceneTime(new Date(draftTime.getTime()+minutes*60000))} onClick={()=>adjust(minutes)}>{label}</button>)}
      </div>
      <button type="button" className="time-dock__load" disabled={!validSceneTime(draftTime)} onClick={()=>onLoad?.(draftTime)}>{busy?'LOAD NEW TIME':'LOAD'}</button>
      <p className="time-coverage" role="status">{busy?'Preparing':'Scene'}: <time dateTime={selectedTime.toISOString()}>{selectedTime.toISOString().replace('T',' ').slice(0,19)} UTC</time>{changed?' · Draft edits do not change the scene until LOAD.':''} · Approximate astronomical visualization.</p>
      {bodyId==='earth'&&<p className="time-coverage time-satellite-coverage" role="status">{!trackedCount?'No historical satellites enabled. Use the permanent 15-object list to check archive coverage.':historicalData?.state==='loading' ? 'Loading stored historical orbital elements…' : historicalData?.state==='ready' ? `${historicalData.objects.length}/${trackedCount} historical positions available · Archived SGP4 reconstruction, not observed telemetry.${historicalData.errors?.length ? ' Other selected objects have no valid archive coverage for this timestamp.' : ''}` : 'Historical archive unavailable for this timestamp. No current satellite positions are substituted.'}</p>}
      {trackedCount>0&&(historicalData?.state==='unavailable' || historicalData?.errors?.length>0) && <button onClick={onRetryHistory}>Retry historical data</button>}
      {bodyId==='earth'&&<p className="time-coverage" role="status">{mapName?`${mapName}${imageryStatus?.activeMap==='esri'?' World Imagery':''} · Reference basemap`:'Reference basemap pending'} · Not imagery from the selected time. Contemporary place names only. Historical weather has separate exact-date coverage.</p>}
      {imageryStatus?.message && imageryStatus.state !== 'available' && <p className="time-coverage" role="status">{imageryStatus.message}</p>}
      {preparationIssue && <p className="time-coverage" role="status">{preparationIssue}<button onClick={onRetryScene}>Retry scene preparation</button></p>}
      {['unavailable','unconfigured'].includes(imageryStatus?.state) && <button onClick={onRetryImagery}>Retry reference basemap</button>}
      {notice&&<div className="time-date-notice" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss launch-date notice" onClick={onDismissNotice}><X size={14}/></button></div>}
      <button className="return-live" onClick={onReturnLive} aria-label="Return to Live Mode" data-depth="4"><RotateCcw size={17} /> Now</button>
    </SpatialSurface>
  );
}
