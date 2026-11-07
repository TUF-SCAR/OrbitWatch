// Grid nodes: 90N..90S, 180W..179E. Interpolation does not add model resolution.
import {TEMPERATURE_PALETTE,paletteColor,paletteGradient,paletteWriter} from './weatherPalettes.js';
export {TEMPERATURE_PALETTE} from './weatherPalettes.js';
export const TEMPERATURE_GRADIENT=paletteGradient(TEMPERATURE_PALETTE);
export function validateTemperatureField(field) {
  const g=field?.grid;
  if(!g || g.width!==360 || g.height!==181 || g.west!==-180 || g.north!==90 || g.step!==1 || field.units!=='°C' || field.values_c?.length!==65160 || !Number.isFinite(Date.parse(field.valid_at))) throw Error('Unsupported temperature grid');
  if(field.values_c.some(v=>v!==null&&(!Number.isFinite(v)||v < -133.15||v>86.85))) throw Error('Invalid temperature values');
  return field;
}
export function sampleTemperature(field,longitude,latitude) {
  if(!Number.isFinite(longitude)||!Number.isFinite(latitude)||Math.abs(latitude)>90)return null;
  const x=((longitude+180)%360+360)%360,y=Math.max(0,Math.min(180,90-latitude));
  const x0=Math.floor(x),y0=Math.floor(y),dx=x-x0,dy=y-y0;
  const values=field.values_c,x1=(x0+1)%360,y1=Math.min(180,y0+1);
  const a=values[y0*360+x0],b=values[y0*360+x1],c=values[y1*360+x0],d=values[y1*360+x1];
  if(!Number.isFinite(a)||(dx>0&&!Number.isFinite(b))||(dy>0&&!Number.isFinite(c))||(dx>0&&dy>0&&!Number.isFinite(d)))return null;
  let value=a*(1-dx)*(1-dy);
  if(dx>0)value+=b*dx*(1-dy);
  if(dy>0)value+=c*(1-dx)*dy;
  if(dx>0&&dy>0)value+=d*dx*dy;
  return value;
}
export function temperatureColor(value) {
  return paletteColor(TEMPERATURE_PALETTE,value);
}
export function temperaturePixels(field,width=720,height=360) {
  validateTemperatureField(field);
  return rasterizeScalar(field.values_c,width,height,paletteWriter(TEMPERATURE_PALETTE));
}
export function rasterizeScalar(values,width,height,write){
  const pixels=new Uint8ClampedArray(width*height*4);
  const columns=new Uint16Array(width),weights=new Float64Array(width);
  for(let x=0;x<width;x++){const position=(x+.5)*360/width;columns[x]=Math.floor(position);weights[x]=position-columns[x];}
  for(let y=0;y<height;y++){
    const row=(y+.5)*180/height,y0=Math.floor(row),dy=row-y0,top=y0*360,bottom=Math.min(180,y0+1)*360;
    for(let x=0;x<width;x++){
      const x0=columns[x],x1=(x0+1)%360,dx=weights[x],a=values[top+x0],b=values[top+x1],c=values[bottom+x0],d=values[bottom+x1];
      if(!Number.isFinite(a)||dx>0&&!Number.isFinite(b)||dy>0&&!Number.isFinite(c)||dx>0&&dy>0&&!Number.isFinite(d))continue;
      let value=a*(1-dx)*(1-dy);if(dx>0)value+=b*dx*(1-dy);if(dy>0)value+=c*(1-dx)*dy;if(dx>0&&dy>0)value+=d*dx*dy;
      write(value,pixels,(y*width+x)*4);
    }
  }
  return pixels;
}
export function weatherFreshness(field,now=Date.now(),kind='global') {
  if(!field)return 'unavailable';
  const validAge=now-Date.parse(field.valid_at),cacheAge=now-Date.parse(field.retrieved_at);
  const location=kind==='location';
  if(!Number.isFinite(validAge)||!Number.isFinite(cacheAge)||validAge>(location?10800000:86400000)||validAge< -10800000)return 'unavailable';
  return field.state==='stale'||validAge>(location?1800000:21600000)||cacheAge>(location?900000:21600000)?'stale':'available';
}
