import { NATURAL_EARTH_LABELS } from "../data/naturalEarthLabels.js";
import { PLACE_LABELS } from "../data/placeLabels.js";
import { ADMIN1_LABELS } from '../data/admin1Labels.js';

const NATIVE_LABEL_MAPS=new Set(['bing-labels','bing-road','osm','carto-dark','carto-voyager']);
export const customPlaceLabelsForMap=map=>Boolean(map)&&!NATIVE_LABEL_MAPS.has(map);

const nearCity = ([, lon, lat]) => NATURAL_EARTH_LABELS.some(([, x, y, kind]) => kind === "city" && Math.abs(x - lon) < 0.5 && Math.abs(y - lat) < 0.5);
export const OVERVIEW_LABELS = [
  ...NATURAL_EARTH_LABELS,
  ...PLACE_LABELS.filter((place) => !nearCity(place)).map((place) => [...place, 4]),
].sort((a, b) => (a[3] === b[3] ? a[4] - b[4] : a[3] === "country" ? -1 : 1));

export const PLACE_LABEL_RECORDS=[
  ...OVERVIEW_LABELS.map(([name,longitude,latitude,kind,rank])=>({id:`${kind}:${longitude}:${latitude}`,name,longitude,latitude,kind,rank})),
  ...ADMIN1_LABELS.map(([id,name,longitude,latitude,rank,country,countryCode])=>({id,name,longitude,latitude,rank,country,countryCode,kind:'state'})),
].sort((a,b)=>({country:0,city:1,state:2}[a.kind]-{country:0,city:1,state:2}[b.kind])||a.rank-b.rank||a.id.localeCompare(b.id));

export function labelAltitudeRange(kind, rank) {
  if(kind==='state')return [15000,3_500_000/Math.pow(1.22,Math.max(0,rank-2))];
  return kind === "country"
    ? [400_000, 20_000_000 / Math.pow(1.55, Math.max(0, rank - 1))]
    : [10_000, 7_000_000 / Math.pow(1.5, Math.max(0, rank - 1))];
}

// Only actually rendered city/state labels participate; countries never
// become weather coordinates.
export function labelTextBounds(item) {
  if(item.bounds)return item.bounds;
  const width=item.width||0,height=item.height||0;
  return {left:item.x-width/2,right:item.x+width/2,top:item.y-height/2,bottom:item.y+height/2};
}

export function nearestSelectablePlace(candidates, point, radius=24) {
  const hits=[];
  for(const item of candidates) {
    if(!['city','state'].includes(item.kind)||item.label?.show===false||item.visible===false||item.occluded)continue;
    const box=labelTextBounds(item);
    const distance=Math.hypot(Math.max(box.left-point.x,0,point.x-box.right),Math.max(box.top-point.y,0,point.y-box.bottom));
    if(Number.isFinite(distance)&&distance<=radius)hits.push({item,distance,center:Math.hypot(item.x-point.x,item.y-point.y)});
  }
  hits.sort((a,b)=>a.distance-b.distance||a.center-b.center||String(a.item.id||a.item.name).localeCompare(String(b.item.id||b.item.name)));
  const nearest=hits[0]?.item;
  return nearest ? {id:nearest.id,name:nearest.name,kind:nearest.kind,latitude:nearest.latitude,longitude:nearest.longitude,country:nearest.country,countryCode:nearest.countryCode} : null;
}

// Priority-ordered screen rectangles. A hard cap bounds dense urban views.
export function selectLabelBoxes(candidates, width, height, limit = 45, retained=new Set()) {
  const accepted = [];
  for (const item of candidates) {
    if (![item.x, item.y, item.width].every(Number.isFinite)) continue;
    const bounds=labelTextBounds({...item,height:item.height||12});
    const padding=item.kind!=='country'&&retained.has(item.id)?4:6;
    const left = bounds.left-padding, right = bounds.right+padding;
    const top = bounds.top-padding, bottom = bounds.bottom+padding;
    if (left < 0 || right > width || top < 0 || bottom > height) continue;
    if (accepted.some((b) => left < b.right && right > b.left && top < b.bottom && bottom > b.top)) continue;
    accepted.push({ ...item, left, right, top, bottom });
    if (accepted.length >= limit) break;
  }
  return accepted;
}
