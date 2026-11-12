import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {createViewingTargets} from '../src/services/viewingTargets.js';
import {createAccountSettings} from '../src/services/accountSettings.js';

test('target planning covers the actual large catalogue in bounded batches and isolates cancelled location requests',async()=>{
  let calls=0;const states=[];
  const owner=createViewingTargets(async(_kind,offset)=>{calls++;return {items:Array.from({length:Math.min(4,143-offset)},(_,i)=>({target_id:String(offset+i),state:'potential'})),next_offset:offset+4<143?offset+4:null};});
  await owner.load('satellite',state=>states.push(state));assert.equal(calls,36);assert.equal(states.at(-1).items.length,143);assert.equal(states.at(-1).phase,'ready');owner.cancel();
  let resolve,signal;const late=createViewingTargets((_kind,_offset,s)=>{signal=s;return new Promise(done=>resolve=done);});let published=0;
  const pending=late.load('celestial',()=>published++);late.cancel();resolve({items:[{target_id:'private'}],next_offset:null});await pending;assert.equal(signal.aborted,true);assert.equal(published,1);
});

test('private notice detail is fetched independently of inbox pagination and cannot survive logout',async()=>{
  let resolve;const owner=createAccountSettings({transport:{fetchInboxDetail:()=>new Promise(done=>resolve=done)}});
  const pending=owner.openNotice('11111111-1111-4111-8111-111111111111');owner.destroy();resolve({viewing_details:{location_name:'private'}});await pending;assert.equal(owner.snapshot().activeNotice,null);
});

test('viewing guide renders real scores, true-north compass, uncertainty and expired state accessibly without exposing HTML',async()=>{
  const server=await createServer({configFile:false,plugins:[react()],optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom'});
  try{
    const {default:Details,ViewingScore}=await server.ssrLoadModule('/src/components/ViewingDetails.jsx');
    const assessment={score:78,state:'complete',direction:'NW',equipment:'Telescope generally required',meaning:'Not a probability',components:[{label:'Geometry',points:20,maximum:25,detail:'Verified altitude'}]};
    const details={target_name:'Moon',location_name:'<script>private</script>',observer:{latitude:40,longitude:-74,timezone:'America/New_York'},start_utc:'2024-03-10T06:00:00Z',end_utc:'2024-03-10T07:30:00Z',peak_utc:'2024-03-10T07:00:00Z',assessment,window:{azimuth_degrees:315,max_elevation_degrees:45},weather:{state:'unavailable'}};
    const html=renderToStaticMarkup(createElement(Details,{details}));
    for(const expected of ['78/100','has passed','America/New_York','315 degrees clockwise from true north','Scientific details','Forecast unavailable','&lt;script&gt;'])assert.ok(html.includes(expected),expected);
    assert.doesNotMatch(html,/<script>|78%/);
    const partial=renderToStaticMarkup(createElement(ViewingScore,{assessment:{...assessment,score:null,state:'partial'}}));assert.match(partial,/Score unavailable/);assert.doesNotMatch(partial,/null\/100/);
  }finally{await server.close();}
});
