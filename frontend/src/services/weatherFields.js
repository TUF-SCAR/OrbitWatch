import { rainColor, RAIN_GRADIENT } from './precipitationStyle.js';
import { sampleTemperature, temperaturePixels, TEMPERATURE_GRADIENT, rasterizeScalar } from './temperatureGrid.js';
import {validateHistoricalField} from './historicalWeather.js';
import {HUMIDITY_PALETTE,PRESSURE_PALETTE,PRECIPITATION_PALETTE,paletteColor,paletteGradient,paletteWriter} from './weatherPalettes.js';
import {phaseNodes,phaseAtNodes,phaseColor} from './precipitationPhase.js';


export const WEATHER_FIELDS={
  temperature:{label:'Temperature',title:'2 m air temperature',units:'°C',ticks:['−30','−20','−10','0','10','20','30','40','50'],gradient:TEMPERATURE_GRADIENT},
  observedClouds:{label:'Clouds'},
  clouds:{label:'Clouds · model fallback',hidden:true,title:'MODEL CLOUD COVERAGE',units:'%',ticks:['0','25','50','75','100'],gradient:'linear-gradient(90deg,transparent,#b9c5d0,#ffffff)'},
  precipitation:{label:'Precipitation rate',title:'Precipitation intensity',units:'mm/h',ticks:['0.1','1','5','12','25','50+'],logarithmic:true,gradient:RAIN_GRADIENT},
  humidity:{label:'Humidity',title:'2 m RELATIVE HUMIDITY',units:'%',ticks:['0','25','50','75','100'],gradient:paletteGradient(HUMIDITY_PALETTE)},
  pressure:{label:'Mean Sea-Level Pressure',title:'Mean sea-level pressure',units:'hPa',ticks:['970','985','1000','1015','1030','1045'],gradient:paletteGradient(PRESSURE_PALETTE)},
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
  if(field?.source_kind==='era5')return validateHistoricalField(variable,field);
  const limits={clouds:[0,100,'%'],precipitation:[0,3600,'mm/h'],wind:[-150,150,'m/s'],humidity:[0,100,'%'],pressure:[800,1200,'hPa']};
  const spec=limits[variable];if(!spec||field.units!==spec[2]||field.step_type!=='instant')throw Error('Unsupported model field');
  if(variable==='humidity'&&(field.grib_parameter!=='RH'||field.level!=='2 m above ground'||field.source_units!=='%'))throw Error('Expected modeled 2 m RH');
  if(variable==='pressure'&&(field.grib_parameter!=='PRMSL'||field.level!=='mean sea level'||field.source_units!=='Pa'))throw Error('Expected mean sea-level pressure');
  for(const values of variable==='wind'?[field.u,field.v]:[field.values]) {
    if(values?.length!==65160||values.some(v=>v!==null&&(!Number.isFinite(v)||v<spec[0]||v>spec[1])))throw Error('Invalid model nodes');
  }
}
export function validatePrecipitationPhase(phase,time){
  const allowed=['rain','snow','freezing_rain','ice_pellets','mixed','unknown'];
  if(phase?.units!=='category'||phase.level!=='surface'||phase.step_type!=='instant'||phase.valid_at!==time||phase.values?.length!==65160||phase.values.some(value=>!allowed.includes(value)))throw Error('Invalid categorical precipitation phase');
  return phase;
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
  if(palette)return paletteColor(palette,value);
  const t=Math.min(1,value/60);return [Math.round(38+110*t),Math.round(75+150*t),Math.round(105+120*t),100];
}
export function weatherPixels(field,width=720,height=360) {
  const variable=field.display_variable||'temperature';
  if(variable==='temperature')return temperaturePixels(field,width,height);
  validateModelField(variable,field);
  if(variable==='humidity'||variable==='pressure')return rasterizeScalar(field.values,width,height,paletteWriter(variable==='humidity'?HUMIDITY_PALETTE:PRESSURE_PALETTE));
  if(variable==='precipitation'){
    const rain=rasterizeScalar(field.values,width,height,paletteWriter(PRECIPITATION_PALETTE,value=>value<=.05?0:Math.round((165+65*Math.min(1,Math.log1p(value)/Math.log(51)))*Math.min(1,(value-.05)/.15)),true));
    const phases=phaseNodes(field);
    if(phases)for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const offset=(y*width+x)*4;if(!rain[offset+3])continue;
      const longitude=-180+(x+.5)*360/width,latitude=90-(y+.5)*180/height;
      const phase=phaseAtNodes(phases,longitude,latitude);
      if(phase==='rain'||phase==='unknown')continue;
      rain.set(phaseColor(sampleModel(field.values,longitude,latitude),phase),offset);
    }
    const clouds=field.precipitation_clouds||field.fields?.clouds;
    if(!clouds||field.source_kind==='era5')return rain;
    try{validateModelField('clouds',clouds);}catch{return rain;}
    const background=rasterizeScalar(clouds.values,width,height,(value,pixels,offset)=>{
      pixels[offset]=236;pixels[offset+1]=243;pixels[offset+2]=249;pixels[offset+3]=Math.round(Math.pow(value/100,1.3)*110);
    });
    // Genuine GFS cloud fraction underneath the rate, never an interpretation
    // of observed pixel brightness. No additional field acquisition occurs.
    for(let i=0;i<rain.length;i+=4){
      const foreground=rain[i+3]/255,behind=background[i+3]/255*(1-foreground),alpha=foreground+behind;
      if(alpha===0){rain[i]=rain[i+1]=rain[i+2]=0;continue;}
      for(let channel=0;channel<3;channel++)rain[i+channel]=Math.round((rain[i+channel]*foreground+background[i+channel]*behind)/alpha);
      rain[i+3]=Math.round(alpha*255);
    }
    return rain;
  }
  if(variable==='clouds')return rasterizeScalar(field.values,width,height,(value,pixels,offset)=>{pixels[offset]=232;pixels[offset+1]=240;pixels[offset+2]=248;pixels[offset+3]=Math.round(Math.pow(value/100,1.3)*235);});
  const pixels=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const lon=-180+(x+.5)*360/width,lat=90-(y+.5)*180/height;
    let value=sampleModel(variable==='wind'?field.u:field.values,lon,lat);
    if(variable==='wind'){const v=sampleModel(field.v,lon,lat);value=value===null||v===null?null:Math.hypot(value,v);}
    pixels.set(modelColor(variable,value),(y*width+x)*4);
  }
  return pixels;
}
