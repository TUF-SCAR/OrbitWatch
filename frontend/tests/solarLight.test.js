import test from 'node:test';
import assert from 'node:assert/strict';
import {solarLight} from '../src/services/solarLight.js';
import {classifyPrecipitationHover,precipitationContext} from '../src/services/precipitationHover.js';
import {validatePrecipitationPhase} from '../src/services/weatherFields.js';

test('solar light uses source UTC, longitude, midnight, twilight and polar seasons',()=>{
  assert.equal(solarLight('2026-03-20T12:00:00Z',0,0),'day');
  assert.equal(solarLight('2026-03-20T12:00:00Z',180,0),'night');
  assert.equal(solarLight('2026-03-21T00:00:00Z',180,0),'day');
  assert.equal(solarLight('2026-03-20T06:00:00Z',0,0),'twilight');
  assert.equal(solarLight('2026-06-21T00:00:00Z',0,80),'day');
  assert.equal(solarLight('2026-12-21T12:00:00Z',0,80),'night');
  assert.equal(solarLight('2026-03-20T17:30:00+05:30',0,0),solarLight('2026-03-20T12:00:00Z',0,0));
  assert.equal(solarLight(null,0,0),'unknown');assert.equal(solarLight('invalid',0,0),'unknown');
  assert.equal(solarLight(null,0,0,0),'night');assert.equal(solarLight(null,0,0,1),'day');
});
test('missing light is neutral; nighttime partly cloudy never uses a sun; phase metadata must match',()=>{
  assert.equal(classifyPrecipitationHover(0,{clouds:0}).title,'Clear');
  assert.equal(classifyPrecipitationHover(0,{clouds:50,light:'night'}).icon,'☁️');
  for(const phase of ['freezing_rain','ice_pellets','mixed'])assert.equal(classifyPrecipitationHover(3,{phase}).kind,phase);
  const field={valid_at:'2026-03-20T00:00:00Z',precipitation_phase:{values:Array(65160).fill('snow')}};
  assert.equal(precipitationContext(field,0,0,()=>null).phase,null);
  assert.equal(precipitationContext(field,0,0,()=>null).light,'night');
  const phase={...field.precipitation_phase,units:'category',level:'surface',step_type:'instant',valid_at:field.valid_at};
  assert.equal(validatePrecipitationPhase(phase,field.valid_at),phase);
  assert.throws(()=>validatePrecipitationPhase({...phase,valid_at:'wrong'},field.valid_at));
  assert.throws(()=>validatePrecipitationPhase({...phase,values:Array(65160).fill('invented')},field.valid_at));
});
