import assert from 'node:assert/strict';
import test from 'node:test';
import {storeAccessToken,getStoredAccessToken,clearAccessToken,fetchCurrentUser,loginAccount,registerAccount} from '../src/services/orbitwatchApi.js';

test('temporary infrastructure failures preserve credentials; invalid sessions clear only their own token',async t=>{
  const previousWindow=globalThis.window,previousFetch=globalThis.fetch;
  const storage=new Map(),events=[];
  globalThis.window={localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},dispatchEvent:e=>events.push(e.type)};
  t.after(()=>{clearAccessToken();globalThis.window=previousWindow;globalThis.fetch=previousFetch;});
  const reply=(status,body)=>Promise.resolve(new Response(JSON.stringify(body),{status}));
  for(const [status,code,kind] of [[503,'database_unavailable','unavailable'],[502,null,'server'],[500,null,'server']]){
    storeAccessToken('valid-fixture');globalThis.fetch=()=>reply(status,{detail:'SECRET_CONNECTION_STRING',code});
    await assert.rejects(fetchCurrentUser(),e=>e.kind===kind&&!e.message.includes('SECRET_')&&e.detail===null);
    assert.equal(getStoredAccessToken(),'valid-fixture');assert.deepEqual(events,[]);
  }
  globalThis.fetch=()=>Promise.reject(new TypeError('Failed to fetch'));
  await assert.rejects(fetchCurrentUser(),e=>e.kind==='offline');assert.equal(getStoredAccessToken(),'valid-fixture');
  globalThis.fetch=()=>Promise.reject(new DOMException('expired','TimeoutError'));
  await assert.rejects(fetchCurrentUser(),e=>e.kind==='timeout');assert.equal(getStoredAccessToken(),'valid-fixture');
  globalThis.fetch=()=>reply(401,{detail:'Invalid or expired token'});
  await assert.rejects(fetchCurrentUser(),e=>e.status===401);assert.equal(getStoredAccessToken(),null);assert.deepEqual(events,['orbitwatch:unauthorized']);
  // A late 401 from an old request must not invalidate a new successful login.
  storeAccessToken('old-fixture');let finish;globalThis.fetch=()=>new Promise(resolve=>{finish=resolve;});
  const oldRequest=fetchCurrentUser();storeAccessToken('new-fixture');finish(new Response(JSON.stringify({detail:'Invalid token'}),{status:401}));
  await assert.rejects(oldRequest);assert.equal(getStoredAccessToken(),'new-fixture');assert.equal(events.length,1);
});

test('login/registration outage and recovery, validation, malformed responses and cancellation stay distinct',async t=>{
  const previousWindow=globalThis.window,previousFetch=globalThis.fetch;
  globalThis.window={localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},dispatchEvent:()=>{throw Error('auth form failure must not emit logout');}};
  t.after(()=>{clearAccessToken();globalThis.window=previousWindow;globalThis.fetch=previousFetch;});
  for(const call of [()=>loginAccount({usernameOrEmail:'test',password:'test-password'}),()=>registerAccount({username:'test',email:'test@example.invalid',password:'test-password'})]){
    globalThis.fetch=async()=>new Response(JSON.stringify({detail:'SECRET_SQL',code:'database_unavailable'}),{status:503});
    await assert.rejects(call(),e=>e.kind==='unavailable'&&e.message.includes('database')&&!e.message.includes('SECRET_SQL'));
    globalThis.fetch=async()=>new Response(JSON.stringify({access_token:'test-token'}),{status:200});
    assert.equal((await call()).access_token,'test-token');
  }
  globalThis.fetch=async()=>new Response(JSON.stringify({detail:'Invalid username/email or password'}),{status:401});
  await assert.rejects(loginAccount({}),e=>e.status===401&&e.kind==='unauthorized');
  globalThis.fetch=async()=>new Response('<html>proxy failure</html>',{status:200});
  await assert.rejects(fetchCurrentUser(),e=>e.status===502&&e.kind==='server');
  globalThis.fetch=async()=>({ok:true,status:200,json:async()=>{throw new DOMException('body timeout','TimeoutError');}});
  await assert.rejects(fetchCurrentUser(),e=>e.kind==='timeout');
  const controller=new AbortController();controller.abort();
  globalThis.fetch=async()=>{throw controller.signal.reason;};
  await assert.rejects(fetchCurrentUser(controller.signal),e=>e.name==='AbortError');
});
