import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { MONTHS, dateFields, daysInMonth, fieldsDate, shiftMonth, validSceneTime } from '../utils/sceneCalendar.js';
import { dayHistory, historyAt, historyChoices, historyDemo, historyIndex, historyLabel } from '../services/timeHistory.js';
import { nearestWeatherMetadata } from '../services/historicalWeather.js';
import { usePhoneUI } from '../utils/usePhoneUI.js';

export default function SceneTimePicker({time,onApply,onClose,coverage,weatherCoverage,weatherError,children}) {
  const dialog=useRef(null),yearInput=useRef(null);
  const phone=usePhoneUI();
  const phoneOnOpen=useRef(phone);
  const [zone,setZone]=useState('local'),[fields,setFields]=useState(()=>dateFields(time,'local'));
  const [representedInstant,setRepresentedInstant]=useState(time);
  const [showHistory,setShowHistory]=useState(false);
  const [archiveYear,setArchiveYear]=useState(null);
  const [archiveTime,setArchiveTime]=useState(null);
  useEffect(()=>{const element=dialog.current;element.showModal();if(!phoneOnOpen.current)yearInput.current.focus();return ()=>element.close();},[]);
  // Retain the exact instant through display-only zone switches, including the
  // repeated local hour at the end of daylight saving time.
  const date=(representedInstant&&validSceneTime(representedInstant)?representedInstant:fieldsDate(fields,zone));
  const year=Math.min(new Date().getFullYear(),Math.max(1945,Number(fields.year)||1945)),month=Number(fields.month);
  const first=new Date(Date.UTC(year,month,1)).getUTCDay(),count=daysInMonth(year,month);
  const localZone=Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time';
  const archive=useMemo(()=>historyIndex(coverage,weatherCoverage),[coverage,weatherCoverage]);
  const choices=useMemo(()=>historyChoices(archive,coverage),[archive,coverage]);
  const demo=historyDemo(choices);
  const years=[...new Set(choices.map(item=>new Date(item.stamp).getUTCFullYear()))];
  const visibleYear=archiveYear??(years.includes(year)?year:years[0]);
  const availability=date&&historyAt(archive,date);
  const nearestWeather=availability&&!availability.weather&&nearestWeatherMetadata(weatherCoverage,date);
  const exactStatus=nearestWeather?'Nearest ERA5 snapshot available':availability&&(availability.weather||availability.satellites.length||weatherCoverage&&coverage&&coverage.state!=='unavailable')
    ? historyLabel(availability.weather,availability.satellites.length) : 'Archive coverage unavailable or loading';
  function setField(key,value) {
    setArchiveTime(null);
    setRepresentedInstant(null);
    setFields(previous=>{
      const next={...previous,[key]:value};
      if(key==='year'||key==='month') next.day=String(Math.min(Number(next.day),daysInMonth(Number(next.year)||1945,Number(next.month))));
      return next;
    });
  }
  function changeZone(next) {if(date) {setRepresentedInstant(date);setFields(dateFields(date,next));setZone(next);}}
  function changeMonth(amount) {setArchiveTime(null);setRepresentedInstant(null);setFields(shiftMonth(fields,amount));}
  function chooseArchive(stamp) {
    const next = new Date(stamp);
    setArchiveTime(stamp);
    setRepresentedInstant(next);
    setFields(dateFields(next,zone));
  }
  function calendarKey(event,day) {
    const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[event.key];
    if(!delta)return;
    event.preventDefault();
    setArchiveTime(null);
    setRepresentedInstant(null);
    const next=new Date(Date.UTC(year,month,day+delta));
    if(next.getUTCFullYear()<1945||next.getUTCFullYear()>new Date().getFullYear())return;
    setFields(previous=>({...previous,year:String(next.getUTCFullYear()),month:String(next.getUTCMonth()),day:String(next.getUTCDate())}));
    requestAnimationFrame(()=>dialog.current?.querySelector(`[data-day="${next.getUTCDate()}"]`)?.focus());
  }
  return createPortal(<dialog className="scene-picker" ref={dialog} aria-labelledby="scene-picker-title" onKeyDown={phone?event=>event.stopPropagation():undefined} onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===dialog.current){const r=dialog.current.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)onClose();}}}>
    <form onSubmit={event=>{event.preventDefault();if(date)onApply(date,{archive:archiveTime===date.getTime()});}}>
      <header><div><span className="scene-picker__eyebrow">TIME EXPLORER</span><h2 id="scene-picker-title">Choose your moment</h2></div><button type="button" aria-label="Close date picker" onClick={onClose}><X size={19}/></button></header>
      <button type="button" className="scene-picker__history-toggle" aria-expanded={showHistory} onClick={()=>setShowHistory(value=>!value)}>Available history <span>{showHistory?'−':'+'}</span></button>
      {showHistory&&<section className="scene-picker__history" aria-label="Available history">
        <p>{weatherCoverage?`${archive.weather.size} stored weather snapshots.`:weatherError?'Weather coverage unavailable.':'Checking weather coverage…'} {coverage?.state==='unavailable'?'Satellite coverage unavailable.':''}</p>
        {weatherCoverage?.snapshots?.some(item=>item.provenance?.isolated_fixture)&&<p role="note">Isolated weather test fixtures</p>}
        {demo&&<button type="button" className="scene-picker__featured" aria-pressed={archiveTime===demo.stamp} onClick={()=>chooseArchive(demo.stamp)}>
          <strong>Featured satellite scene<small>2 June 2024 · 16:00 UTC</small></strong><span>{demo.satellites.length}/15 available</span>
        </button>}
        {years.length>0&&<label className="scene-picker__history-year">Browse year<select value={visibleYear} onChange={event=>setArchiveYear(Number(event.target.value))}>
          {years.map(item=><option key={item} value={item}>{item}</option>)}
        </select></label>}
        {choices.filter(item=>item!==demo&&new Date(item.stamp).getUTCFullYear()===visibleYear).map(item=>{
          const moment=new Date(item.stamp);
          const display=moment.toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:zone==='utc'?'UTC':undefined});
          return <button type="button" key={item.stamp} aria-pressed={archiveTime===item.stamp} onClick={()=>chooseArchive(item.stamp)}>
            <strong>{display} {zone==='utc'?'UTC':''}</strong><span>{historyLabel(item.weather,item.satellites.length)}{item.satellites.length>0&&<small>{item.satellites.length}/15 identities</small>}</span>
          </button>;
        })}
        {!choices.length&&<p>No verified archive dates loaded.</p>}
      </section>}
      <div className="scene-picker__zone" role="group" aria-label="Time display timezone"><button type="button" aria-pressed={zone==='local'} disabled={!date} onClick={()=>changeZone('local')}>Local</button><button type="button" aria-pressed={zone==='utc'} disabled={!date} onClick={()=>changeZone('utc')}>UTC</button><span>{zone==='utc'?'Coordinated Universal Time':localZone}</span></div>
      {!showHistory&&<>
      <div className="scene-picker__navigation"><button type="button" aria-label="Previous month" onClick={()=>changeMonth(-1)}><ChevronLeft size={18}/></button><label>Month<select aria-label="Month" value={fields.month} onChange={e=>setField('month',e.target.value)}>{MONTHS.map((name,index)=><option key={name} value={index}>{name}</option>)}</select></label><label>Year<input ref={yearInput} aria-label="Year" type="number" min="1945" max={new Date().getFullYear()} value={fields.year} onChange={e=>setField('year',e.target.value)}/></label><button type="button" aria-label="Next month" onClick={()=>changeMonth(1)}><ChevronRight size={18}/></button></div>
      <div className="scene-picker__week" aria-hidden="true">{['Su','Mo','Tu','We','Th','Fr','Sa'].map(day=><span key={day}>{day}</span>)}</div>
      <div className="scene-picker__days" role="group" aria-label={`${MONTHS[month]} ${year} calendar`}>
        {Array.from({length:first},(_,i)=><span key={`empty-${i}`}/>)}
        {Array.from({length:count},(_,i)=>i+1).map(day=>{
          const data=dayHistory(archive,zone,year,month,day);
          const kind=data.weather?(data.satellites?'both':'weather'):data.satellites?'satellites':undefined;
          return <button type="button" key={day} data-day={day} data-history={kind} aria-label={`${day} ${MONTHS[month]} ${year}${kind?`, ${historyLabel(data.weather,data.satellites)} at some time that day`:''}`} aria-pressed={Number(fields.day)===day} tabIndex={Number(fields.day)===day?0:-1} onKeyDown={event=>calendarKey(event,day)} onClick={()=>setField('day',String(day))}>{day}</button>;
        })}
      </div>
      <div className="scene-picker__time"><span>Time <small>24-hour</small></span><label>Hour<input type="number" min="0" max="23" aria-label="Hour" value={fields.hour} onChange={e=>setField('hour',e.target.value)}/></label><b>:</b><label>Minute<input type="number" min="0" max="59" aria-label="Minute" value={fields.minute} onChange={e=>setField('minute',e.target.value)}/></label></div>
      </>}
      <p className="scene-picker__equivalent" aria-live="polite">{date ? <>{date.toISOString().slice(0,16).replace('T',' · ')} UTC{showHistory&&<><br/>{date.toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'})} · {localZone}</>}</> : 'Choose a valid time from 1 January 1945 through the present. Local daylight-saving gaps cannot be selected.'}</p>
      {date&&<p className="scene-picker__availability" aria-live="polite">{exactStatus}{availability.satellites.length>0&&` · ${availability.satellites.length}/15 satellites`}</p>}
      {children&&<details><summary>Applied scene &amp; source details</summary>{children}</details>}
      <footer><button type="button" onClick={onClose}>Cancel</button><button type="submit" className="scene-picker__apply" disabled={!date}>Apply date &amp; time</button></footer>
    </form>
  </dialog>,document.body);
}
