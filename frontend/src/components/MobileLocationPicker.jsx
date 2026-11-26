import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {X} from 'lucide-react';
import {getCachedStartupCountry} from '../services/startupCountry.js';
import {STREET_MAP} from '../services/streetMapConfig.js';
import {resolveLocationTimezone} from '../services/orbitwatchApi.js';

const zones=[...new Set(['UTC',...(typeof Intl.supportedValuesOf==='function'?Intl.supportedValuesOf('timeZone'):[])])];
function zoneLabel(zone){try{const part=style=>new Intl.DateTimeFormat('en',{timeZone:zone,timeZoneName:style}).formatToParts(new Date()).find(p=>p.type==='timeZoneName').value;return `${part('long')} · ${part('longOffset').replace('GMT','UTC')}`;}catch{return zone||'';}}
const validPoint=d=>String(d.latitude).trim()!==''&&String(d.longitude).trim()!==''&&Number.isFinite(Number(d.latitude))&&Number.isFinite(Number(d.longitude));
const validZone=zone=>{try{return Boolean(zone)&&Boolean(new Intl.DateTimeFormat('en',{timeZone:zone}).format());}catch{return false;}};
export default function MobileLocationPicker({account}){
 const {state,owner}=account,draft=state.locationDraft;
 const [form,setForm]=useState(()=>({...draft})),[point,setPoint]=useState(()=>validPoint(draft)?{lat:Number(draft.latitude),lng:Number(draft.longitude)}:null);
 const [coordinates,setCoordinates]=useState(()=>({latitude:String(draft.latitude??''),longitude:String(draft.longitude??'')}));
 const [confirmedZone,setConfirmedZone]=useState(Boolean(draft.id&&draft.timezone)),[error,setError]=useState(''),[tileError,setTileError]=useState(false);
 const [zoneState,setZoneState]=useState(draft.id?'saved':'idle'),[zoneText,setZoneLabel]=useState(()=>zoneLabel(draft.timezone)),[changeZone,setChangeZone]=useState(false);
 const dialog=useRef(null),host=useRef(null),mapRef=useRef(null),layers=useRef({});
 const zoneRevision=useRef(0);
 const radius=state.preferences?.event_radius_km;
 const disabled=state.busy||state.phase!=='ready';
 function choosePoint(p){
  zoneRevision.current++;
  const next={lat:Math.max(-90,Math.min(90,p.lat)),lng:((p.lng+180)%360+360)%360-180};
  const original=draft.id&&next.lat===Number(draft.latitude)&&Math.abs(next.lng-Number(draft.longitude))<1e-9;
  setPoint(original?{lat:Number(draft.latitude),lng:Number(draft.longitude)}:next);
  setCoordinates({latitude:next.lat.toFixed(6),longitude:next.lng.toFixed(6)});
  setZoneState(original?'saved':'loading');setConfirmedZone(Boolean(original&&draft.timezone));setError('');
  if(original){setForm(value=>({...value,timezone:draft.timezone}));setZoneLabel(zoneLabel(draft.timezone));}
 }
 function useLocation(){
  if(!navigator.geolocation){setError('Device location is unavailable. Choose a point on the map.');return;}
  const revision=zoneRevision.current;
  navigator.geolocation.getCurrentPosition(({coords})=>{
   if(!mapRef.current||revision!==zoneRevision.current)return;
   const next={lat:coords.latitude,lng:coords.longitude};
   mapRef.current.setView(next,12);choosePoint(next);
  },()=>{if(mapRef.current&&revision===zoneRevision.current)setError('Device location is unavailable or blocked. Choose a point on the map.');},{timeout:5000,maximumAge:60000});
 }
 function setManualPoint(){
  const lat=Number(coordinates.latitude),lng=Number(coordinates.longitude);
  if(!validPoint(coordinates)||Math.abs(lat)>90||Math.abs(lng)>180){setError('Enter latitude from −90 to 90 and longitude from −180 to 180.');return;}
  mapRef.current?.setView({lat,lng},12);
  choosePoint({lat,lng});
 }
 useEffect(()=>{
  if(!point)return;
  if(draft.id&&point.lat===Number(draft.latitude)&&point.lng===Number(draft.longitude))return;
  const controller=new AbortController(),revision=zoneRevision.current;
  const timer=setTimeout(()=>{resolveLocationTimezone(point,controller.signal).then(result=>{
   if(controller.signal.aborted||revision!==zoneRevision.current)return;
   if(result.state!=='available'){setZoneState('unavailable');setChangeZone(true);return;}
   setForm(value=>({...value,timezone:result.timezone}));setZoneLabel(zoneLabel(result.timezone));setConfirmedZone(true);setZoneState('ready');setChangeZone(false);
  }).catch(()=>{if(!controller.signal.aborted&&revision===zoneRevision.current){setZoneState('unavailable');setChangeZone(true);}});},300);
  return()=>{clearTimeout(timer);controller.abort();};
 },[point,draft.id,draft.latitude,draft.longitude]);
 useEffect(()=>{
  const node=dialog.current,opener=document.activeElement;node.showModal();node.querySelector('button')?.focus({preventScroll:true});
  const region=getCachedStartupCountry();const seed=validPoint(draft)?[Number(draft.latitude),Number(draft.longitude)]:[(region.south+region.north)/2,(region.west+region.east)/2];
  const map=L.map(host.current,{center:seed,zoom:validPoint(draft)?12:2,zoomControl:true,worldCopyJump:true});mapRef.current=map;
  let alive=true;
  if(!validPoint(draft)&&navigator.permissions&&navigator.geolocation){
   navigator.permissions.query({name:'geolocation'}).then(permission=>{
    if(!alive||permission.state!=='granted')return;
    navigator.geolocation.getCurrentPosition(result=>{if(alive&&!layers.current.pin)map.setView([result.coords.latitude,result.coords.longitude],10);},()=>{},{timeout:1800,maximumAge:60000});
   }).catch(()=>{});
  }
  // Same approved labeled raster as the main map; visible tiles only, no geocoder or prefetch.
  L.tileLayer(STREET_MAP.url,{maxZoom:STREET_MAP.maximumLevel,keepBuffer:0,updateWhenIdle:true,attribution:STREET_MAP.attribution}).on('tileerror',()=>setTileError(true)).addTo(map);
  map.on('click',e=>choosePoint(e.latlng));
  let frame;const resize=new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>map.invalidateSize({pan:false}));});resize.observe(host.current);
  return()=>{alive=false;resize.disconnect();cancelAnimationFrame(frame);map.remove();mapRef.current=null;layers.current={};node.close();if(opener?.isConnected)opener.focus({preventScroll:true});};
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
  if(!validZone(form.timezone)){setError('Choose a valid IANA timezone.');return;}
  if(!confirmedZone){setError('Choose the timezone for this location.');return;}
  owner.changeLocation({...form,latitude:String(point.lat),longitude:String(point.lng)});owner.saveLocation();
 }
 return createPortal(<dialog ref={dialog} className="mobile-location-picker" aria-label={draft.id?'Edit observation location':'Add observation location'} onCancel={e=>{e.preventDefault();if(!state.busy)owner.cancelLocation();}} onKeyDown={e=>e.stopPropagation()}>
  <header><div><small>MY SKYWATCH · LOCATIONS</small><h2>{draft.id?'Edit location':'Choose a location'}</h2></div><button type="button" aria-label="Close location picker" disabled={state.busy} onClick={()=>owner.cancelLocation()}><X size={20}/></button></header>
  <div className="location-map" ref={host} aria-label="Street map. Pan, then use Set pin here to choose the center."/>
  <div className="location-map-controls"><button type="button" onClick={()=>choosePoint(mapRef.current.getCenter())}>Set pin here</button><button type="button" onClick={useLocation}>Use my location</button><button type="button" disabled={!point||!Number.isFinite(radius)} onClick={()=>{const circle=layers.current.coverage;if(circle)mapRef.current.fitBounds(circle.getBounds(),{padding:[20,20],animate:false});}}>Fit coverage</button><small>Natural-event alert radius · {Number.isFinite(radius)?`${radius} km`:'unavailable'}</small></div>
  <form id="mobile-location-form" onSubmit={save} className="location-picker-form"><fieldset disabled={disabled}>
   {tileError&&<p role="status">Street tiles unavailable. Retry opening the picker when connected.</p>}
   <p className="location-point-status" role="status">{point?'Pin selected · pan or tap to adjust':'Tap the map to place your pin.'}</p>
   <details><summary>Enter coordinates</summary><div className="account-coordinate-row">
     <label>Latitude<input type="number" min="-90" max="90" step="any" value={coordinates.latitude} onChange={e=>setCoordinates({...coordinates,latitude:e.target.value})}/></label>
     <label>Longitude<input type="number" min="-180" max="180" step="any" value={coordinates.longitude} onChange={e=>setCoordinates({...coordinates,longitude:e.target.value})}/></label>
   </div><button type="button" onClick={setManualPoint}>Set coordinates</button></details>
   <label>Location name<input maxLength={80} required value={form.name} onChange={e=>change({name:e.target.value})}/></label>
   <p role="status">Timezone · {zoneState==='loading'?'Finding timezone…':zoneState==='unavailable'?'Choose a timezone below':zoneText||'Choose a point first'}</p><button type="button" onClick={()=>setChangeZone(v=>!v)}>Change timezone</button>
   {changeZone&&<><label>Search timezone<input list="location-picker-zones" required maxLength={64} placeholder="Search city or IANA timezone" value={form.timezone} onChange={e=>{zoneRevision.current++;change({timezone:e.target.value});setConfirmedZone(false);}}/></label><button type="button" onClick={()=>{if(!validZone(form.timezone)){setError('Choose a valid timezone from the list.');return;}zoneRevision.current++;setConfirmedZone(true);setZoneState('ready');setZoneLabel(zoneLabel(form.timezone));setChangeZone(false);setError('');}}>Use timezone</button></>}
   <datalist id="location-picker-zones">{zones.map(zone=><option key={zone} value={zone}/>)}</datalist>
   <small>OrbitWatch detects the timezone from your chosen pin. <a href="https://github.com/evansiroky/timezone-boundary-builder" target="_blank" rel="noreferrer">Timezone boundaries · ODbL</a></small>
   <label className="account-toggle"><input type="checkbox" checked={form.is_default} disabled={Boolean(draft.id&&state.locations.find(r=>r.id===draft.id)?.is_default)} onChange={e=>change({is_default:e.target.checked})}/> Use as default</label>
   <small>The first saved location becomes your default. The radius is shared across your account.</small>
   {(error||state.error)&&<p role="alert">{error||state.error}</p>}
  </fieldset></form>
  <footer className="location-picker-footer"><button type="button" disabled={state.busy} onClick={()=>owner.cancelLocation()}>Cancel</button><button type="submit" form="mobile-location-form" disabled={disabled||!point||!draft.id&&state.locations.length>=5}>{state.busy?'Saving…':'Save location'}</button></footer>
 </dialog>,document.body);
}
