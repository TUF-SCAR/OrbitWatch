import test from 'node:test';
import assert from 'node:assert/strict';
import {feedStatus,feedAgeLabel,FEED_LABELS} from '../src/utils/feedStatus.js';
test('unrelated missing records are coverage, while aged tracked records stay stale',()=>{
 assert.equal(feedStatus({age_seconds:60,stale:false,missing_supported_objects:true}),'partial');
 assert.equal(feedStatus({age_seconds:60,stale:false}),'online');
 assert.equal(feedStatus({age_seconds:90000,stale:true,missing_supported_objects:true}),'stale');
 assert.equal(feedStatus({age_seconds:null,stale:true}),'unavailable');
 assert.equal(feedAgeLabel(90000),'1 d 1 h');assert.equal(feedAgeLabel(3600),'1 h 0 min');assert.equal(feedAgeLabel(null),'Unavailable');
 for(const state of ['checking','online','partial','stale','offline','unavailable'])assert.ok(FEED_LABELS[state]);
});
