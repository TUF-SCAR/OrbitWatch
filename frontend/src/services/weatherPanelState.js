// Evaluate queued clicks against React's latest state, including mobile panels.
export function toggleWeatherLayers(current,width){
  if(current.includes('weather'))return current.filter(item=>item!=='weather');
  const exclusive=['map','camera','system','inspector','body','celestial','profile','place'];
  return [...current.filter(item=>!exclusive.includes(item)&&!(width<1100&&item==='explorer')),'weather'];
}
