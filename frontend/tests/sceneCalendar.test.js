import assert from 'node:assert/strict';
import test from 'node:test';
import {dateFields,fieldsDate,daysInMonth,shiftMonth,validSceneTime} from '../src/utils/sceneCalendar.js';

test('calendar crosses years, clamps leap days, and validates complete draft fields',()=>{
  assert.equal(daysInMonth(2000,1),29);assert.equal(daysInMonth(2100,1),28);
  const fields=dateFields(new Date('2024-12-31T23:59:00Z'),'utc');
  assert.deepEqual(shiftMonth(fields,1),{...fields,year:'2025',month:'0'});
  const leap=dateFields(new Date('2024-01-31T12:30Z'),'utc');
  assert.equal(shiftMonth(leap,1).day,'29');
  assert.equal(fieldsDate({...leap,year:'20'},'utc'),null);
  assert.equal(fieldsDate({...leap,minute:'60'},'utc'),null);
  assert.equal(fieldsDate({...leap,month:'1',day:'31'},'utc'),null);
  assert.equal(validSceneTime(new Date('2101-01-01T00:00Z')),false);
});
test('UTC and local representations preserve the same instant when switching timezone',()=>{
  for(const timestamp of ['2000-01-01T00:00:00Z','2024-02-29T18:30:00Z','2025-12-31T23:59:00Z']) {
    const instant=new Date(timestamp);
    assert.equal(fieldsDate(dateFields(instant,'local'),'local').toISOString(),timestamp.replace('Z','.000Z'));
    assert.equal(fieldsDate(dateFields(instant,'utc'),'utc').getTime(),instant.getTime());
  }
});
