import {Cartesian3} from 'cesium';

export function trackPoints(track,kind='observed',now=Date.now()){
  const raw=track?.[kind];if(!Array.isArray(raw)||raw.length>(kind==='observed'?512:32))return [];
  if(kind==='forecast'&&(!Number.isFinite(Date.parse(track.issued_at))||!Number.isFinite(Date.parse(track.expires_at))||Date.parse(track.issued_at)>now||Date.parse(track.expires_at)<=now))return [];
  const result=[];let previous=-Infinity;
  for(const p of raw){
    const at=Date.parse(p.at);
    if(!Number.isFinite(at)||at<=previous||!Number.isFinite(p.longitude)||Math.abs(p.longitude)>180||!Number.isFinite(p.latitude)||Math.abs(p.latitude)>90)return [];
    if(kind==='observed'&&at>now||kind==='forecast'&&(at<=now||p.classification!=='forecast'||Date.parse(p.issued_at)!==Date.parse(track.issued_at)||at>Date.parse(track.issued_at)+126*3600000))return [];
    previous=at;result.push(p);
  }
  return result;
}
export function trackSegments(points){
  const segments=[];let segment=[];
  for(const point of points){
    const previous=segment.at(-1);
    // Cartesian/geodesic segments use the shortest route across ±180°. Split
    // genuine temporal/spatial gaps; never fabricate bridging observations.
    if(previous&&(Date.parse(point.at)-Date.parse(previous.at)>36*3600000||Cartesian3.distance(Cartesian3.fromDegrees(previous.longitude,previous.latitude),Cartesian3.fromDegrees(point.longitude,point.latitude))>2500000)){
      if(segment.length>1)segments.push(segment);segment=[];
    }
    segment.push(point);
  }
  if(segment.length>1)segments.push(segment);
  return segments;
}
export function datedPointSubset(points,max=48){
  const step=Math.max(1,Math.ceil(points.length/max));return points.filter((_,i)=>i%step===0||i===points.length-1);
}
export function windColor(point){
  // Same kt units and 1-minute convention only; never assign a hurricane
  // category to another agency's averaging convention.
  if(point.wind_units!=='kt'||point.wind_averaging_minutes!==1||!Number.isFinite(point.wind))return '#a9dedf';
  return point.wind>=113?'#ef91ce':point.wind>=96?'#e6a1ff':point.wind>=64?'#ffc486':point.wind>=34?'#77d2d8':'#a9dedf';
}
export function eventFilter(events,{category='all',provider='all',status='all',now=Date.now()}={}){
  return events.filter(e=>(category==='all'||e.category===category)&&(provider==='all'||e.provider===provider)&&
    (status==='all'||status==='stale'&&e.data_state==='stale'||status==='fresh'&&e.data_state==='available'||status==='older'&&now-Date.parse(e.last_report_at||e.reported_at)>30*86400000||status==='tracks'&&e.track||status==='recent'&&now-Date.parse(e.last_report_at||e.reported_at)<=7*86400000));
}
