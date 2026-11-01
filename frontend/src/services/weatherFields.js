import { rainColor, RAIN_GRADIENT } from './precipitationStyle.js';
import { sampleTemperature, temperaturePixels, TEMPERATURE_GRADIENT } from './temperatureGrid.js';

const HUMIDITY_PALETTE=[[0,137,92,63],[25,203,170,99],[50,90,175,165],[75,74,135,207],[100,146,123,216]];
const PRESSURE_PALETTE=[[900,65,85,174],[980,62,170,194],[1013,172,218,201],[1040,211,159,178],[1100,149,87,172]];
const paletteGradient=palette=>`linear-gradient(90deg,${palette.map(([value,r,g,b])=>`rgb(${r},${g},${b}) ${(value-palette[0][0])/(palette.at(-1)[0]-palette[0][0])*100}%`).join(',')})`;

export const WEATHER_FIELDS={
  temperature:{label:'Temperature',title:'2 m AIR TEMPERATURE',units:'°C',ticks:['≤−60','−30','0','30','≥60'],gradient:TEMPERATURE_GRADIENT},
  observedClouds:{label:'Clouds'},
  clouds:{label:'Clouds · model fallback',hidden:true,title:'MODEL CLOUD COVERAGE',units:'%',ticks:['0','25','50','75','100'],gradient:'linear-gradient(90deg,transparent,#b9c5d0,#ffffff)'},
  precipitation:{label:'Precipitation rate',title:'PRECIPITATION RATE',units:'mm/h',ticks:['0.1','1','5','12','25','50+'],gradient:RAIN_GRADIENT},
  humidity:{label:'Humidity',title:'2 m RELATIVE HUMIDITY',units:'%',ticks:['0','25','50','75','100'],gradient:paletteGradient(HUMIDITY_PALETTE)},
  pressure:{label:'Mean Sea-Level Pressure',title:'MEAN SEA-LEVEL PRESSURE',units:'hPa',ticks:['≤900','950','1000','1050','≥1100'],gradient:paletteGradient(PRESSURE_PALETTE)},
  wind:{label:'Wind Flow',hidden:true,title:'10 m WIND · TOWARD',units:'km/h',ticks:['0','18','54','108','≥216'],gradient:'linear-gradient(90deg,#26395d,#398c9d,#91e0d9)'},
};
export function selectWeatherField(bundle,variable='temperature') {
  if(!bundle)return null;
  if(variable==='temperature')return bundle;
  const field=bundle.fields?.[variable];if(!field)return null;
  try {validateModelField(variable,field);}
  catch(error) {if(variable==='humidity'||variable==='pressure')return null;throw error;}
  return {...bundle,...field,id:`${bundle.id}:${variable}`,display_variable:variable};
}
export function validateModelField(variable,field) {
  const limits={clouds:[0,100,'%'],precipitation:[0,3600,'mm/h'],wind:[-150,150,'m/s'],humidity:[0,100,'%'],pressure:[800,1200,'hPa']};
  const spec=limits[variable];if(!spec||field.units!==spec[2]||field.step_type!=='instant')throw Error('Unsupported model field');
  if(variable==='humidity'&&(field.grib_parameter!=='RH'||field.level!=='2 m above ground'||field.source_units!=='%'))throw Error('Expected modeled 2 m RH');
  if(variable==='pressure'&&(field.grib_parameter!=='PRMSL'||field.level!=='mean sea level'||field.source_units!=='Pa'))throw Error('Expected mean sea-level pressure');
  for(const values of variable==='wind'?[field.u,field.v]:[field.values]) {
    if(values?.length!==65160||values.some(v=>v!==null&&(!Number.isFinite(v)||v<spec[0]||v>spec[1])))throw Error('Invalid model nodes');
  }
}
export function needsModelWeather(variable,cloudFallback,windEnabled,labelWeather=false) {
  return variable!=='observedClouds'||cloudFallback||windEnabled||labelWeather;
}
export function sampleModel(values,longitude,latitude){return sampleTemperature({values_c:values},longitude,latitude);}
export function modelColor(variable,value) {
  if(value===null||!Number.isFinite(value))return [0,0,0,0];
  if(variable==='clouds')return [232,240,248,Math.round(Math.pow(value/100,1.3)*235)];
  if(variable==='precipitation')return rainColor(value);
  const palette=variable==='humidity'?HUMIDITY_PALETTE:variable==='pressure'?PRESSURE_PALETTE:null;
  if(palette) {
    const v=Math.max(palette[0][0],Math.min(palette.at(-1)[0],value));
    const i=Math.max(1,palette.findIndex(stop=>stop[0]>=v)),a=palette[i-1],b=palette[i],t=(v-a[0])/(b[0]-a[0]);
    return [1,2,3].map(k=>Math.round(a[k]+(b[k]-a[k])*t)).concat(235);
  }
  const t=Math.min(1,value/60);return [Math.round(38+110*t),Math.round(75+150*t),Math.round(105+120*t),100];
}
export function weatherPixels(field,width=720,height=360) {
  const variable=field.display_variable||'temperature';
  if(variable==='temperature')return temperaturePixels(field,width,height);
  validateModelField(variable,field);
  const pixels=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const lon=-180+(x+.5)*360/width,lat=90-(y+.5)*180/height;
    let value=sampleModel(variable==='wind'?field.u:field.values,lon,lat);
    if(variable==='wind'){const v=sampleModel(field.v,lon,lat);value=value===null||v===null?null:Math.hypot(value,v);}
    pixels.set(modelColor(variable,value),(y*width+x)*4);
  }
  return pixels;
}
