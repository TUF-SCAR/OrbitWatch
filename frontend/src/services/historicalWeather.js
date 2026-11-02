export const HISTORICAL_FIELDS={
  clouds:{label:'Cloud fraction',units:'%',range:[0,100],preview:'clouds'},
  temperature:{label:'2 m temperature',units:'°C',range:[-133.15,86.85],preview:'temperature'},
  precipitation:{label:'Preceding hour precipitation',units:'mm',range:[0,300],preview:'precipitation'},
  humidity:{label:'2 m relative humidity',units:'%',range:[0,100],preview:'humidity'},
  pressure:{label:'Mean sea-level pressure',units:'hPa',range:[800,1200],preview:'pressure'},
  wind:{label:'10 m wind',units:'km/h',range:[-150,150],preview:'wind'},
};
const componentSpec={...HISTORICAL_FIELDS,u:{units:'m/s',range:[-150,150]},v:{units:'m/s',range:[-150,150]},dewpoint:{units:'°C',range:[-153.15,66.85]}};
export function exactWeatherMetadata(coverage,time){
  const stamp=new Date(time).getTime();
  return coverage?.snapshots?.find(item=>Date.parse(item.timestamp)===stamp)||null;
}
export function nearestWeatherMetadata(coverage,time){
  const stamp=new Date(time).getTime();
  return [...(coverage?.snapshots||[])].filter(item=>Number.isFinite(Date.parse(item.timestamp))&&Date.parse(item.timestamp)<=Date.now())
    .sort((a,b)=>Math.abs(Date.parse(a.timestamp)-stamp)-Math.abs(Date.parse(b.timestamp)-stamp)||Date.parse(a.timestamp)-Date.parse(b.timestamp))[0]||null;
}
export function hasHistoricalVariable(metadata,key){
  return key==='wind'?Boolean(metadata?.variables?.u&&metadata?.variables?.v):Boolean(metadata?.variables?.[key]);
}
export function validateHistoricalSnapshot(snapshot,time){
  const g=snapshot?.grid;
  if(snapshot?.source!=='ERA5 reanalysis'||snapshot.metadata?.dataset!=='reanalysis-era5-single-levels'||snapshot.metadata?.product!=='reanalysis'||Date.parse(snapshot.timestamp)!==new Date(time).getTime()||Date.parse(snapshot.metadata.timestamp)!==Date.parse(snapshot.timestamp)||!g||g.width!==360||g.height!==181||g.step!==1||g.north!==90||g.west!==-180||snapshot.precipitation_period_seconds!==3600)throw Error('Mismatched historical snapshot');
  if(!snapshot.fields||!Object.keys(snapshot.fields).length||Object.keys(snapshot.fields).length>8)throw Error('Invalid historical planes');
  for(const [name,field] of Object.entries(snapshot.fields)){
    const spec=componentSpec[name];
    if(!spec||field.units!==spec.units||field.values?.length!==65160||field.values.some(v=>v!==null&&(!Number.isFinite(v)||v<spec.range[0]-.006||v>spec.range[1]+.006)))throw Error('Invalid historical values');
  }
  return snapshot;
}
export function historicalField(snapshot,variable){
  if(!snapshot||!HISTORICAL_FIELDS[variable])return null;
  const f=snapshot.fields;
  if(variable==='wind'&&(!f.u||!f.v)||variable!=='wind'&&!f[variable])return null;
  const base={id:`era5:${snapshot.timestamp}:${snapshot.metadata.sha256}:${variable}`,source_kind:'era5',
    grid:snapshot.grid,valid_at:snapshot.timestamp,display_variable:variable,units:HISTORICAL_FIELDS[variable].units};
  if(variable==='temperature')return {...base,values_c:f.temperature.values};
  if(variable==='wind')return {...base,units:'m/s',u:f.u.values,v:f.v.values};
  return {...base,values:f[variable].values};
}
export function validateHistoricalField(variable,field){
  const spec=HISTORICAL_FIELDS[variable],g=field?.grid;
  if(!spec||field.source_kind!=='era5'||!Number.isFinite(Date.parse(field.valid_at))||g?.width!==360||g.height!==181||g.west!==-180||g.north!==90||g.step!==1||field.units!==(variable==='wind'?'m/s':spec.units))throw Error('Invalid ERA5 field');
  for(const a of variable==='wind'?[field.u,field.v]:[field.values])if(a?.length!==65160||a.some(v=>v!==null&&(!Number.isFinite(v)||v<spec.range[0]-.006||v>spec.range[1]+.006)))throw Error('Invalid ERA5 nodes');
}
