import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountSettings,satelliteMatches} from '../src/services/accountSettings.js';
import {SPACE_OBJECTS} from '../src/data/spaceObjects.js';

const item={id:'message-1',kind:'satellite',target_id:'20580',title:'Isolated fixture',message:'Not a production prediction',source_at:'2026-11-01T12:00:00Z',created_at:'2026-11-01T12:05:00Z',expires_at:'2026-11-01T13:00:00Z',read_at:null,is_expired:false,destination:{kind:'satellite',target_id:'20580'}};
function fixture() {
  let subscriptions=[],messages=[{...item}],delay=null,fail=false;const calls=[];
  const transport={fetchAlertSubscriptions:async signal=>{calls.push(['list',signal]);return subscriptions.map(row=>({...row}));},
    followAlertTarget:async body=>{calls.push(['follow',body]);if(delay)await delay;if(fail)throw Error('Connection failed');const row={id:`${body.kind}:${body.target_id}`,target_name:body.target_id,...body};subscriptions.push(row);return row;},
    unfollowAlertTarget:async id=>{calls.push(['unfollow',id]);subscriptions=subscriptions.filter(row=>row.id!==id);},
    fetchInboxCount:async()=>({unread_count:messages.filter(row=>!row.read_at).length}),
    fetchInbox:async({cursor})=>{calls.push(['inbox',cursor]);return {items:messages.map(row=>({...row})),next_cursor:cursor?null:'fixture-cursor',unread_count:messages.filter(row=>!row.read_at).length};},
    markInboxRead:async id=>{messages=messages.map(row=>row.id===id?{...row,read_at:'2026-11-01T12:10:00Z'}:row);return {read_at:'2026-11-01T12:10:00Z',unread_count:0};},
    markAllInboxRead:async()=>({read_at:'2026-11-01T12:11:00Z',unread_count:0}),
    dismissInboxItem:async id=>{messages=messages.filter(row=>row.id!==id);return {unread_count:0};}};
  return {transport,calls,owner:createAccountSettings({transport}),setDelay:value=>{delay=value;},setFail:value=>{fail=value;}};
}
test('search uses the full Live catalog by readable name, aliases and NORAD ID',()=>{
  assert.equal(SPACE_OBJECTS.length,143);assert.equal(satelliteMatches(SPACE_OBJECTS,'20580')[0].noradId,20580);assert.ok(satelliteMatches(SPACE_OBJECTS,'HUBBLE').length>0);assert.equal(satelliteMatches(SPACE_OBJECTS,'not-in-catalog').length,0);
});
test('following is explicit, confirmed, single-flight and remembered independently of delivery preferences',async()=>{
  const f=fixture();await f.owner.loadSubscriptions();assert.deepEqual(f.owner.snapshot().subscriptions,[]);assert.equal(f.calls.length,1);
  let release;f.setDelay(new Promise(resolve=>{release=resolve;}));const writing=f.owner.toggleTarget('satellite','20580');assert.equal(f.owner.snapshot().subscriptions.length,0);await f.owner.toggleTarget('satellite','20580');assert.equal(f.calls.filter(([type])=>type==='follow').length,1);release();await writing;
  assert.equal(f.owner.snapshot().subscriptions[0].target_id,'20580');await f.owner.loadSubscriptions(true);assert.equal(f.owner.snapshot().subscriptions.length,1);
  await f.owner.toggleTarget('satellite','20580');assert.deepEqual(f.owner.snapshot().subscriptions,[]);
  f.setFail(true);await f.owner.toggleTarget('celestial','jupiter');assert.match(f.owner.snapshot().subscriptionError,/Connection/);assert.equal(f.owner.snapshot().subscriptions.length,0);f.owner.destroy();
});
test('inbox uses real counts, deduplicates pagination and confirms read/read-all/dismiss state',async()=>{
  const f=fixture();await f.owner.loadUnread();assert.equal(f.owner.snapshot().unreadCount,1);await f.owner.loadInbox();await f.owner.loadInbox(false,true);assert.equal(f.owner.snapshot().inbox.length,1);
  await f.owner.markRead(item.id);assert.equal(f.owner.snapshot().unreadCount,0);assert.equal(f.owner.snapshot().inbox[0].read_at,'2026-11-01T12:10:00Z');await f.owner.markAllRead();await f.owner.dismiss(item.id);assert.deepEqual(f.owner.snapshot().inbox,[]);f.owner.destroy();
});
test('late count and private responses cannot overwrite newer inbox state or a new account',async()=>{
  const f=fixture();let finish;f.transport.fetchInboxCount=()=>new Promise(resolve=>{finish=resolve;});const old=f.owner.loadUnread();await f.owner.loadInbox();finish({unread_count:99});await old;assert.equal(f.owner.snapshot().unreadCount,1);
  let finishSubscriptions,signal;f.transport.fetchAlertSubscriptions=s=>{signal=s;return new Promise(resolve=>{finishSubscriptions=resolve;});};const pending=f.owner.loadSubscriptions();f.owner.destroy();assert.equal(signal.aborted,true);finishSubscriptions([{id:'private-other-account'}]);await pending;assert.deepEqual(f.owner.snapshot().subscriptions,[]);assert.equal(f.owner.snapshot().unreadCount,null);
});
