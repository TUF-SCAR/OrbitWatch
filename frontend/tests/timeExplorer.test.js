import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {TIME_OBJECTS,TIME_DEFAULT_OBJECTS} from '../src/data/timeExplorerCatalog.js';

test('Time Dock renders static reference identity, honest satellite coverage and actionable imagery failures',async()=>{
 const server=await createServer({configFile:false,plugins:[react()],server:{middlewareMode:true},appType:'custom'});
 try {
  const {default:TimeDock}=await server.ssrLoadModule('/src/components/TimeDock.jsx');
  const props={selectedTime:new Date('1990-01-01T12:00:00Z'),trackedCount:4,maxTracked:15};
  const render=imageryStatus=>renderToStaticMarkup(createElement(TimeDock,{...props,imageryStatus}));
  const ready=render({activeMap:'esri',state:'available'});
  assert.match(ready,/Esri World Imagery · Reference basemap/);
  assert.match(ready,/Not imagery from the selected time/);
  assert.match(ready,/Historical archive unavailable/);
  assert.match(ready,/Scene date and time \(local\)/);
  assert.doesNotMatch(ready,/View daily observations|View reference map|NASA historical|Retry reference/);
  const failed=render({activeMap:'local-reference',state:'unavailable',message:'Esri unavailable'});
  assert.match(failed,/NASA\/JPL\/USGS · Static reference texture/);
  assert.match(failed,/Retry reference basemap/);assert.match(failed,/Esri unavailable/);
  assert.doesNotMatch(failed,/Esri World Imagery · Reference basemap/);
  const populated=renderToStaticMarkup(createElement(TimeDock,{...props,historicalData:{state:'ready',objects:TIME_DEFAULT_OBJECTS.map(norad_id=>({norad_id})),errors:[]}}));
  assert.match(populated,/4\/4 historical positions available/);
  assert.doesNotMatch(populated,/Historical archive unavailable/);
  const {default:ObjectExplorer}=await server.ssrLoadModule('/src/components/ObjectExplorer.jsx');
  const explorer=renderToStaticMarkup(createElement(ObjectExplorer,{open:true,historical:true,objects:TIME_OBJECTS,trackedIds:TIME_DEFAULT_OBJECTS,historicalData:{state:'ready',objects:[],errors:[]}}));
  assert.match(explorer,/PERMANENT TIME CATALOG.*15/);
  assert.match(explorer,/ONEWEB-0012/);assert.doesNotMatch(explorer,/58990|Create custom filter|Add .* to collection/);
 } finally {await server.close();}
});

test('Time Explorer keeps a single Viewer and the Live map preference out of timestamp state',async()=>{
 const globe=await readFile(new URL('../src/components/OrbitGlobe.jsx',import.meta.url),'utf8');
 const app=await readFile(new URL('../src/App.jsx',import.meta.url),'utf8');
 assert.equal((globe.match(/new Viewer\(/g)||[]).length,1);
 assert.doesNotMatch(globe,/nasa-time|createNasaImageryService|timeReference|selectedTimeRef/);
 const timeChange=app.slice(app.indexOf('function queueSceneTime'),app.indexOf('function timePrepared'));
 assert.doesNotMatch(timeChange,/setMapStyle|setTimeBusy|setTimeout/);
 assert.match(app,/onReturnLive=\{\(\) => changeMode\("live"\)\}/);
 assert.match(globe,/timeSatelliteSelection\(trackedIds\)/);
});
