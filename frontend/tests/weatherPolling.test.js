import assert from 'node:assert/strict';
import test from 'node:test';
import { createWeatherPoller, temperatureResult } from '../src/services/weatherPolling.js';

test('cold status is not mistaken for a field; backend preparation and cooldown control retry',()=>{
  assert.equal(temperatureResult({state:'downloading',retry_after_seconds:3},1000).notBefore,4000);
  assert.equal(temperatureResult({state:'cooldown',retry_after_seconds:1801},1000).delay,1801000);
  assert.throws(()=>temperatureResult({state:'available',has_field:true}));
  assert.throws(()=>temperatureResult({state:'cooldown',retry_after_seconds:NaN}));
});

test('manual reopen cannot bypass cooldown, one scheduled retry recovers, stop cancels fetch/timer',async()=>{
  let clock=1000,calls=0,timer,delay,cleared=0,signal;
  const gate={notBefore:0},results=[];
  const options={gate,now:()=>clock,setTimer:(fn,ms)=>{timer=fn;delay=ms;return 1;},clearTimer:()=>cleared++,
    fetchField:async s=>{signal=s;calls++;return {state:calls===1?'cooldown':'downloading',retry_after_seconds:calls===1?1800:3};},
    onResult:r=>results.push(r),onError:()=>assert.fail('Unexpected error')};
  let owner=createWeatherPoller(options);await owner.start();
  assert.equal(calls,1);assert.equal(delay,1800000);owner.stop();
  owner=createWeatherPoller(options);await owner.start();
  assert.equal(calls,1);assert.equal(delay,1800000);
  clock+=30000;await timer();assert.equal(calls,1);assert.equal(delay,1770000);
  clock+=1770000;await timer();assert.equal(calls,2);assert.equal(results[1].availability.state,'downloading');
  owner.stop();assert.equal(signal.aborted,true);assert.equal(cleared,2);
});

test('offline retry backs off and late completion after close cannot update UI',async()=>{
  let delay,resolve,updates=0;
  const base={gate:{notBefore:0},setTimer:(_fn,ms)=>{delay=ms;},clearTimer(){},onResult:()=>updates++};
  const offline=createWeatherPoller({...base,fetchField:async()=>{throw Object.assign(Error(),{kind:'offline'});},onError:(_error,status)=>{assert.equal(status.state,'offline');}});
  await offline.start();assert.equal(delay,60000);offline.stop();
  const pending=createWeatherPoller({...base,gate:{notBefore:0},fetchField:()=>new Promise(r=>resolve=r),onError:()=>assert.fail()});
  const task=pending.start();await Promise.resolve();pending.stop();resolve({state:'downloading',retry_after_seconds:3});await task;
  assert.equal(updates,0);
});
