import * as api from './orbitwatchApi.js';

export function satelliteMatches(catalog,query) {
  const term=query.trim().toLowerCase();
  return catalog.filter(row=>!term||[row.name,String(row.noradId),...(row.aliases||[])].some(value=>value.toLowerCase().includes(term)));
}

export function preferenceDraft(preferences) {
  const keys=['notifications_enabled','satellite_alerts','celestial_alerts','natural_event_alerts','advance_warning_minutes','event_radius_km','quiet_hours_enabled','quiet_start','quiet_end','quiet_timezone_mode','quiet_timezone'];
  return Object.fromEntries(keys.map(key=>[key,preferences[key]]));
}
export function locationPayload(draft) {
  const latitude=Number(draft.latitude),longitude=Number(draft.longitude),name=draft.name.trim(),timezone=draft.timezone.trim();
  if(!name||name.length>80)throw Error('Enter a location name of 1–80 characters.');
  if(String(draft.latitude).trim()===''||!Number.isFinite(latitude)||Math.abs(latitude)>90)throw Error('Enter a finite latitude between −90 and 90.');
  if(String(draft.longitude).trim()===''||!Number.isFinite(longitude)||Math.abs(longitude)>180)throw Error('Enter a finite longitude between −180 and 180.');
  if(!timezone||timezone.length>64)throw Error('Choose an IANA timezone for this location.');
  return {name,latitude,longitude,timezone,is_default:draft.is_default};
}

// Per authenticated App instance; no coordinate/preference browser persistence.
// Synchronous mutation guard also rejects double submits before React rerenders.
export function createAccountSettings({transport=api}={}) {
  const empty=()=>({phase:'idle',locations:[],preferences:null,preferenceDraft:null,locationDraft:null,busy:false,error:'',notice:'',conflict:false,
    subscriptions:[],subscriptionPhase:'idle',subscriptionError:'',alertBusy:null,inbox:[],inboxPhase:'idle',inboxError:'',inboxCursor:null,inboxBusy:null,unreadCount:null,navigationNotice:'',delivery:null,deliveryError:''});
  let state=empty(),dead=false,loading=false,inboxEpoch=0;
  const pending=new Set(),request=()=>{const controller=new AbortController();pending.add(controller);return controller;};
  const listeners=new Set();
  function publish(patch){if(!dead){state={...state,...patch};listeners.forEach(fn=>fn());}}
  function failure(error){return {error:error.message||'Unable to save account settings. Your edits are still here.',conflict:error.status===409,phase:error.code==='account_feature_unavailable'?'unavailable':state.preferences?'ready':'error'};}
  async function read(signal){return Promise.all([transport.fetchAccountLocations(signal),transport.fetchNotificationPreferences(signal)]);}
  function loaded(rows,preferences,keepEdits=true) {
    const draft=state.locationDraft;
    const current=draft?.id?rows.find(row=>row.id===draft.id):null;
    const nextPreferences=preferenceDraft(preferences),previous=state.preferences&&preferenceDraft(state.preferences);
    if(keepEdits&&previous&&state.preferenceDraft)for(const key of Object.keys(nextPreferences)) {
      if(!Object.is(state.preferenceDraft[key],previous[key]))nextPreferences[key]=state.preferenceDraft[key];
    }
    let nextLocation=draft;
    if(current){
      nextLocation={...draft,version:current.version,_saved:{...current}};
      for(const key of ['name','latitude','longitude','timezone','is_default'])if(Object.is(draft[key],draft._saved?.[key]))nextLocation[key]=current[key];
    }
    publish({phase:'ready',locations:rows,preferences,preferenceDraft:nextPreferences,locationDraft:nextLocation,error:'',conflict:false});
  }
  async function load(refresh=false) {
    if(dead||loading||state.busy||(!refresh&&state.phase!=='idle'))return;
    loading=true;const controller=request();publish({phase:'loading',error:''});
    try {const [rows,preferences]=await read(controller.signal);if(!dead){loaded(rows,preferences);if(refresh)publish({notice:'Saved versions refreshed. Your unsaved edits are still here.'});}}
    catch(error){if(!dead)publish(failure(error));}
    finally {loading=false;pending.delete(controller);}
  }
  async function mutate(work,after) {
    if(dead||state.busy||loading||state.phase!=='ready')return;
    const controller=request();publish({busy:true,error:'',notice:'',conflict:false});
    let saved=false;
    try {
      const result=await work(controller.signal);if(dead)return;saved=true;after?.(result);
      const [rows,preferences]=await read(controller.signal);if(dead)return;
      loaded(rows,preferences);publish({notice:'Saved to your account.'});
    }catch(error){if(!dead)publish({...failure(error),...(saved?{phase:'error',notice:'Saved, but the latest account data could not be reloaded. Retry loading before another change.'}:{})});}
    finally {pending.delete(controller);publish({busy:false});}
  }
  const count=value=>Number.isInteger(value)&&value>=0&&value<=200?value:null;
  async function loadDelivery() {
    if(dead||!transport.fetchDeliveryStatus)return;
    const controller=request();
    try {const delivery=await transport.fetchDeliveryStatus(controller.signal);publish({delivery,deliveryError:''});}
    catch(error){if(!controller.signal.aborted)publish({deliveryError:error.message});}
    finally {pending.delete(controller);}
  }
  async function loadUnread() {
    if(dead||!transport.fetchInboxCount)return;
    const controller=request(),epoch=inboxEpoch;
    try {const result=await transport.fetchInboxCount(controller.signal);if(epoch===inboxEpoch)publish({unreadCount:count(result.unread_count)});}catch{ /* Opening the inbox exposes actionable errors. No invented badge. */ }
    finally {pending.delete(controller);}
  }
  async function loadSubscriptions(refresh=false) {
    if(dead||state.subscriptionPhase==='loading'||!refresh&&state.subscriptionPhase!=='idle')return;
    const controller=request();publish({subscriptionPhase:'loading',subscriptionError:''});
    try {const rows=await transport.fetchAlertSubscriptions(controller.signal);publish({subscriptions:rows,subscriptionPhase:'ready'});}
    catch(error){publish({subscriptionPhase:'error',subscriptionError:error.message});}
    finally {pending.delete(controller);}
  }
  async function toggleTarget(kind,target_id) {
    if(dead||state.alertBusy||state.subscriptionPhase!=='ready')return;
    const controller=request(),key=`${kind}:${target_id}`,existing=state.subscriptions.find(row=>row.kind===kind&&row.target_id===target_id);
    publish({alertBusy:key,subscriptionError:''});
    try {
      if(existing){await transport.unfollowAlertTarget(existing.id,controller.signal);publish({subscriptions:state.subscriptions.filter(row=>row.id!==existing.id)});}
      else {const row=await transport.followAlertTarget({kind,target_id},controller.signal);publish({subscriptions:[...state.subscriptions.filter(item=>item.id!==row.id),row]});}
    }catch(error){publish({subscriptionError:error.message});}
    finally{pending.delete(controller);publish({alertBusy:null});}
  }
  async function loadInbox(refresh=false,more=false) {
    if(dead||state.inboxBusy||state.inboxPhase==='loading'||more&&!state.inboxCursor||!refresh&&!more&&state.inboxPhase!=='idle')return;
    inboxEpoch++;
    const controller=request();publish({inboxPhase:'loading',inboxError:'',navigationNotice:''});
    try {
      const page=await transport.fetchInbox({cursor:more?state.inboxCursor:null,signal:controller.signal});
      publish({inbox:more?[...state.inbox,...page.items.filter(item=>!state.inbox.some(row=>row.id===item.id))]:page.items,inboxCursor:page.next_cursor,unreadCount:count(page.unread_count),inboxPhase:'ready'});
    }catch(error){publish({inboxPhase:'error',inboxError:error.message});}
    finally{pending.delete(controller);}
  }
  async function inboxAction(id,action) {
    if(dead||state.inboxBusy||state.inboxPhase==='loading')return;
    inboxEpoch++;
    const controller=request();publish({inboxBusy:id,inboxError:''});
    try {
      const result=await (action==='all'?transport.markAllInboxRead(controller.signal):action==='dismiss'?transport.dismissInboxItem(id,controller.signal):transport.markInboxRead(id,controller.signal));
      publish({unreadCount:count(result.unread_count),inbox:action==='dismiss'?state.inbox.filter(row=>row.id!==id):state.inbox.map(row=>action==='all'||row.id===id?{...row,read_at:result.read_at}:row)});
    }catch(error){publish({inboxError:error.message});}
    finally{pending.delete(controller);publish({inboxBusy:null});}
  }
  return {
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},snapshot:()=>state,load,
    loadUnread,loadSubscriptions,toggleTarget,loadInbox,loadDelivery,
    markRead:id=>inboxAction(id,'read'),markAllRead:()=>inboxAction('all','all'),dismiss:id=>inboxAction(id,'dismiss'),
    navigationNotice:message=>publish({navigationNotice:message}),
    startNew(seed={}){if(state.busy)return;if(state.locationDraft){publish({notice:'Finish or cancel your current location edit before adding another point.'});return;}publish({locationDraft:{name:seed.name||'',latitude:seed.latitude===undefined?'':String(seed.latitude),longitude:seed.longitude===undefined?'':String(seed.longitude),timezone:'',is_default:false},error:'',notice:''});},
    editLocation(row){if(state.busy)return;if(state.locationDraft){publish({notice:'Finish or cancel your current location edit before editing another location.'});return;}publish({locationDraft:{...row,_saved:{...row}},error:'',notice:''});},
    changeLocation(patch){if(!state.busy&&state.locationDraft)publish({locationDraft:{...state.locationDraft,...patch},error:'',notice:''});},
    cancelLocation(){if(!state.busy)publish({locationDraft:null,error:''});},
    saveLocation(){
      const draft=state.locationDraft;if(!draft)return;
      let body;try{body=locationPayload(draft);}catch(error){publish({error:error.message});return;}
      return mutate(signal=>draft.id?transport.updateAccountLocation(draft.id,{...body,expected_version:draft.version},signal):transport.addAccountLocation(body,signal),()=>publish({locationDraft:null}));
    },
    makeDefault(row){return mutate(signal=>transport.updateAccountLocation(row.id,{...locationPayload(row),is_default:true,expected_version:row.version},signal));},
    removeLocation(row){return mutate(signal=>transport.deleteAccountLocation(row.id,row.version,signal),()=>{if(state.locationDraft?.id===row.id)publish({locationDraft:null});});},
    changePreference(patch){if(!state.busy&&state.preferenceDraft)publish({preferenceDraft:{...state.preferenceDraft,...patch},error:'',notice:''});},
    savePreferences(){if(!state.preferenceDraft)return;return mutate(signal=>transport.saveNotificationPreferences({...state.preferenceDraft,quiet_start:state.preferenceDraft.quiet_start||null,quiet_end:state.preferenceDraft.quiet_end||null,quiet_timezone:state.preferenceDraft.quiet_timezone||null,expected_version:state.preferences.version},signal),result=>publish({preferences:result,preferenceDraft:preferenceDraft(result)}));},
    destroy(){dead=true;pending.forEach(controller=>controller.abort());pending.clear();listeners.clear();state=empty();},
  };
}
