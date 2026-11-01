import {selectWeatherField,sampleModel} from './weatherFields.js';
import {validateTemperatureField,sampleTemperature,weatherFreshness} from './temperatureGrid.js';

export function createPlaceWeatherReadings({now=Date.now}={}) {
  let previous=null,primary=null,wind=null,stale=false;
  const readings=new Map();let samples=0,generation=0;
  return {
    configure(context={}) {
      const keys=['bundle','variable','windEnabled','enabled','compatible','mode','freshness'];
      const ageState=weatherFreshness(context.bundle,Math.max(context.clock||0,now()),'global');
      if(previous&&previous.ageState===ageState&&keys.every(key=>previous[key]===context[key]))return false;
      previous={...context,ageState};readings.clear();primary=null;wind=null;generation++;
      const {bundle,variable,windEnabled,enabled,compatible,mode,freshness}=context;
      if(mode!=='live'||!enabled||!compatible||!bundle||!['available','stale'].includes(freshness))return true;
      if(ageState==='unavailable')return true;
      stale=freshness==='stale'||ageState==='stale';
      try {validateTemperatureField(bundle);}catch {return true;}
      try {primary=selectWeatherField(bundle,variable==='observedClouds'?'clouds':variable);}
      catch {primary=null;}
      if(windEnabled){try {wind=selectWeatherField(bundle,'wind');}catch {wind=null;}}
      return true;
    },
    get(place) {
      if(place.kind==='country')return [];
      if(readings.has(place.id))return readings.get(place.id);
      let measurement='',flow='';
      const suffix=stale?' · cached':'';
      if(primary) {
        const variable=primary.display_variable||'temperature';
        const value=variable==='temperature'?sampleTemperature(primary,place.longitude,place.latitude):sampleModel(primary.values,place.longitude,place.latitude);
        samples++;
        if(value!==null&&Number.isFinite(value)) {
          const rounded=Number(value.toFixed(variable==='pressure'?1:variable==='precipitation'?2:variable==='temperature'?1:0));
          measurement=({temperature:`${rounded}°C`,clouds:`${value<15?'☀':'☁'} ${rounded}%`,precipitation:`Rate ${rounded} mm/h`,humidity:`Humidity ${rounded}%`,pressure:`MSLP ${rounded} hPa`})[variable]||'';
          if(measurement)measurement+=suffix;
        }
      }
      if(wind) {
        const u=sampleModel(wind.u,place.longitude,place.latitude),v=sampleModel(wind.v,place.longitude,place.latitude);samples+=2;
        if(u!==null&&v!==null&&Number.isFinite(u)&&Number.isFinite(v))flow=`Wind ${Math.round(Math.hypot(u,v)*3.6)} km/h${suffix}`;
      }
      const result=[measurement,flow].filter(Boolean);
      readings.set(place.id,result);return result;
    },
    diagnostics:()=>({samples,cachedPlaces:readings.size,generation,primary:!!primary,wind:!!wind}),
  };
}
