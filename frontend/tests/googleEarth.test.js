import test from "node:test";
import assert from "node:assert/strict";
import {Cesium3DTileset} from "cesium";
import {GOOGLE_EARTH_ASSET,loadGoogleEarthTiles} from "../src/services/googleEarth.js";
test("Google retries resolve a fresh authorized ion endpoint instead of retaining a rejected convenience-factory promise",async context=>{
  let calls=0;const tiles={show:true};
  context.mock.method(Cesium3DTileset,'fromIonAssetId',async(id,options)=>{
    assert.equal(id,GOOGLE_EARTH_ASSET);assert.equal(options.cacheBytes,128);
    if(++calls===1) throw {statusCode:403};return tiles;
  });
  await assert.rejects(loadGoogleEarthTiles({cacheBytes:128}));
  assert.equal(await loadGoogleEarthTiles({cacheBytes:128}),tiles);assert.equal(calls,2);
});
