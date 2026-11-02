import {useEffect,useState} from 'react';
import {BellRing,ShieldCheck} from 'lucide-react';
import {enableBrowserPush,disableBrowserPush,pushCapability,pushReceipt} from '../services/browserPush.js';

export default function NotificationDelivery({account}) {
  const {state,owner}=account,status=state.delivery;
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[deviceId,setDeviceId]=useState(()=>pushReceipt()?.id||null),[permission,setPermission]=useState(()=>globalThis.Notification?.permission||'unsupported');
  useEffect(()=>{
    let alive=true;
    async function sync(){
      const registration=await navigator.serviceWorker?.getRegistration('/').catch(()=>null);
      const subscription=await registration?.pushManager.getSubscription().catch(()=>null);
      if(alive){setDeviceId(subscription?pushReceipt()?.id||null:null);setPermission(globalThis.Notification?.permission||'unsupported');}
    }
    sync();window.addEventListener('focus',sync);
    return()=>{alive=false;window.removeEventListener('focus',sync);};
  },[]);
  const registered=Boolean(deviceId&&status?.devices.some(device=>device.id===deviceId));
  const capability=typeof window==='undefined'?'Browser capability will be checked on your device.':pushCapability();
  async function toggle() {
    setBusy(true);setError('');
    try {
      if(registered){await disableBrowserPush();setDeviceId(null);}
      else {const result=await enableBrowserPush(status?.vapid_public_key,account.userId);setDeviceId(result.id);}
      setPermission(globalThis.Notification?.permission||'unsupported');await owner.loadDelivery();
    }catch(reason){setError(reason.message);}finally{setBusy(false);}
  }
  return <section className="notification-delivery" aria-label="Notification delivery status">
    <div className="account-section-title"><h3><BellRing size={16}/> Delivery & this browser</h3><ShieldCheck size={16}/></div>
    <p className="account-muted">{status?.scheduler_state==='recent_success'?(status.scheduler_mode==='loop'?'A worker check succeeded recently.':'A one-shot check succeeded; recurring operation is not verified.'):status?.scheduler_state==='stale'?'Worker heartbeat is stale; background delivery may be offline.':'Recurring notification worker is not operational or has not checked in.'}</p>
    {status?.last_success_at&&<small>Last successful check: {new Date(status.last_success_at).toLocaleString()}</small>}
    <p className="account-muted">{!status?.push_configured?'Browser push not configured.':registered&&permission==='granted'?'This browser is subscribed. Provider acceptance does not prove display.':registered?'Saved device association; browser permission is revoked or unavailable.':'This browser has not opted in.'}</p>
    {capability&&<p className="account-muted">{capability}</p>}
    <p className="account-muted">Opt in to receive eligible updates when OrbitWatch is closed. Your master/category settings and quiet hours still apply. Push messages keep location details in your private inbox.</p>
    <small>Closed-tab delivery depends on browser/OS background support. A fully quit browser may defer notifications.</small>
    <button type="button" disabled={busy||(!registered&&(!status?.push_configured||Boolean(capability)))} onClick={toggle}>{busy?'Updating this browser…':registered?'Disable browser notifications':'Enable browser notifications'}</button>
    {status&&<small>Browser permission: {permission} · {status.devices.length}/{status.device_limit} saved devices</small>}
    {error&&<p className="account-inline-error" role="alert">{error}</p>}
    {state.deliveryError&&<p className="account-inline-error" role="alert">{state.deliveryError}<button type="button" onClick={()=>owner.loadDelivery()}>Retry delivery status</button></p>}
    <p className="account-muted">OrbitWatch is not a replacement for official emergency alert systems.</p>
  </section>;
}
