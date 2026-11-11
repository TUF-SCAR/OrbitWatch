// Classification is confined to the precipitation inspector. A liquid-equivalent
// rate alone cannot establish rain/snow phase, and temperature is not a proxy.
import {solarLight} from './solarLight.js';
export function classifyPrecipitationHover(rate,{clouds=null,phase=null,historical=false,isDay=null,light='unknown'}={}){
  if(!Number.isFinite(rate)||rate<0)return null;
  const amount=`${Number(rate.toFixed(1))} ${historical?'mm (Preceding hour)':'mm/h (Forecast)'}`;
  if(rate<=.05){
    if(!Number.isFinite(clouds)||clouds<0||clouds>100)return {icon:'',title:'No precipitation',secondary:null,kind:'dry'};
    const day=isDay===true||light==='day',night=isDay===false||light==='night';
    if(clouds<=10)return {icon:day?'☀️':night?'🌙':'',title:day?'Sunny':'Clear',secondary:null,kind:'dry',light:day?'day':night?'night':light};
    if(clouds<=30)return {icon:day?'☀️':night?'🌙':'',title:day?'Mostly Sunny':'Mostly Clear',secondary:null,kind:'dry',light:day?'day':night?'night':light};
    if(clouds<=70)return {icon:day?'🌤️':'☁️',title:'Partly Cloudy',secondary:null,kind:'dry',light:day?'day':night?'night':light};
    return {icon:'☁️',title:'Cloudy',secondary:null,kind:'dry'};
  }
  if(phase==='snow')return {icon:'🌨️',title:`${rate<2.5?'Light':rate<25?'Moderate':'Heavy'} Snow`,secondary:amount,kind:'snow'};
  if(['freezing_rain','ice_pellets','mixed'].includes(phase))return {icon:'💧',title:`${rate<2.5?'Light':rate<7.5?'Moderate':'Heavy'} ${({freezing_rain:'Freezing Rain',ice_pellets:'Ice Pellets',mixed:'Mixed Precipitation'})[phase]}`,secondary:amount,kind:phase};
  if(phase==='rain'){
    if(rate<.2&&Number.isFinite(clouds)&&clouds<=70&&(isDay===true||light==='day'))return {icon:'🌦️',title:'Sunshine & Showers',secondary:amount,kind:'rain'};
    return {icon:'🌧️',title:`${rate<.5?'Very Light':rate<2.5?'Light':rate<7.5?'Moderate':'Heavy'} Rain`,secondary:amount,kind:'rain'};
  }
  return {icon:'💧',title:`${rate<.5?'Very Light':rate<2.5?'Light':rate<7.5?'Moderate':'Heavy'} Precipitation`,secondary:amount,kind:'precipitation'};
}

export function precipitationContext(field,longitude,latitude,sample){
  const cloudField=field.fields?.clouds||field.precipitation_clouds;
  const clouds=cloudField?.units==='%'&&cloudField.values?.length===65160?sample(cloudField.values,longitude,latitude):null;
  // Categorical phase must be explicit; never bilinearly interpolate enum codes.
  const phaseValues=field.precipitation_phase?.values;
  const x=((Math.round(longitude+180)%360)+360)%360,y=Math.max(0,Math.min(180,Math.round(90-latitude)));
  const phase=phaseValues?.length===65160?phaseValues[y*360+x]:null;
  const metadata=field.precipitation_phase;
  const validPhase=metadata?.units==='category'&&metadata.level==='surface'&&metadata.step_type==='instant'&&metadata.valid_at===field.valid_at&&['rain','snow','freezing_rain','ice_pellets','mixed','unknown'].includes(phase);
  return {clouds,phase:validPhase?phase:null,historical:field.source_kind==='era5',light:solarLight(field.valid_at,longitude,latitude,field.is_day)};
}
