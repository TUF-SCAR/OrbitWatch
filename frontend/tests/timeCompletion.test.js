import test from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import {execFileSync} from 'node:child_process';
import {ALL_CELESTIAL_IDS,CELESTIAL_BODIES} from '../src/data/celestialBodies.js';
import {TIME_CELESTIAL_IDS,celestialDestinationAllowed} from '../src/utils/navigationVisibility.js';
import {TIME_OBJECTS} from '../src/data/timeExplorerCatalog.js';
import {historicalAvailability,prelaunchNotice} from '../src/services/timeSatelliteAvailability.js';
import {fieldsDate,validSceneTime,MIN_SCENE_TIME} from '../src/utils/sceneCalendar.js';

test('all canonical destinations are selectable; 1945 has useful astronomy and 15 documented prelaunch states',()=>{
  assert.deepEqual(TIME_CELESTIAL_IDS,ALL_CELESTIAL_IDS);assert.equal(TIME_CELESTIAL_IDS.length,47);
  for(const id of ALL_CELESTIAL_IDS)assert.ok(celestialDestinationAllowed('time',id));
  assert.equal(ALL_CELESTIAL_IDS.filter(id=>CELESTIAL_BODIES[id].type==='Moon').length,26);
  assert.equal(celestialDestinationAllowed('time','invented'),false);
  const time=new Date('1945-01-01T00:00:00Z');
  assert.equal(validSceneTime(time),true);assert.equal(time.getTime(),MIN_SCENE_TIME);
  for(const row of TIME_OBJECTS)assert.equal(historicalAvailability(row.noradId,time).state,'not_launched');
  assert.match(prelaunchNotice(TIME_OBJECTS,time),/15 of the 15/);
  assert.equal(validSceneTime(new Date('1944-12-31T23:59:59Z')),false);
  assert.equal(validSceneTime(new Date(Date.now()+3600000)),false);
});

test('archive gaps, lifetime uncertainty, verified decay, failed SGP4 and qualifying epochs remain distinct',()=>{
  const time=new Date('2024-01-01T12:00:00Z');
  assert.equal(historicalAvailability(20580,time).state,'unavailable');
  assert.equal(historicalAvailability(20580,new Date('1990-04-24T12:00Z')).state,'unknown');
  assert.equal(historicalAvailability(20580,time,null,null,{}).state,'unknown');
  assert.equal(historicalAvailability(20580,time,null,null,{launch_date:'1990-04-24',decay_date:'2024-01-01'}).state,'decayed');
  const coverage={objects:[{norad_id:20580,first_epoch:'2020-01-01',last_epoch:'2025-01-01',valid_windows:[]}]};
  assert.equal(historicalAvailability(20580,time,coverage).state,'unavailable','Epoch extrema cannot imply continuous coverage');
  coverage.objects[0].valid_windows=[{start:'2024-01-01T00:00Z',end:'2024-01-02T00:00Z'}];
  assert.equal(historicalAvailability(20580,time,coverage).state,'available');
  assert.equal(historicalAvailability(20580,time,coverage,{timestamp:time.toISOString(),objects:[],errors:[{norad_id:20580,message:'Invalid propagated state'}]}).state,'unavailable');
});

test('calendar rejects local DST gaps and preserves known repeated-hour instants when displayed in UTC',()=>{
  const module=new URL('../src/utils/sceneCalendar.js',import.meta.url).href;
  const source=`import assert from 'node:assert/strict';import {fieldsDate,dateFields} from '${module}';assert.equal(fieldsDate({year:'2024',month:'2',day:'10',hour:'2',minute:'30'},'local'),null);const a=new Date('2024-11-03T06:30:00Z');assert.equal(fieldsDate(dateFields(a,'utc'),'utc').getTime(),a.getTime());`;
  execFileSync(process.execPath,['--input-type=module','-e',source],{env:{...process.env,TZ:'America/New_York'}});
  assert.equal(fieldsDate({year:'2000',month:'1',day:'29',hour:'0',minute:'0'},'utc').getUTCDate(),29);
  assert.equal(fieldsDate({year:'2001',month:'1',day:'29',hour:'0',minute:'0'},'utc'),null);
});
