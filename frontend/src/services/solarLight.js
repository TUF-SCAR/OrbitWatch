// Low-cost solar position (Julian-day mean longitude/anomaly and sidereal time).
// UTC source-valid time only; civil twilight ends at solar elevation -6 degrees.
// Deliberately geometric: no terrain, refraction or invented provider readings.
export function solarLight(time,longitude,latitude,provider=null){
  if(provider===true||provider===1)return 'day';
  if(provider===false||provider===0)return 'night';
  if(!time||!Number.isFinite(longitude)||!Number.isFinite(latitude)||Math.abs(longitude)>180||Math.abs(latitude)>90)return 'unknown';
  const stamp=Date.parse(time);if(!Number.isFinite(stamp))return 'unknown';
  const radians=Math.PI/180,d=stamp/86400000+2440587.5-2451545;
  const mean=(280.460+.9856474*d)%360,anomaly=(357.528+.9856003*d)*radians;
  const ecliptic=(mean+1.915*Math.sin(anomaly)+.020*Math.sin(2*anomaly))*radians,obliquity=(23.439-.0000004*d)*radians;
  const rightAscension=Math.atan2(Math.cos(obliquity)*Math.sin(ecliptic),Math.cos(ecliptic));
  const declination=Math.asin(Math.sin(obliquity)*Math.sin(ecliptic));
  const hourAngle=(280.46061837+360.98564736629*d+longitude)*radians-rightAscension;
  const elevation=Math.asin(Math.sin(latitude*radians)*Math.sin(declination)+Math.cos(latitude*radians)*Math.cos(declination)*Math.cos(hourAngle))/radians;
  return elevation>0?'day':elevation>=-6?'twilight':'night';
}
