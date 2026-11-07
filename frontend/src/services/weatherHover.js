import {sampleTemperature} from './temperatureGrid.js';
import {sampleModel} from './weatherFields.js';

export function sampleHoverWeather(field,longitude,latitude){
  if(!field)return null;
  const variable=field.display_variable||'temperature';
  if(!['temperature','humidity','pressure','precipitation','clouds','wind'].includes(variable))return null;
  if((variable==='temperature'?field.values_c:variable==='wind'?field.u:field.values)?.length!==65160)return null;
  if(variable==='wind'&&field.v?.length!==65160)return null;
  let value=variable==='temperature'?sampleTemperature(field,longitude,latitude):sampleModel(variable==='wind'?field.u:field.values,longitude,latitude);
  if(variable==='wind'){
    const v=sampleModel(field.v,longitude,latitude);if(value===null||v===null)return null;value=Math.hypot(value,v)*3.6;
  }
  if(value===null||!Number.isFinite(value))return null;
  const units=variable==='temperature'?'°C':variable==='pressure'?' hPa':variable==='precipitation'?field.source_kind==='era5'?' mm':' mm/h':variable==='wind'?' km/h':'%';
  const text=variable==='precipitation'?`${value<.05?'0':value<10?value.toFixed(1):Math.round(value)}${units}`:`${Math.round(value)}${units}`;
  return {value,variable,text,units:units.trim()};
}
export function weatherHoverBlocked(picked){
  const id=picked?.id,properties=id?.properties,celestial=properties?.celestialId?.getValue?.();
  return Boolean(id?.orbitwatchEventCluster||properties?.noradId||properties?.naturalEventId||celestial&&celestial!=='earth');
}
export function weatherHoverPosition(point,width,height,bubbleWidth,bubbleHeight){
  const x=Math.max(8,Math.min(width-bubbleWidth-8,point.x-bubbleWidth/2));
  const below=point.y-bubbleHeight-17<8;
  const y=Math.max(8,Math.min(height-bubbleHeight-8,below?point.y+18:point.y-bubbleHeight-17));
  return {x,y,below,pointer:Math.max(10,Math.min(bubbleWidth-10,point.x-x))};
}

// One DOM bubble and one pending animation callback. No requests, React state,
// selection changes, or additional Cesium input handlers.
export function createWeatherHover({mount,canvas,getState,pickLocation,
  doc=document,schedule=requestAnimationFrame,cancel=cancelAnimationFrame,
}={}){
  const bubble=doc.createElement('div');bubble.className='weather-hover';bubble.hidden=true;
  bubble.setAttribute('role','tooltip');bubble.setAttribute('aria-label','Weather at pointer');mount.append(bubble);
  let pending=null,latest=null,destroyed=false,lastText='',updates=0;
  function hide(){if(pending!==null)cancel(pending);pending=null;latest=null;bubble.hidden=true;}
  function render(){
    pending=null;const state=getState(),movement=latest;
    if(destroyed||!movement||!state.enabled||state.dragging||!state.field||weatherHoverBlocked(movement.picked)){hide();return;}
    const location=pickLocation(movement.position),reading=location&&sampleHoverWeather(state.field,location.longitude,location.latitude);
    if(!reading){hide();return;}
    if(lastText!==reading.text){bubble.textContent=reading.text;lastText=reading.text;updates++;}
    bubble.dataset.variable=reading.variable;
    bubble.title=`${state.field.source_kind==='era5'?'ERA5 reanalysis':'GFS model'} · ${state.field.valid_at}`;
    bubble.hidden=false;
    const placement=weatherHoverPosition(movement.position,canvas.clientWidth,canvas.clientHeight,bubble.offsetWidth,bubble.offsetHeight);
    bubble.style.transform=`translate3d(${placement.x}px,${placement.y}px,0)`;
    bubble.style.setProperty('--weather-hover-pointer',`${placement.pointer}px`);
    bubble.classList.toggle('is-below',placement.below);
  }
  canvas.addEventListener('pointerleave',hide);
  return {
    move(position,picked){
      if(destroyed)return;
      latest={position:{x:position.x,y:position.y},picked};if(pending===null)pending=schedule(render);
    },hide,
    diagnostics:()=>({visible:!bubble.hidden,pending:pending!==null,textUpdates:updates}),
    destroy(){if(destroyed)return;hide();destroyed=true;canvas.removeEventListener('pointerleave',hide);bubble.remove();},
  };
}
