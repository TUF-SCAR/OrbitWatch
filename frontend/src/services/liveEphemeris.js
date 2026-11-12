import {Cartesian3,JulianDate,Matrix3,Simon1994PlanetaryPositions} from 'cesium';
import {AU_METERS,PLANET_ELEMENTS,bodyPositionFixed,bodyPositionInertial,inertialToFixedMatrix,sampleBodyOrbitFixed} from '../data/solarSystemEphemeris.js';
import {CELESTIAL_BODIES} from '../data/celestialBodies.js';
const RAD=Math.PI/180,OBLIQUITY=84381.448/3600*RAD;
const MOON_MASS_FRACTION=4902.800118/(398600.435507+4902.800118); // JPL DE440 GMs

export function julianTdb(time){
  // Cesium stores TAI. TT=TAI+32.184s; leading periodic TDB-TT terms (ms).
  const tt=JulianDate.totalDays(time)+32.184/86400,g=(357.53+.9856003*(tt-2451545))*RAD;
  return tt+(.001657*Math.sin(g)+.000022*Math.sin(2*g))/86400;
}
export function solveLiveKepler(mean,e){
  if(!Number.isFinite(mean)||!Number.isFinite(e)||e<0||e>=1)throw Error('Only finite bound elliptic elements are supported');
  const m=((mean+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;
  let low=-Math.PI,high=Math.PI,E=e<.8?m:Math.sign(m||1)*Math.PI;
  for(let step=0;step<64;step++){
    const residual=E-e*Math.sin(E)-m;if(Math.abs(residual)<1e-13)return E;
    if(residual>0)high=E;else low=E;
    const candidate=E-residual/(1-e*Math.cos(E));E=candidate>low&&candidate<high?candidate:(low+high)/2;
  }
  throw Error('Kepler solution did not converge');
}
export function elementVector(record,mean=record.ma){
  const E=solveLiveKepler(mean*RAD,record.e),x=record.a*(Math.cos(E)-record.e)*AU_METERS,y=record.a*Math.sqrt(1-record.e**2)*Math.sin(E)*AU_METERS;
  const w=record.w*RAD,o=record.om*RAD,i=record.i*RAD,cw=Math.cos(w),sw=Math.sin(w),co=Math.cos(o),so=Math.sin(o),ci=Math.cos(i),si=Math.sin(i);
  const ec=new Cartesian3((cw*co-sw*so*ci)*x+(-sw*co-cw*so*ci)*y,(cw*so+sw*co*ci)*x+(-sw*so+cw*co*ci)*y,sw*si*x+cw*si*y);
  return new Cartesian3(ec.x,Math.cos(OBLIQUITY)*ec.y-Math.sin(OBLIQUITY)*ec.z,Math.sin(OBLIQUITY)*ec.y+Math.cos(OBLIQUITY)*ec.z);
}
export function usableLiveRecord(record,time){
  const jd=julianTdb(time);
  return record&&['fresh','cached','stale'].includes(record.state)&&['NASA/JPL SBDB','NASA/JPL Horizons'].includes(record.source)&&record.time_scale==='TDB'&&record.frame==='IAU76/80 ecliptic J2000'&&record.equinox==='J2000'&&record.valid_from_tdb<=jd&&jd<=record.valid_until_tdb;
}
export function planetVector(id,time,mean=null){
  const spec=PLANET_ELEMENTS[id];if(!spec)return null;
  const T=(julianTdb(time)-2451545)/36525,[a,e,i,L,peri,om]=spec.base.map((value,index)=>value+spec.rate[index]*T);
  return elementVector({a,e,i,om,w:peri-om,ma:mean??L-peri});
}
export function createLiveEphemeris(getRecords=()=>[]){
  let baseTime=null,earth=null,moon=null;
  function earthAt(time){
    if(!baseTime||!JulianDate.equals(baseTime,time)){
      baseTime=JulianDate.clone(time,baseTime);moon=Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(time);
      earth=Cartesian3.subtract(planetVector('earth',time),Cartesian3.multiplyByScalar(moon,MOON_MASS_FRACTION,new Cartesian3()),new Cartesian3());
    }
    return earth;
  }
  const recordFor=id=>getRecords().find(record=>record.body_id===id);
  function heliocentric(id,time){
    if(id==='sun')return new Cartesian3();
    const record=recordFor(id);
    if(usableLiveRecord(record,time))return elementVector(record,record.ma+record.n*(julianTdb(time)-record.epoch_tdb));
    if(PLANET_ELEMENTS[id])return id==='earth'?earthAt(time):planetVector(id,time);
    // Explicit catalog fallback: never label these old elements as a JPL solution.
    const legacy=bodyPositionInertial(id,time),legacySun=bodyPositionInertial('sun',time);
    return legacy&&Cartesian3.subtract(legacy,legacySun,new Cartesian3());
  }
  function inertial(id,time){
    if(id==='earth')return new Cartesian3();
    if(id==='moon'){earthAt(time);return Cartesian3.clone(moon);}
    const body=CELESTIAL_BODIES[id];if(!body)return undefined;
    if(body.type==='Moon'){
      const legacy=bodyPositionInertial(id,time),parent=bodyPositionInertial(body.parent,time);
      const local=Cartesian3.subtract(legacy,parent,new Cartesian3());
      return Cartesian3.add(Cartesian3.subtract(heliocentric(body.parent,time),earthAt(time),new Cartesian3()),local,local);
    }
    return Cartesian3.subtract(heliocentric(id,time),earthAt(time),new Cartesian3());
  }
  function position(id,time,result=new Cartesian3()){
    const value=inertial(id,time);return value&&Matrix3.multiplyByVector(inertialToFixedMatrix(time),value,result);
  }
  function orbit(id,time,steps=128){
    const record=recordFor(id),planet=PLANET_ELEMENTS[id];
    if(!usableLiveRecord(record,time)&&!planet){
      // Preserve the approved illustrative paths, translating to the same parent
      // center as Live models. Lunar path remains an approximate catalog ellipse.
      const center=CELESTIAL_BODIES[id]?.type==='Moon'?CELESTIAL_BODIES[id].parent:'sun';
      const delta=Cartesian3.subtract(position(center,time),bodyPositionFixed(center,time),new Cartesian3());
      return sampleBodyOrbitFixed(id,time,steps).map(point=>Cartesian3.add(point,delta,point));
    }
    const earth=earthAt(time),matrix=inertialToFixedMatrix(time),points=[];
    for(let step=0;step<=steps;step++){
      const helio=usableLiveRecord(record,time)?elementVector(record,step/steps*360):planetVector(id,time,step/steps*360);
      points.push(Matrix3.multiplyByVector(matrix,Cartesian3.subtract(helio,earth,helio),helio));
    }
    return points;
  }
  function describe(id,time){
    const record=recordFor(id);
    if(usableLiveRecord(record,time))return {record,source:`${record.source} · solution ${record.solution_id}`,limitation:'Osculating two-body approximation; not a precision trajectory. Phase/encounters are not guaranteed outside the stated epoch window.'};
    if(id==='moon')return {source:'Simon et al. 1994 analytical lunar theory (Cesium)',limitation:'Geometric Earth-centered analytical position; not an apparent telescope direction.'};
    if(PLANET_ELEMENTS[id])return {source:'JPL approximate planetary elements · 1800–2050',limitation:'Geometric low-precision fit; outer-planet errors can reach millions of kilometres.'};
    return {source:record?'Catalog approximation · JPL epoch outside usable window':'Catalog approximation · no usable shared JPL record',limitation:CELESTIAL_BODIES[id]?.type==='Moon'?'Schematic moon elements: orbital phase and parent reference plane are not a fitted ephemeris.':'Unverified catalog epoch/phase; retained for continuity, not precision positioning.'};
  }
  return {position,inertial,orbit,describe};
}
