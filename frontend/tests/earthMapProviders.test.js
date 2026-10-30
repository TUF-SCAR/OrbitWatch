import test from "node:test";
import assert from "node:assert/strict";
import {createEarthMapFactories,earthMapForMode} from "../src/services/earthMapProviders.js";
test("CARTO uses the documented keyed browser endpoints and attribution; unconfigured providers do not request access",()=>{
  const args={};
  const missing=createEarthMapFactories(args);
  assert.equal(missing['carto-dark'](true),null);assert.equal(missing.bing(),null);
  const configured=createEarthMapFactories({...args,cartoKey:'test-key'});
  const dark=configured['carto-dark'](true),voyager=configured['carto-voyager'](false);
  assert.match(dark.url,/basemaps.cartocdn.com\/dark_all/);
  assert.match(voyager.url,/rastertiles\/voyager_nolabels/);
  assert.match(dark.url,/key=test-key/);assert.match(dark.credit.html,/CARTO/);assert.match(dark.credit.html,/OpenStreetMap/);
});

test('Time Explorer always uses the existing Esri factory without mutating the Live preference',()=>{
  const factories=createEarthMapFactories();
  assert.equal(factories['nasa-time'],undefined);
  for(const liveMap of ['google','osm','bing','nasa-reference','esri']) {
    assert.equal(earthMapForMode('time',liveMap),'esri');
    assert.equal(earthMapForMode('live',liveMap),liveMap);
  }
  const provider=factories[earthMapForMode('time','google')]();
  assert.match(provider.url,/World_Imagery\/MapServer\/tile/);
  assert.doesNotMatch(provider.url,/gibs|MODIS|GetCapabilities|\d{4}-\d{2}-\d{2}/);
  assert.match(provider.credit.html,/Esri.*Maxar.*Earthstar/);
});
