import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountSettings,locationPayload} from '../src/services/accountSettings.js';
import {addAccountLocation,deleteAccountLocation,fetchNotificationPreferences,storeAccessToken,clearAccessToken} from '../src/services/orbitwatchApi.js';

const preferences={notifications_enabled:false,satellite_alerts:false,celestial_alerts:false,natural_event_alerts:false,advance_warning_minutes:30,event_radius_km:100,quiet_hours_enabled:false,quiet_start:null,quiet_end:null,quiet_timezone_mode:'default_location',quiet_timezone:null,version:0,max_event_radius_km:500,delivery_active:false};
function fixture() {
  let rows=[],prefs={...preferences},fail=false,delay=null;const calls=[];
  const transport={fetchAccountLocations:async()=>rows.map(row=>({...row})),fetchNotificationPreferences:async()=>({...prefs}),
    addAccountLocation:async body=>{calls.push(['add',body]);if(delay)await delay;if(fail)throw Error('Offline. Your edits are still here.');const row={id:'fixture-id',version:1,...body,is_default:true};rows=[row];return row;},
    updateAccountLocation:async(id,body)=>{calls.push(['update',id,body]);if(fail)throw Object.assign(Error('Changed in another session.'),{status:409});rows=rows.map(row=>row.id===id?{...row,...body,version:row.version+1}:row);return rows[0];},
    deleteAccountLocation:async(id,version)=>{calls.push(['delete',id,version]);rows=rows.filter(row=>row.id!==id);if(!rows.length&&prefs.quiet_timezone_mode==='default_location'){prefs={...prefs,quiet_hours_enabled:false,version:prefs.version+1};}},
    saveNotificationPreferences:async body=>{calls.push(['preferences',body]);if(fail)throw Error('Connection failed');prefs={...prefs,...body,version:prefs.version+1};return prefs;}};
  const owner=createAccountSettings({transport});
  return {owner,calls,setFail:value=>{fail=value;},setDelay:value=>{delay=value;},transport};
}

test('loading settings does not write, globe seed requires deliberate save and timezone, failed edits remain for retry',async()=>{
  const {owner,calls,setFail}=fixture();await owner.load();assert.equal(owner.snapshot().phase,'ready');assert.equal(owner.snapshot().preferences.notifications_enabled,false);assert.deepEqual(calls,[]);
  owner.startNew({name:'Ocean inspection',latitude:0,longitude:0});assert.deepEqual(calls,[]);assert.equal(owner.snapshot().locationDraft.timezone,'');
  await owner.saveLocation();assert.equal(calls.length,0);assert.match(owner.snapshot().error,/timezone/);
  owner.changeLocation({timezone:'UTC'});setFail(true);await owner.saveLocation();assert.equal(owner.snapshot().locationDraft.name,'Ocean inspection');assert.match(owner.snapshot().error,/Offline/);
  owner.startNew({name:'Another point'});assert.equal(owner.snapshot().locationDraft.name,'Ocean inspection','new globe intent cannot erase a failed edit');
  setFail(false);await owner.saveLocation();assert.equal(owner.snapshot().locations.length,1);assert.equal(owner.snapshot().locationDraft,null);assert.match(owner.snapshot().notice,/Saved/);
  owner.editLocation(owner.snapshot().locations[0]);owner.changeLocation({name:'Renamed'});await owner.saveLocation();assert.equal(owner.snapshot().locations[0].name,'Renamed');
  await owner.makeDefault(owner.snapshot().locations[0]);assert.equal(calls.at(-1)[2].is_default,true);
  await owner.removeLocation(owner.snapshot().locations[0]);assert.deepEqual(owner.snapshot().locations,[]);owner.destroy();
});

test('server changes merge with untouched form fields while retaining the user\'s unsaved edits',async()=>{
  const f=fixture();await f.owner.load();f.owner.startNew({name:'One point',latitude:0,longitude:0});f.owner.changeLocation({timezone:'UTC'});await f.owner.saveLocation();
  f.owner.changePreference({quiet_hours_enabled:true,quiet_start:'22:00',quiet_end:'07:00'});await f.owner.savePreferences();
  f.owner.changePreference({event_radius_km:150});await f.owner.removeLocation(f.owner.snapshot().locations[0]);
  assert.equal(f.owner.snapshot().preferenceDraft.quiet_hours_enabled,false,'server disable is reflected after the last location is deleted');
  assert.equal(f.owner.snapshot().preferenceDraft.event_radius_km,150,'unrelated unsaved edit remains');f.owner.destroy();
});

test('single-flight submissions, saved preferences, conflicts and explicit refresh keep drafts intact',async()=>{
  const f=fixture();await f.owner.load();f.owner.startNew({name:'Observation',latitude:12,longitude:34});f.owner.changeLocation({timezone:'Asia/Kolkata'});
  let release;f.setDelay(new Promise(resolve=>{release=resolve;}));const pending=f.owner.saveLocation();assert.equal(f.owner.snapshot().busy,true);await f.owner.saveLocation();assert.equal(f.calls.length,1);release();await pending;
  f.owner.changePreference({notifications_enabled:true,celestial_alerts:true,quiet_hours_enabled:true,quiet_start:'22:00',quiet_end:'07:00'});f.setFail(true);await f.owner.savePreferences();assert.equal(f.owner.snapshot().preferenceDraft.celestial_alerts,true);
  f.setFail(false);await f.owner.savePreferences();assert.equal(f.owner.snapshot().preferences.version,1);assert.equal(f.calls.at(-1)[1].expected_version,0);
  f.owner.changePreference({quiet_hours_enabled:false,quiet_start:'',quiet_end:'',quiet_timezone_mode:'explicit',quiet_timezone:''});await f.owner.savePreferences();assert.equal(f.calls.at(-1)[1].quiet_timezone,null);assert.equal(f.calls.at(-1)[1].quiet_start,null);
  f.owner.editLocation(f.owner.snapshot().locations[0]);f.owner.changeLocation({name:'Retain my edit'});f.setFail(true);await f.owner.saveLocation();assert.equal(f.owner.snapshot().conflict,true);
  await f.owner.load(true);assert.equal(f.owner.snapshot().locationDraft.name,'Retain my edit');assert.match(f.owner.snapshot().notice,/unsaved edits/);f.owner.destroy();
});

test('logout destroys private state and aborts pending work; another account never sees late results',async()=>{
  let finish,signal;const f=fixture();f.transport.fetchAccountLocations=s=>{signal=s;return new Promise(resolve=>{finish=resolve;});};
  const pending=f.owner.load();f.owner.destroy();assert.equal(signal.aborted,true);
  const next=fixture();await next.owner.load();finish([{id:'other-private-location'}]);await pending;
  assert.deepEqual(next.owner.snapshot().locations,[]);assert.deepEqual(f.owner.snapshot().locations,[]);next.owner.destroy();
});

test('missing schema stays non-destructive, and API mutations use the existing authenticated transport',async t=>{
  const previousWindow=globalThis.window;globalThis.window={localStorage:{getItem:()=>null,setItem(){},removeItem(){}},dispatchEvent(){throw Error('unavailable is not logout');}};
  t.after(()=>{clearAccessToken();globalThis.window=previousWindow;});storeAccessToken('disposable-session');const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({code:'account_feature_unavailable',detail:'PRIVATE_SQL'}),{status:503});});
  await assert.rejects(fetchNotificationPreferences(),error=>error.code==='account_feature_unavailable'&&!error.message.includes('PRIVATE_SQL')&&error.message.includes('Live Mode'));
  const owner=createAccountSettings();await owner.load();assert.equal(owner.snapshot().phase,'unavailable');owner.destroy();
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response(options.method==='DELETE'?null:JSON.stringify({id:'test'}),{status:options.method==='DELETE'?204:201});};
  await addAccountLocation({name:'Chosen',latitude:0,longitude:0,timezone:'UTC',is_default:false});await deleteAccountLocation('test',1);
  assert.equal(calls.at(-2).options.headers.get('Authorization'),'Bearer disposable-session');assert.equal(calls.at(-2).options.method,'POST');assert.equal(calls.at(-1).options.method,'DELETE');
  assert.throws(()=>locationPayload({name:'x',latitude:'Infinity',longitude:'0',timezone:'UTC'}),/finite latitude/);
});
