import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {pushCapability,enableBrowserPush,disableBrowserPush} from '../src/services/browserPush.js';
import {createAccountSettings} from '../src/services/accountSettings.js';

test('push is capability-gated and permission is requested only by explicit enable; disable revokes all associations',async()=>{
  assert.match(pushCapability({isSecureContext:false}),/HTTPS/);
  assert.match(pushCapability({isSecureContext:true,navigator:{}}),/Home Screen/);
  const calls=[],storage=new Map();let prompt=0;
  const previous={fetch:globalThis.fetch,navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator'),Notification:globalThis.Notification,PushManager:globalThis.PushManager,isSecureContext:globalThis.isSecureContext,localStorage:globalThis.localStorage};
  const registration={active:{postMessage(message,ports){calls.push(message.id?'activate':'block');ports[0].postMessage({ok:true});}},pushManager:{
    async getSubscription(){return {toJSON:()=>({endpoint:'https://fcm.googleapis.com/fcm/send/fixture',keys:{auth:'fixture',p256dh:'fixture'}}),unsubscribe:async()=>{calls.push('unsubscribe');return true;}};}}};
  try {
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{serviceWorker:{register:async()=>{calls.push('register');return registration;},ready:Promise.resolve(registration),getRegistration:async()=>registration}}});
    globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
    globalThis.isSecureContext=true;globalThis.PushManager=function(){};
    globalThis.Notification={permission:'default',requestPermission:async()=>{prompt++;return 'granted';}};
    globalThis.fetch=async(url,options)=>{calls.push(options.method);return new Response(options.method==='POST'?JSON.stringify({id:'11111111-1111-4111-8111-111111111111'}):null,{status:options.method==='POST'?201:204,headers:{'Content-Type':'application/json'}});};
    assert.equal(prompt,0);
    await enableBrowserPush('AQID',1);assert.equal(prompt,1);assert.ok(calls.includes('POST'));assert.ok(calls.includes('activate'));
    await disableBrowserPush();assert.ok(calls.includes('block'));assert.ok(calls.includes('unsubscribe'));assert.ok(calls.includes('DELETE'));assert.equal(storage.size,0);
  }finally{
    globalThis.fetch=previous.fetch;
    if(previous.navigator)Object.defineProperty(globalThis,'navigator',previous.navigator);else delete globalThis.navigator;
    for(const key of ['Notification','PushManager','isSecureContext','localStorage'])if(previous[key]===undefined)delete globalThis[key];else globalThis[key]=previous[key];
  }
});

test('service worker checks device consent/expiry and constrains click URLs without intercepting Cesium fetches',async()=>{
  const listeners={},shown=[],navigated=[];let device=null;
  const db={close(){},createObjectStore(){},transaction(){const transaction={};transaction.objectStore=()=>({
    get(){const result={result:device};queueMicrotask(()=>transaction.oncomplete());return result;},
    put(value){device=value;const result={result:value};queueMicrotask(()=>transaction.oncomplete());return result;},
  });return transaction;}};
  const context={URL,URLSearchParams,Date,Promise,console,indexedDB:{open(){const request={result:db};queueMicrotask(()=>request.onsuccess());return request;}},
    self:{location:{origin:'https://orbitwatch.test'},addEventListener:(type,fn)=>{listeners[type]=fn;},skipWaiting:async()=>{},
      clients:{claim:async()=>{},matchAll:async()=>[{url:'https://orbitwatch.test/',navigate:async url=>navigated.push(url),focus:async()=>{}}],openWindow:async url=>navigated.push(url)},
      registration:{getNotifications:async()=>[],showNotification:async(title,options)=>shown.push({title,...options})}}};
  vm.runInNewContext(await fs.readFile(new URL('../public/orbitwatch-push-sw.js',import.meta.url),'utf8'),context);
  assert.equal(listeners.fetch,undefined);
  async function dispatch(type,data){let pending;listeners[type]({...data,waitUntil:promise=>{pending=promise;}});await pending;}
  const id='11111111-1111-4111-8111-111111111111';
  const payload={id:'notification-id',notification_id:id,device_id:id,title:'Real source update',body:'Open your inbox',kind:'event',target_id:'usgs:fixture',expires_at:new Date(Date.now()+60000).toISOString()};
  await dispatch('push',{data:{json:()=>payload}});assert.equal(shown.length,0);
  await dispatch('message',{data:{type:'ORBITWATCH_PUSH_DEVICE',id},ports:[{postMessage(){}}]});
  await dispatch('push',{data:{json:()=>payload}});assert.equal(shown.length,1);assert.match(shown[0].data.url,/notifications=1/);
  assert.match(shown[0].data.url,new RegExp('notice='+id));
  await dispatch('push',{data:{json:()=>({...payload,expires_at:'2000-01-01T00:00:00Z'})}});assert.equal(shown.length,1);
  await dispatch('notificationclick',{notification:{close(){},data:{url:'https://evil.invalid',expires_at:payload.expires_at}}});assert.equal(navigated[0],'https://orbitwatch.test/?notifications=1');
  await dispatch('message',{data:{type:'ORBITWATCH_PUSH_DEVICE',id:null},ports:[{postMessage(){}}]});
  await dispatch('push',{data:{json:()=>payload}});assert.equal(shown.length,1);
});

test('delivery status is private and late responses cannot survive account teardown',async()=>{
  let resolve;const transport={fetchDeliveryStatus:()=>new Promise(done=>{resolve=done;})};
  const owner=createAccountSettings({transport}),pending=owner.loadDelivery();owner.destroy();resolve({devices:[{id:'private'}]});await pending;assert.equal(owner.snapshot().delivery,null);
});
