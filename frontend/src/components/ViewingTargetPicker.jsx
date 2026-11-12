import {useEffect,useMemo,useState} from 'react';
import {createViewingTargets} from '../services/viewingTargets.js';
export default function ViewingTargetPicker({account,kind,onResults}){
  const {state,owner}=account,[result,setResult]=useState({phase:'idle',items:[],error:''}),[retry,setRetry]=useState(0);
  const locations=(state.locations||[]).map(row=>`${row.id}:${row.version}`).sort().join(',');
  const controller=useMemo(()=>createViewingTargets(),[]);
  useEffect(()=>{if(locations)controller.load(kind,result=>{setResult(result);onResults?.(result.items);});return()=>controller.cancel();},[controller,kind,locations,retry,onResults]);
  if(!locations)return <p className="account-muted">Save an observation location to find targets with potential viewing opportunities. Existing follows remain manageable below.</p>;
  const groups=[['potential','Potential opportunities found'],['no_window','No qualifying opportunity in the searched period'],['insufficient_data','Insufficient current data']];
  return <section className="viewing-target-picker" aria-label="Location-aware target recommendations"><h3>Viewing potential at your saved locations</h3>
    <p className="account-muted">{kind==='satellite'?'48-hour':'7-day'} planning horizon. A short search cannot prove that an object will never be visible. Forecasts are checked separately.</p>
    {result.phase==='loading'&&<p role="status">Checking bounded target batches…</p>}{result.error&&<p role="alert">{result.error} <button type="button" onClick={()=>setRetry(value=>value+1)}>Retry planning</button></p>}
    {groups.map(([id,label])=>{const items=result.items.filter(item=>item.state===id);if(!items.length)return null;return <details key={id} open={id==='potential'}><summary>{label} · {items.length}</summary><ul>{items.map(item=>{
      const active=state.subscriptions.some(row=>row.kind===kind&&row.target_id===item.target_id);
      return <li key={item.target_id}><strong>{item.target_name}</strong><small>{item.explanation} {item.locations.map(location=>location.name).join(', ')}</small><small>{item.source}</small>{item.assessment?.equipment&&<small>{item.assessment.equipment}</small>}
        {(id==='potential'||active)&&<button type="button" disabled={Boolean(state.alertBusy)||state.subscriptionPhase!=='ready'} onClick={()=>owner.toggleTarget(kind,item.target_id)}>{active?'Unfollow':'Follow'} {item.target_name}</button>}</li>;
    })}</ul></details>;})}
  </section>;
}
