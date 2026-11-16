export function feedStatus(data){
 if(!data||!Number.isFinite(data.age_seconds))return 'unavailable';
 if(data.stale)return 'stale';
 return data.missing_tracked_objects||data.missing_supported_objects?'partial':'online';
}
export function feedAgeLabel(seconds){
 if(!Number.isFinite(seconds))return 'Unavailable';
 const minutes=Math.floor(Math.max(0,seconds)/60);
 return minutes>=1440?`${Math.floor(minutes/1440)} d ${Math.floor(minutes%1440/60)} h`:minutes>=60?`${Math.floor(minutes/60)} h ${minutes%60} min`:`${minutes} min`;
}
export const FEED_LABELS={checking:'Loading',online:'Current',partial:'Partial coverage',stale:'Stale',offline:'Offline',unavailable:'Unavailable'};
export const FEED_DETAILS={partial:'Some catalog objects lack cached records. Tracked objects retain their own original data age.',stale:'Tracked orbital records are aged. Expired positions remain suppressed by the scientific validity rules.',offline:'OrbitWatch cannot be reached. Original cached timestamps are retained; expired positions are hidden.',unavailable:'No usable tracked data is available. Recovery is checked automatically.',checking:'Checking the cached orbital feed.',online:'Tracked orbital records are current. The scheduler refreshes Space-Track with bounded CelesTrak fallback.'};
