import { sampleTemperature, temperaturePixels, TEMPERATURE_GRADIENT } from './temperatureGrid.js';

export const WEATHER_FIELDS={
  temperature:{label:'Temperature',title:'2 m AIR TEMPERATURE',units:'°C',ticks:['≤−60','−30','0','30','≥60'],gradient:TEMPERATURE_GRADIENT},
  clouds:{label:'Cloud coverage',title:'MODEL CLOUD COVERAGE',units:'%',ticks:['0','25','50','75','100'],gradient:'linear-gradient(90deg,transparent,#b9c5d0,#ffffff)'},
  precipitation:{label:'Precipitation rate',title:'PRECIPITATION RATE',units:'mm/h',ticks:['0.1','1','5','20','≥50'],gradient:'linear-gradient(90deg,#244b93,#309ee1,#64eeec,#d4ffff)'},
  wind:{label:'Surface wind',title:'10 m WIND · TOWARD',units:'m/s',ticks:['0','5','15','30','≥60'],gradient:'linear-gradient(90deg,#26395d,#398c9d,#91e0d9)'},
};
export function selectWeatherField(bundle,variable='temperature') {
  if(!bundle)return null;
  if(variable==='temperature')return bundle;
  const field=bundle.fields?.[variable];if(!field)return null;
  validateModelField(variable,field);
  return {...bundle,...field,id:`${bundle.id}:${variable}`,display_variable:variable};
}
export function validateModelField(variable,field) {
  const limits={clouds:[0,100,'%'],precipitation:[0,3600,'mm/h'],wind:[-150,150,'m/s']};
  const spec=limits[variable];if(!spec||field.units!==spec[2]||field.step_type!=='instant')throw Error('Unsupported model field');
  for(const values of variable==='wind'?[field.u,field.v]:[field.values]) {
    if(values?.length!==65160||values.some(v=>v!==null&&(!Number.isFinite(v)||v<spec[0]||v>spec[1])))throw Error('Invalid model nodes');
  }
}
export function sampleModel(values,longitude,latitude){return sampleTemperature({values_c:values},longitude,latitude);}
export function modelColor(variable,value) {
  if(value===null||!Number.isFinite(value))return [0,0,0,0];
  if(variable==='clouds')return [232,240,248,Math.round(Math.pow(value/100,1.3)*235)];
  if(variable==='precipitation'){
    if(value<.1)return [0,0,0,0];
    const t=Math.min(1,Math.log1p(value)/Math.log(51));
    return [Math.round(40+160*t),Math.round(115+140*t),245,Math.round(120+135*t)];
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
// Static vectors from this model valid time. No fabricated parcel animation.
export function drawWindVectors(context,field,width,height) {
  context.strokeStyle='rgba(220,255,252,.9)';context.lineWidth=1;
  for(let lat=-75;lat<=75;lat+=10)for(let lon=-175;lon<180;lon+=10){
    const u=sampleModel(field.u,lon,lat),v=sampleModel(field.v,lon,lat);
    if(u===null||v===null||Math.hypot(u,v)<.5)continue;
    // Equirectangular eastward displacement needs the longitude metric factor.
    const dx=u/Math.cos(lat*Math.PI/180),dy=-v,len=Math.hypot(dx,dy),scale=(4+Math.min(7,Math.hypot(u,v)/3))/len;
    const x=(lon+180)/360*width,y=(90-lat)/180*height,ex=x+dx*scale,ey=y+dy*scale,angle=Math.atan2(dy,dx);
    context.beginPath();context.moveTo(x,y);context.lineTo(ex,ey);
    for(const side of [-1,1]){context.moveTo(ex,ey);context.lineTo(ex-3*Math.cos(angle+side*.55),ey-3*Math.sin(angle+side*.55));}
    context.stroke();
  }
}
