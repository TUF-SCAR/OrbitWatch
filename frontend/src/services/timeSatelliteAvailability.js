import catalog from '../../../backend/data/time_satellites.json' with {type:'json'};

export const FIRST_SATELLITE_TIME=Date.UTC(1957,9,4);
export const TIME_LIFETIMES=Object.freeze(catalog.lifetimes);
export function historicalAvailability(id,time,coverage,historicalData,lifetime=TIME_LIFETIMES[id]) {
  const instant=time.getTime(),day=time.toISOString().slice(0,10);
  if(lifetime?.launch_date&&day<lifetime.launch_date)return {state:'not_launched',label:'Not launched yet',reason:`Verified launch date: ${lifetime.launch_date} (UTC day).`,disabled:true};
  if(lifetime?.decay_date&&day>=lifetime.decay_date)return {state:'decayed',label:'No longer in orbit',reason:`Verified decay/reentry date: ${lifetime.decay_date}.`,disabled:true};
  const matching=Date.parse(historicalData?.timestamp)===instant;
  const failed=matching&&historicalData?.errors?.find(row=>row.norad_id===id);
  if(failed)return {state:'unavailable',label:'Historical orbital data unavailable',reason:failed.message||'Archived elements could not produce a valid position.'};
  if(matching&&historicalData?.objects?.some(row=>row.norad_id===id))return {state:'available',label:'Historical orbital data available',reason:'Stored elements propagated with SGP4; epoch age at most 24 hours.'};
  const row=coverage?.objects?.find(item=>item.norad_id===id);
  if(row?.valid_windows?.some(window=>Date.parse(window.start)<=instant&&instant<=Date.parse(window.end)))return {state:'available',label:'Historical orbital data available',reason:'Stored element validity window covers this instant. Position is validated when enabled.'};
  if(!lifetime?.launch_date||day===lifetime.launch_date)return {state:'unknown',label:'Historical status unknown',reason:day===lifetime?.launch_date?'Launch is known only to calendar-day precision; no qualifying archive at this instant.':'Verified lifetime metadata is insufficient; archive bounds are not lifetime bounds.'};
  return {state:'unavailable',label:'Historical orbital data unavailable',reason:coverage?.state==='unavailable'?'Archive coverage service is unavailable. No Live elements are substituted.':'No stored epoch at/before this instant within 24 hours. Launch is documented; decay is not inferred from archive gaps.'};
}
export function prelaunchNotice(objects,time) {
  const count=objects.filter(row=>historicalAvailability(row.noradId,time).state==='not_launched').length;
  return count?`${count} of the 15 catalog satellites had not launched by this date, according to verified launch metadata. The astronomical scene remains available.`:'';
}
