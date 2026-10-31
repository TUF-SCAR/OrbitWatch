import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { MONTHS, dateFields, daysInMonth, fieldsDate, shiftMonth } from '../utils/sceneCalendar.js';

export default function SceneTimePicker({time,onApply,onClose,coverage}) {
  const dialog=useRef(null),yearInput=useRef(null);
  const [zone,setZone]=useState('local'),[fields,setFields]=useState(()=>dateFields(time,'local'));
  const [representedInstant,setRepresentedInstant]=useState(time);
  const [showHistory,setShowHistory]=useState(false);
  useEffect(()=>{const element=dialog.current;element.showModal();yearInput.current.focus();return ()=>element.close();},[]);
  // Retain the exact instant through display-only zone switches, including the
  // repeated local hour at the end of daylight saving time.
  const date=representedInstant || fieldsDate(fields,zone);
  const year=Math.min(2100,Math.max(1957,Number(fields.year)||1957)),month=Number(fields.month);
  const first=new Date(Date.UTC(year,month,1)).getUTCDay(),count=daysInMonth(year,month);
  const localZone=Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time';
  function setField(key,value) {
    setRepresentedInstant(null);
    setFields(previous=>{
      const next={...previous,[key]:value};
      if(key==='year'||key==='month') next.day=String(Math.min(Number(next.day),daysInMonth(Number(next.year)||1957,Number(next.month))));
      return next;
    });
  }
  function changeZone(next) {if(date) {setRepresentedInstant(date);setFields(dateFields(date,next));setZone(next);}}
  function changeMonth(amount) {setRepresentedInstant(null);setFields(shiftMonth(fields,amount));}
  function calendarKey(event,day) {
    const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[event.key];
    if(!delta)return;
    event.preventDefault();
    setRepresentedInstant(null);
    const next=new Date(Date.UTC(year,month,day+delta));
    if(next.getUTCFullYear()<1957||next.getUTCFullYear()>2100)return;
    setFields(previous=>({...previous,year:String(next.getUTCFullYear()),month:String(next.getUTCMonth()),day:String(next.getUTCDate())}));
    requestAnimationFrame(()=>dialog.current?.querySelector(`[data-day="${next.getUTCDate()}"]`)?.focus());
  }
  return createPortal(<dialog className="scene-picker" ref={dialog} aria-labelledby="scene-picker-title" onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===dialog.current){const r=dialog.current.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)onClose();}}}>
    <form onSubmit={event=>{event.preventDefault();if(date)onApply(date);}}>
      <header><div><span className="scene-picker__eyebrow">TIME EXPLORER</span><h2 id="scene-picker-title">Choose your moment</h2></div><button type="button" aria-label="Close date picker" onClick={onClose}><X size={19}/></button></header>
      <div className="scene-picker__zone" role="group" aria-label="Time display timezone"><button type="button" aria-pressed={zone==='local'} disabled={!date} onClick={()=>changeZone('local')}>Local</button><button type="button" aria-pressed={zone==='utc'} disabled={!date} onClick={()=>changeZone('utc')}>UTC</button><span>{zone==='utc'?'Coordinated Universal Time':localZone}</span></div>
      <div className="scene-picker__navigation"><button type="button" aria-label="Previous month" onClick={()=>changeMonth(-1)}><ChevronLeft size={18}/></button><label>Month<select aria-label="Month" value={fields.month} onChange={e=>setField('month',e.target.value)}>{MONTHS.map((name,index)=><option key={name} value={index}>{name}</option>)}</select></label><label>Year<input ref={yearInput} aria-label="Year" type="number" min="1957" max="2100" value={fields.year} onChange={e=>setField('year',e.target.value)}/></label><button type="button" aria-label="Next month" onClick={()=>changeMonth(1)}><ChevronRight size={18}/></button></div>
      <div className="scene-picker__week" aria-hidden="true">{['Su','Mo','Tu','We','Th','Fr','Sa'].map(day=><span key={day}>{day}</span>)}</div>
      <div className="scene-picker__days" role="group" aria-label={`${MONTHS[month]} ${year} calendar`}>
        {Array.from({length:first},(_,i)=><span key={`empty-${i}`}/>)}
        {Array.from({length:count},(_,i)=>i+1).map(day=><button type="button" key={day} data-day={day} aria-label={`${day} ${MONTHS[month]} ${year}`} aria-pressed={Number(fields.day)===day} tabIndex={Number(fields.day)===day?0:-1} onKeyDown={event=>calendarKey(event,day)} onClick={()=>setField('day',String(day))}>{day}</button>)}
      </div>
      <div className="scene-picker__time"><span>Time <small>24-hour</small></span><label>Hour<input type="number" min="0" max="23" aria-label="Hour" value={fields.hour} onChange={e=>setField('hour',e.target.value)}/></label><b>:</b><label>Minute<input type="number" min="0" max="59" aria-label="Minute" value={fields.minute} onChange={e=>setField('minute',e.target.value)}/></label></div>
      <p className="scene-picker__equivalent" aria-live="polite">{date ? `${date.toISOString().slice(0,16).replace('T',' · ')} UTC` : 'Choose a valid time between 1957 and 2100. Local daylight-saving gaps cannot be selected.'}</p>
      <button type="button" className="scene-picker__history-toggle" aria-expanded={showHistory} onClick={()=>setShowHistory(v=>!v)}>Available history <span>{showHistory?'−':'+'}</span></button>
      {showHistory&&<div className="scene-picker__history"><p>Verified instants · counts include the permanent catalog. Gaps between dates remain unavailable.</p>{coverage?.shortcuts?.length ? coverage.shortcuts.map(item=><button type="button" key={item.timestamp} onClick={()=>{const next=new Date(item.timestamp);setRepresentedInstant(next);setFields(dateFields(next,zone));}}><strong>{new Date(item.timestamp).toLocaleDateString('en-GB',{year:'numeric',month:'short',day:'numeric',timeZone:zone==='utc'?'UTC':undefined})}</strong><span>{item.available_count}/15 · {item.default_count}/4 defaults</span></button>) : <p>{coverage?.state==='unavailable'?'Coverage could not be loaded. You can still explore any scene date.':'No verified shortcuts loaded yet.'}</p>}</div>}
      <footer><button type="button" onClick={onClose}>Cancel</button><button type="submit" className="scene-picker__apply" disabled={!date}>Apply scene time</button></footer>
    </form>
  </dialog>,document.body);
}
