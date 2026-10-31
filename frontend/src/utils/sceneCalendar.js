export const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export const MIN_SCENE_TIME = Date.UTC(1957,0,1);
export const MAX_SCENE_TIME = Date.UTC(2101,0,1)-1;
export const validSceneTime = date => Number.isFinite(date?.getTime()) && date.getTime() >= MIN_SCENE_TIME && date.getTime() <= MAX_SCENE_TIME;
export function dateFields(date, zone) {
  const get = name => date[`get${zone==='utc'?'UTC':''}${name}`]();
  return {year:String(get('FullYear')),month:String(get('Month')),day:String(get('Date')),hour:String(get('Hours')).padStart(2,'0'),minute:String(get('Minutes')).padStart(2,'0')};
}
export const daysInMonth = (year,month) => new Date(Date.UTC(year,month+1,0)).getUTCDate();
export function fieldsDate(fields, zone) {
  if(Object.values(fields).some(v=>!/^\d+$/.test(v))) return null;
  const {year,month,day,hour,minute}=Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,Number(v)]));
  if(year<1957 || year>2100 || month<0 || month>11 || day<1 || day>daysInMonth(year,month) || hour>23 || minute>59) return null;
  const date = zone==='utc' ? new Date(Date.UTC(year,month,day,hour,minute)) : new Date(year,month,day,hour,minute);
  // Reject nonexistent local times at a DST transition instead of shifting them.
  const actual=dateFields(date,zone);
  if(!validSceneTime(date) || Object.entries(fields).some(([k,v])=>Number(v)!==Number(actual[k]))) return null;
  return date;
}
export function shiftMonth(fields, amount) {
  const next = new Date(Date.UTC(Number(fields.year),Number(fields.month)+amount,1));
  if(next.getUTCFullYear()<1957 || next.getUTCFullYear()>2100) return fields;
  return {...fields,year:String(next.getUTCFullYear()),month:String(next.getUTCMonth()),day:String(Math.min(Number(fields.day),daysInMonth(next.getUTCFullYear(),next.getUTCMonth())))};
}
