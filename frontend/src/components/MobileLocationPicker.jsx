import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {X} from 'lucide-react';
import {STREET_MAP} from '../services/streetMapConfig.js';

const zones=[...new Set(['UTC',...(typeof Intl.supportedValuesOf==='function'?Intl.supportedValuesOf('timeZone'):[])])];
const validPoint=d=>String(d.latitude).trim()!==''&&String(d.longitude).trim()!==''&&Number.isFinite(Number(d.latitude))&&Number.isFinite(Number(d.longitude));
export default function MobileLocationPicker({account}){
 const {state,owner}=account,draft=state.locationDraft;
 const [form,setForm]=useState(()=>({...draft})),[point,setPoint]=useState(()=>validPoint(draft)?{lat:Number(draft.latitude),lng:Number(draft.longitude)}:null);
 const [confirmedZone,setConfirmedZone]=useState(Boolean(draft.id&&draft.timezone)),[error,setError]=useState(''),[tileError,setTileError]=useState(false);
 const dialog=useRef(null),host=useRef(null),mapRef=useRef(null),layers=useRef({});
 const radius=state.preferences?.event_radius_km;
 const disabled=state.busy||state.phase!=='ready';
 function choosePoint(p){const next={lat:Math.max(-90,Math.min(90,p.lat)),lng:((p.lng+180)%360+360)%360-180};setPoint(next);setError('');}
 useEffect(()=>{
  const node=dialog.current,opener=document.activeElement;node.showModal();node.querySelector('button')?.focus({preventScroll:true});
  const seed=validPoint(draft)?[Number(draft.latitude),Number(draft.longitude)]:[20,0];
  const map=L.map(host.current,{center:seed,zoom:validPoint(draft)?12:2,zoomControl:true,worldCopyJump:true});mapRef.current=map;
  // Same approved labeled raster as the main map; visible tiles only, no geocoder or prefetch.
  L.tileLayer(STREET_MAP.url,{maxZoom:STREET_MAP.maximumLevel,keepBuffer:0,updateWhenIdle:true,attribution:STREET_MAP.attribution}).on('tileerror',()=>setTileError(true)).addTo(map);
  map.on('click',e=>choosePoint(e.latlng));
  let frame;const resize=new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>map.invalidateSize({pan:false}));});resize.observe(host.current);
  return()=>{resize.disconnect();cancelAnimationFrame(frame);map.remove();mapRef.current=null;layers.current={};node.close();if(opener?.isConnected)opener.focus({preventScroll:true});};
  // One independent map for the lifetime of this draft; point/radius updates never reset its camera.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 useEffect(()=>{
  const map=mapRef.current;if(!map||!point)return;
  if(layers.current.pin)layers.current.pin.setLatLng(point);
  else layers.current.pin=L.marker(point,{icon:L.divIcon({className:'location-map-pin',html:'<span></span>',iconSize:[24,32],iconAnchor:[12,32]}),draggable:true,title:'Selected observation point'}).on('dragend',e=>choosePoint(e.target.getLatLng())).addTo(map);
  if(Number.isFinite(radius)&&radius>0){
   if(layers.current.coverage)layers.current.coverage.setLatLng(point).setRadius(radius*1000);
   else layers.current.coverage=L.circle(point,{radius:radius*1000,color:'#087e9a',weight:2,fillColor:'#31bdcf',fillOpacity:0.07,interactive:false}).addTo(map);
  }
 },[point,radius]);
 const change=patch=>setForm(v=>({...v,...patch}));
 function save(event){
  event.preventDefault();if(!point){setError('Tap the map or use Set pin here to choose the observing point.');return;}
  try{new Intl.DateTimeFormat('en',{timeZone:form.timezone}).format();}catch{setError('Choose a valid IANA timezone.');return;}
  if(!confirmedZone){setError('Confirm the timezone for this location.');return;}
  owner.changeLocation({...form,latitude:String(point.lat),longitude:String(point.lng)});owner.saveLocation();
 }
 return createPortal(<dialog ref={dialog} className="mobile-location-picker" aria-label={draft.id?'Edit observation location':'Add observation location'} onCancel={e=>{e.preventDefault();if(!state.busy)owner.cancelLocation();}} onKeyDown={e=>e.stopPropagation()}>
  <header><div><small>MY SKYWATCH · LOCATIONS</small><h2>{draft.id?'Edit location':'Choose a location'}</h2></div><button type="button" aria-label="Close location picker" disabled={state.busy} onClick={()=>owner.cancelLocation()}><X size={20}/></button></header>
  <div className="location-map" ref={host} aria-label="Street map. Pan, then use Set pin here to choose the center."/>
  <div className="location-map-controls"><button type="button" onClick={()=>choosePoint(mapRef.current.getCenter())}>Set pin here</button><button type="button" disabled={!point||!Number.isFinite(radius)} onClick={()=>{const circle=layers.current.coverage;if(circle)mapRef.current.fitBounds(circle.getBounds(),{padding:[20,20],animate:false});}}>Fit coverage</button><small>Natural-event alert radius · {Number.isFinite(radius)?`${radius} km`:'unavailable'}</small></div>
  <form id="mobile-location-form" onSubmit={save} className="location-picker-form"><fieldset disabled={disabled}>
   {tileError&&<p role="status">Street tiles unavailable. Retry opening the picker when connected.</p>}
   <p className="location-point-status" role="status">{point?'Pin selected · pan or tap to adjust':'Tap the map to place your pin.'}</p>
   <label>Location name<input maxLength={80} required value={form.name} onChange={e=>change({name:e.target.value})}/></label>
   <label>Location timezone<input list="location-picker-zones" required maxLength={64} placeholder="Search IANA timezone, e.g. Asia/Kolkata" value={form.timezone} onChange={e=>{change({timezone:e.target.value});setConfirmedZone(false);}}/></label>
   <datalist id="location-picker-zones">{zones.map(zone=><option key={zone} value={zone}/>)}</datalist>
   <label className="account-toggle"><input type="checkbox" required checked={confirmedZone} onChange={e=>setConfirmedZone(e.target.checked)}/> I confirm this location’s timezone</label>
   <small>Choose the zone for the pin. Your phone timezone is never used to fill it.</small>
   <label className="account-toggle"><input type="checkbox" checked={form.is_default} disabled={Boolean(draft.id&&state.locations.find(r=>r.id===draft.id)?.is_default)} onChange={e=>change({is_default:e.target.checked})}/> Use as default</label>
   <small>The first saved location becomes your default. The radius is shared across your account.</small>
   {(error||state.error)&&<p role="alert">{error||state.error}</p>}
  </fieldset></form>
  <footer className="location-picker-footer"><button type="button" disabled={state.busy} onClick={()=>owner.cancelLocation()}>Cancel</button><button type="submit" form="mobile-location-form" disabled={disabled||!point||!draft.id&&state.locations.length>=5}>{state.busy?'Saving…':'Save location'}</button></footer>
 </dialog>,document.body);
}
