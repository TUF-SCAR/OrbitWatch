// Grid nodes: 90N..90S, 180W..179E. Interpolation does not add model resolution.
export const TEMPERATURE_PALETTE = [[-60,38,33,82],[-40,40,75,183],[-20,67,140,209],[0,130,212,208],[15,215,233,171],[30,244,189,90],[45,214,87,62],[60,134,42,69]];
export const TEMPERATURE_GRADIENT = `linear-gradient(90deg,${TEMPERATURE_PALETTE.map(([v,r,g,b])=>`rgb(${r},${g},${b}) ${(v+60)/1.2}%`).join(',')})`;
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
  let value=0;
  for(const [xx,yy,w] of [[x0,y0,(1-dx)*(1-dy)],[(x0+1)%360,y0,dx*(1-dy)],[x0,Math.min(180,y0+1),(1-dx)*dy],[(x0+1)%360,Math.min(180,y0+1),dx*dy]]) {
    if(w===0)continue;
    const v=field.values_c[yy*360+xx];if(v===null||!Number.isFinite(v))return null;value+=w*v;
  }
  return value;
}
export function temperatureColor(value) {
  if(value===null||!Number.isFinite(value))return [0,0,0,0];
  const v=Math.max(-60,Math.min(60,value));
  const i=Math.max(1,TEMPERATURE_PALETTE.findIndex(stop=>stop[0]>=v)),a=TEMPERATURE_PALETTE[i-1],b=TEMPERATURE_PALETTE[i],t=(v-a[0])/(b[0]-a[0]);
  return [1,2,3].map(k=>Math.round(a[k]+(b[k]-a[k])*t)).concat(255);
}
export function temperaturePixels(field,width=720,height=360) {
  validateTemperatureField(field);
  const pixels=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)pixels.set(temperatureColor(sampleTemperature(field,-180+(x+.5)*360/width,90-(y+.5)*180/height)),(y*width+x)*4);
  return pixels;
}
export function weatherFreshness(field,now=Date.now(),kind='global') {
  if(!field)return 'unavailable';
  const validAge=now-Date.parse(field.valid_at),cacheAge=now-Date.parse(field.retrieved_at);
  const location=kind==='location';
  if(!Number.isFinite(validAge)||!Number.isFinite(cacheAge)||validAge>(location?10800000:86400000)||validAge< -10800000)return 'unavailable';
  return field.state==='stale'||validAge>(location?1800000:21600000)||cacheAge>(location?900000:21600000)?'stale':'available';
}
