import test from "node:test";
import assert from "node:assert/strict";
import {createEarthMapFactories} from "../src/services/earthMapProviders.js";
test("CARTO uses the documented keyed browser endpoints and attribution; unconfigured providers do not request access",()=>{
  const args={nasa:{create(){}},selectedTime:()=>new Date()};
  const missing=createEarthMapFactories(args);
  assert.equal(missing['carto-dark'](true),null);assert.equal(missing.bing(),null);
  const configured=createEarthMapFactories({...args,cartoKey:'test-key'});
  const dark=configured['carto-dark'](true),voyager=configured['carto-voyager'](false);
  assert.match(dark.url,/basemaps.cartocdn.com\/dark_all/);
  assert.match(voyager.url,/rastertiles\/voyager_nolabels/);
  assert.match(dark.url,/key=test-key/);assert.match(dark.credit.html,/CARTO/);assert.match(dark.credit.html,/OpenStreetMap/);
});
