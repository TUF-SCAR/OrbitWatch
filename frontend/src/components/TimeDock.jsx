import {useRef,useState} from 'react';
import {CalendarDays,ChevronUp,RotateCcw} from 'lucide-react';
import SceneTimePicker from './SceneTimePicker.jsx';
import {usePhoneUI} from '../utils/usePhoneUI.js';
import {MAP_OPTIONS} from '../data/mapOptions.js';

export default function TimeDock(props){
 const {selectedTime,onTimeChange,onReturnLive,trackedCount,maxTracked,imageryStatus,preparationIssue,onRetryImagery,historicalData,onRetryHistory,onLoad,busy=false,bodyId='earth',coverage,notice,onDismissNotice,onRetryScene}=props;
 const phone=usePhoneUI(),[open,setOpen]=useState(false),trigger=useRef(null);
 const mapName=phone||imageryStatus?.activeMap==='esri'?'Esri World Imagery':imageryStatus?.activeMap==='local-reference'?'NASA/JPL/USGS · Static reference texture':MAP_OPTIONS.find(map=>map.id===imageryStatus?.activeMap)?.name||'Reference basemap pending';
 function close(){setOpen(false);requestAnimationFrame(()=>trigger.current?.focus());}
 return <>
  <aside className="phone-time-strip time-dock-v2" aria-label="Time Explorer date controls" data-tracked-count={trackedCount}>
   <button ref={trigger} type="button" aria-label="Expand date and time controls" aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(true)}><CalendarDays size={18}/><span>{selectedTime.toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}{busy?' · Preparing…':''}</span><ChevronUp size={16}/></button>
   <small>{mapName} · modern reference · {trackedCount}/{maxTracked} satellites</small>
  </aside>
  {open&&<SceneTimePicker time={selectedTime} coverage={coverage} onClose={close} onApply={date=>{onTimeChange(date);onLoad?.(date);close();}}>
   <section className="time-picker-status" aria-label="Scene status">
    <p>Applied scene: {selectedTime.toISOString().replace('T',' ').slice(0,19)} UTC · Approximate astronomical visualization.</p>
    {bodyId==='earth'&&<p>{mapName} · Reference basemap · Not imagery from the selected time. Contemporary place names only.</p>}
    <p>{!trackedCount?'No historical satellites enabled. Use the permanent 15-object list.':historicalData?.state==='ready'?`${historicalData.objects.length}/${trackedCount} historical positions available · Archived SGP4 reconstruction, not observed telemetry.`:historicalData?.state==='loading'?'Loading stored historical orbital elements…':'Historical archive unavailable for this timestamp. No current satellite positions are substituted.'}</p>
    {trackedCount>0&&(historicalData?.state==='unavailable'||historicalData?.errors?.length>0)&&<button type="button" onClick={onRetryHistory}>Retry historical data</button>}
    {imageryStatus?.message&&imageryStatus.state!=='available'&&<p>{imageryStatus.message}</p>}
    {['unavailable','unconfigured'].includes(imageryStatus?.state)&&<button type="button" onClick={onRetryImagery}>Retry reference basemap</button>}
    {preparationIssue&&<p>{preparationIssue}<button type="button" onClick={onRetryScene}>Retry scene preparation</button></p>}
    {notice&&<p>{notice}<button type="button" onClick={onDismissNotice}>Dismiss notice</button></p>}
    <button type="button" onClick={onReturnLive}><RotateCcw size={16}/> Return to Live Mode</button>
   </section>
  </SceneTimePicker>}
 </>;
}
