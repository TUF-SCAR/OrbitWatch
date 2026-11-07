// Independently sampled from the supplied legend strips, away from text/shadows.
// Fixed physical domains: the map and legend always use these same functions.
export const TEMPERATURE_PALETTE=[[-30,142,98,185],[-20,63,46,148],[-10,54,95,168],[0,73,162,197],[10,117,223,161],[20,242,246,136],[30,247,141,43],[40,227,40,43],[50,107,4,48]];
export const HUMIDITY_PALETTE=[[0,135,75,41],[25,233,191,103],[50,244,255,177],[75,125,219,203],[100,47,110,157]];
export const PRESSURE_PALETTE=[[970,42,55,143],[985,44,91,151],[1000,74,143,171],[1008,156,211,210],[1012,228,240,230],[1015,255,230,213],[1030,217,91,82],[1045,170,44,51]];
// No phase channel exists in the current liquid-equivalent product.
export const PRECIPITATION_PALETTE=[[.1,132,198,249],[1,95,161,243],[3,150,91,180],[5,238,90,122],[12,248,167,82],[25,249,245,47],[50,250,248,59]];

export function palettePosition(value,stops,logarithmic=false){
  const first=stops[0][0],last=stops.at(-1)[0];
  return Math.max(0,Math.min(1,logarithmic?Math.log(Math.max(first,value)/first)/Math.log(last/first):(value-first)/(last-first)));
}
export function paletteColor(stops,value,alpha=255,logarithmic=false){
  if(value===null||!Number.isFinite(value))return [0,0,0,0];
  const v=Math.max(stops[0][0],Math.min(stops.at(-1)[0],value));
  const index=Math.max(1,stops.findIndex(stop=>stop[0]>=v)),a=stops[index-1],b=stops[index];
  const t=logarithmic?Math.log(v/a[0])/Math.log(b[0]/a[0]):(v-a[0])/(b[0]-a[0]);
  return [1,2,3].map(channel=>Math.round(a[channel]+(b[channel]-a[channel])*t)).concat(alpha);
}
export function paletteGradient(stops,logarithmic=false){
  // Extra logarithmic samples make the CSS strip agree with raster colours,
  // including between the intensity ticks, rather than only at the endpoints.
  const first=stops[0][0],last=stops.at(-1)[0];
  const fractions=[...new Set([...Array.from({length:129},(_,i)=>i/128),...stops.map(stop=>palettePosition(stop[0],stops,logarithmic))])].sort((a,b)=>a-b);
  const samples=fractions.map(fraction=>{
    const value=logarithmic?first*(last/first)**fraction:first+(last-first)*fraction;
    const [r,g,b]=paletteColor(stops,value,255,logarithmic);
    return `rgb(${r},${g},${b}) ${fraction*100}%`;
  });
  return `linear-gradient(90deg,${samples.join(',')})`;
}

// Allocation-free pixel writer; use the same interpolation as paletteColor.
export function paletteWriter(stops,alpha=()=>255,logarithmic=false){
  return (value,pixels,offset)=>{
    const v=Math.max(stops[0][0],Math.min(stops.at(-1)[0],value));
    let i=1;while(stops[i][0]<v)i++;
    const a=stops[i-1],b=stops[i],t=logarithmic?Math.log(v/a[0])/Math.log(b[0]/a[0]):(v-a[0])/(b[0]-a[0]);
    for(let channel=1;channel<=3;channel++)pixels[offset+channel-1]=Math.round(a[channel]+(b[channel]-a[channel])*t);
    pixels[offset+3]=alpha(value);
  };
}
