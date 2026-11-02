import test from 'node:test';
import assert from 'node:assert/strict';
import {createVisibilityPreview} from '../src/services/visibilityPreview.js';

test('location switch rejects late results, filters targets, cancellation and logout discard pending data',async()=>{
  const pending=[];const events=[];
  const owner=createVisibilityPreview((kind,id,signal)=>new Promise(resolve=>pending.push({id,signal,resolve})));
  const a=owner.load('satellite','a',['20580'],value=>events.push(value));
  const b=owner.load('satellite','b',['20580'],value=>events.push(value));
  assert.ok(pending[0].signal.aborted);
  pending[1].resolve({location:{id:'b'},items:[{target_id:'20580'},{target_id:'999'}]});await b;
  pending[0].resolve({location:{id:'a'},items:[]});await a;
  assert.equal(events.at(-1).data.location.id,'b');assert.equal(events.at(-1).data.items.length,1);
  const c=owner.load('celestial','c',['moon'],value=>events.push(value));owner.destroy();
  const count=events.length;pending[2].resolve({location:{id:'c'},items:[]});await c;
  assert.equal(events.length,count);
});
