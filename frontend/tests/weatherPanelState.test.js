import test from 'node:test';
import assert from 'node:assert/strict';
import {toggleWeatherLayers} from '../src/services/weatherPanelState.js';
test('Weather opens on one state transition and queued toggles use current state',()=>{
  for(const width of [390,768,1440]){
    let layers=['map','place'];layers=toggleWeatherLayers(layers,width);assert.deepEqual(layers,['weather']);
    layers=toggleWeatherLayers(layers,width);assert.deepEqual(layers,[]);
    layers=toggleWeatherLayers(layers,width);assert.deepEqual(layers,['weather']);
    assert.deepEqual(toggleWeatherLayers(['explorer'],width),width<1100?['weather']:['explorer','weather']);
  }
});
