import {getStoredAccessToken,savePushSubscription,revokePushSubscription} from './orbitwatchApi.js';

const RECEIPT='orbitwatch_push_device';
export function pushCapability(scope=globalThis) {
  if(!scope.isSecureContext)return 'Browser push requires HTTPS (localhost is supported for development).';
  if(!scope.navigator?.serviceWorker||!scope.PushManager||!scope.Notification)return 'Web Push is unavailable in this browser. On supported iPhone/iPad devices, add OrbitWatch to the Home Screen and open it there.';
  return null;
}
export function pushReceipt() {try{return JSON.parse(localStorage.getItem(RECEIPT)||'null');}catch{return null;}}
const keyBytes=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4)),character=>character.charCodeAt(0));
async function marker(registration,id) {
  const worker=registration.active;
  if(!worker)throw Error('Notification service worker is not active. Try again.');
  await new Promise((resolve,reject)=>{
    const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();channel.port2.close();reject(Error('Service worker did not confirm this device change.'));},3000);
    channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();channel.port2.close();event.data?.ok?resolve():reject(Error('Device privacy state could not be saved.'));};
    worker.postMessage({type:'ORBITWATCH_PUSH_DEVICE',id:id||null},[channel.port2]);
  });
}

export async function enableBrowserPush(publicKey,ownerId) {
  const unavailable=pushCapability();if(unavailable)throw Error(unavailable);
  if(!publicKey)throw Error('Browser push not configured');
  // Called directly from the click handler, never login, effect, or timer.
  const permission=Notification.permission==='default'?await Notification.requestPermission():Notification.permission;
  if(permission!=='granted')throw Error('Browser notification permission was not granted. Change it in your browser settings if desired.');
  const registration=await navigator.serviceWorker.register('/orbitwatch-push-sw.js',{scope:'/'});
  await navigator.serviceWorker.ready;
  let subscription=await registration.pushManager.getSubscription();
  if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(publicKey)});
  try {
    const receipt=pushReceipt();
    const device=await savePushSubscription({...subscription.toJSON(),consent:true,
      ...(receipt?.ownerId===ownerId?{replace_id:receipt.id}:{})});
    await marker(registration,device.id);
    localStorage.setItem(RECEIPT,JSON.stringify({id:device.id,ownerId}));
    return device;
  }catch(error){await marker(registration,null).catch(()=>{});await subscription.unsubscribe().catch(()=>{});throw error;}
}

export async function refreshBrowserPush(ownerId, signal) {
  const receipt=pushReceipt(), token=getStoredAccessToken();
  if(pushCapability()||Notification.permission!=='granted'||receipt?.ownerId!==ownerId||!token)return;
  const registration=await navigator.serviceWorker.getRegistration('/');
  const subscription=await registration?.pushManager.getSubscription();
  if(!subscription||signal?.aborted||getStoredAccessToken()!==token)return;
  const device=await savePushSubscription({...subscription.toJSON(),consent:true,replace_id:receipt.id},signal);
  if(signal?.aborted||getStoredAccessToken()!==token)return;
  await marker(registration,device.id);
  if(!signal?.aborted&&getStoredAccessToken()===token)localStorage.setItem(RECEIPT,JSON.stringify({id:device.id,ownerId}));
}

export async function disableBrowserPush() {
  const receipt=pushReceipt();
  const registration=await navigator.serviceWorker?.getRegistration('/');
  // Persist local revocation before any network call; safe during offline logout.
  const outcomes=await Promise.allSettled([
    registration?marker(registration,null):Promise.resolve(),
    registration?(async()=>{const subscription=await registration.pushManager.getSubscription();if(subscription)await subscription.unsubscribe();})():Promise.resolve(),
    receipt?.id?revokePushSubscription(receipt.id):Promise.resolve(),
  ]);
  if(outcomes.some(result=>result.status==='rejected'))throw Error('Some device revocation steps failed. Local privacy blocking and unsubscribe were attempted; retry when online.');
  localStorage.removeItem(RECEIPT);
}

export async function revokePushOnLogout(sessionRevoked) {
  const receipt=pushReceipt();
  // The privacy marker uses the same local database as the push worker and does
  // not depend on registration lookup, network access or a live access token.
  if(typeof indexedDB!=='undefined'){
    try{
      const request=indexedDB.open('orbitwatch-push-privacy',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('settings');
      request.onsuccess=()=>{const db=request.result;const transaction=db.transaction('settings','readwrite');transaction.objectStore('settings').put(null,'device');transaction.oncomplete=()=>db.close();transaction.onerror=()=>db.close();};
    }catch{ /* Service worker message below remains a second local path. */ }
  }
  const registration=await navigator.serviceWorker?.getRegistration('/').catch(()=>null);
  if(registration)await Promise.allSettled([
    marker(registration,null),
    registration.pushManager.getSubscription().then(subscription=>subscription?.unsubscribe()),
  ]);
  if(await sessionRevoked?.catch(()=>false)){
    const current=pushReceipt();
    if(current?.id===receipt?.id&&current?.ownerId===receipt?.ownerId)localStorage.removeItem(RECEIPT);
  }
}
