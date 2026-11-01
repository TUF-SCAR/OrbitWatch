export function weatherTime(value) {
  const time=new Date(value);return Number.isFinite(time.getTime())?`${time.toLocaleString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false})} UTC`:'Unavailable';
}
export function weatherCondition(code) {
  if(code===null||code===undefined)return 'Unavailable';
  if(code===0)return 'Clear';if(code===1)return 'Mainly clear';if(code===2)return 'Partly cloudy';if(code===3)return 'Overcast';
  if([45,48].includes(code))return 'Fog';if([51,53,55].includes(code))return 'Drizzle';if([56,57].includes(code))return 'Freezing drizzle';
  if([61,63,65].includes(code))return 'Rain';if([66,67].includes(code))return 'Freezing rain';if([71,73,75,77].includes(code))return 'Snow';
  if([80,81,82].includes(code))return 'Rain showers';if([85,86].includes(code))return 'Snow showers';if([95,96,99].includes(code))return 'Thunderstorm';return `Weather code ${code}`;
}
export function weatherMeasurement(data,key) {
  let value=data?.values?.[key],unit=data?.units?.[key];
  if(!Number.isFinite(value))return 'Unavailable';
  if(key==='wind_speed_10m'&&unit==='m/s'){value=Math.round(value*36)/10;unit='km/h';}
  return `${value}${unit?` ${unit}`:''}`;
}
