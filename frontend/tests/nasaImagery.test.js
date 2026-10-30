import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { nasaReferenceProvider } from '../src/services/nasaImagery.js';

test('manual Live NASA reference remains an attributed undated composite',()=>{
  const provider=nasaReferenceProvider();
  assert.match(provider.url,/BlueMarble_ShadedRelief_Bathymetry/);
  assert.doesNotMatch(provider.url,/MODIS|GetCapabilities/);
  assert.match(provider.credit.html,/NASA.*fixed reference composite/);
});

test('local reference fallback asset exists and retains its scientific credit',async()=>{
  const asset=await readFile(new URL('../public/textures/planets/earth.jpg',import.meta.url));
  assert.ok(asset.length>1000);
  const service=await readFile(new URL('../src/services/nasaImagery.js',import.meta.url),'utf8');
  assert.match(service,/NASA\/JPL\/USGS.*static reference Earth texture/);
  assert.doesNotMatch(service,/MODIS|GetCapabilities|createNasaImageryService/);
});
