/* Push-only service worker: deliberately no fetch interception or asset caching. */
function database() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('orbitwatch-push-privacy',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('settings');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
async function deviceState(value,write=false) {
  const db=await database();
  try{return await new Promise((resolve,reject)=>{
    const transaction=db.transaction('settings',write?'readwrite':'readonly'),store=transaction.objectStore('settings');
    const request=write?store.put(value,'device'):store.get('device');
    transaction.oncomplete=()=>resolve(request.result);transaction.onerror=()=>reject(transaction.error);
  });}finally{db.close();}
}
function destination(payload) {
  if(!payload||!['satellite','celestial','event'].includes(payload.kind)||typeof payload.target_id!=='string'||! /^[A-Za-z0-9_:.-]{1,120}$/.test(payload.target_id))return '/?notifications=1';
  return '/?'+new URLSearchParams({notifications:'1',kind:payload.kind,target:payload.target_id});
}
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{
  if(event.data?.type!=='ORBITWATCH_PUSH_DEVICE')return;
  const id=typeof event.data.id==='string'&&/^[a-f0-9-]{36}$/.test(event.data.id)?event.data.id:null;
  event.waitUntil((async()=>{
    try {
      await deviceState(id,true);
      if(!id)for(const notification of await self.registration.getNotifications())notification.close();
      event.ports[0]?.postMessage({ok:true});
    }catch{event.ports[0]?.postMessage({ok:false});}
  })());
});
self.addEventListener('push',event=>event.waitUntil((async()=>{
  let payload;try{payload=event.data?.json();}catch{return;}
  const device=await deviceState().catch(()=>null);
  if(!device||device!==payload?.device_id)return;
  const expires=Date.parse(payload.expires_at);
  if(!Number.isFinite(expires)||expires<=Date.now())return;
  if(typeof payload.id!=='string'||typeof payload.title!=='string'||payload.title.length>120||typeof payload.body!=='string'||payload.body.length>400)return;
  await self.registration.showNotification(payload.title,{body:payload.body,icon:'/orbitwatch-mark.svg',badge:'/orbitwatch-mark.svg',tag:'orbitwatch:'+payload.id,
    data:{url:destination(payload),expires_at:payload.expires_at},renotify:false});
})()));
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const requested=event.notification.data?.url;
    const safe=typeof requested==='string'&&requested.startsWith('/?notifications=1')&&!requested.startsWith('//')?requested:'/?notifications=1';
    const url=new URL(safe,self.location.origin);
    if(Date.parse(event.notification.data?.expires_at)<=Date.now())url.search='?notifications=1&expired=1';
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const existing=windows.find(client=>new URL(client.url).origin===self.location.origin);
    if(existing){await existing.navigate(url.href);await existing.focus();}else await self.clients.openWindow(url.href);
  })());
});
