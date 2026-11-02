"""Isolated source, geometry, real IBTrACS excerpt and alert policy contracts."""
from datetime import datetime,timedelta,timezone
import copy
from hashlib import sha256
import json
import os
from pathlib import Path
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import httpx

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'backend'))
os.environ['DATABASE_URL']='sqlite://';os.environ['JWT_SECRET_KEY']='isolated-event-expansion-tests'
from services.natural_event_data import normalize,iso
from services.cyclone_tracks import ibtracs_events,nhc_forecast,attach_forecasts
from services.event_geometry import proximity
from services.event_policy import material_updates,fair_events
from services.notification_policy import event_candidate
from services.natural_events import EventCache
from services.natural_event_sources import acquire

NOW=datetime(2026,11,2,12,tzinfo=timezone.utc)


def gdacs(level='Orange',episode='Orange',updated=None):
    return {'geometry':{'type':'Point','coordinates':[10,20]},'properties':{'eventtype':'FL','eventid':123,'name':'ISOLATED source schema fixture','fromdate':iso(NOW-timedelta(days=80)),'todate':iso(NOW-timedelta(days=40)),'datemodified':iso(updated or NOW),'alertlevel':level,'episodealertlevel':episode,'episodeid':3}}


class EventExpansion(unittest.TestCase):
    def test_open_eonet_older_than_month_is_not_physical_activity(self):
        row={'id':'isolated','title':'Source monitored wildfire','closed':None,'categories':[{'id':'wildfires'}],
            'geometry':[{'type':'Point','coordinates':[10,20],'date':iso(NOW-timedelta(days=100))}]}
        event=normalize('eonet',{'events':[row]},iso(NOW),NOW)[0][0]
        self.assertEqual(event['report_context'],'older_source_monitored');self.assertFalse(event['recent_activity_verified'])
        self.assertEqual(event['reported_at'],iso(NOW-timedelta(days=100)))
        row['closed']=iso(NOW-timedelta(days=80));self.assertFalse(normalize('eonet',{'events':[row]},iso(NOW),NOW)[0])
        row['closed']=iso(NOW-timedelta(days=1));event=normalize('eonet',{'events':[row]},iso(NOW),NOW)[0][0];self.assertEqual(event['status'],'closed')
    def test_gdacs_episode_status_and_future_end_are_separate(self):
        row=gdacs('Red','Green');row['properties']['todate']=iso(NOW+timedelta(days=3))
        event=normalize('gdacs',{'features':[row]},iso(NOW),NOW)[0][0]
        self.assertEqual(event['status'],'Red');self.assertEqual(event['episode_status'],'Green');self.assertEqual(event['reported_at'],iso(NOW))
        self.assertEqual(event['source_end_at'],iso(NOW+timedelta(days=3)))
        event['data_state']='available';self.assertIsNone(event_candidate(event,SimpleNamespace(latitude=20,longitude=10,name='Isolated',id='x',timezone='UTC'),100,NOW))
    def test_polygon_anchor_is_absent(self):
        row=gdacs();row['geometry']={'type':'Polygon','coordinates':[[[9,19],[11,19],[11,21],[9,21],[9,19]]]}
        event=normalize('gdacs',{'features':[row]},iso(NOW),NOW)[0][0]
        self.assertIsNone(event['position']);self.assertNotIn('vertex',event['position_meaning'])
    def test_dateline_polygon_holes_and_multiple_components(self):
        shell=[[179,10],[-179,10],[-179,12],[179,12],[179,10]]
        hole=[[179.5,10.5],[-179.5,10.5],[-179.5,11.5],[179.5,11.5],[179.5,10.5]]
        g={'type':'Polygon','coordinates':[shell,hole]}
        self.assertEqual(proximity(g,11,179.25),0);self.assertGreater(proximity(g,11,180),40)
        self.assertGreater(proximity(g,11,0),10000)
        other=[[[30,10],[31,10],[31,11],[30,11],[30,10]]]
        self.assertEqual(proximity({'type':'MultiPolygon','coordinates':[[shell,hole],other]},10.5,30.5),0)
        self.assertIsNone(proximity({'type':'Polygon','coordinates':[[[0,0],[1,1],[0,1],[1,0],[0,0]]]},.5,.5))
        self.assertIsNone(proximity({'type':'Polygon','coordinates':[[[0,86],[1,86],[1,87],[0,86]]]},86.5,.5))
        self.assertIsNone(proximity(None,0,0));self.assertIsNone(proximity([],0,0))
    def test_old_incident_requires_verified_material_source_update(self):
        previous=normalize('gdacs',{'features':[gdacs(updated=NOW-timedelta(hours=2))]},iso(NOW),NOW)[0]
        latest=normalize('gdacs',{'features':[gdacs('Red','Red')]},iso(NOW),NOW)[0]
        event=material_updates(latest,previous)[0];event['data_state']='available'
        location=SimpleNamespace(latitude=20,longitude=10,name='Isolated',id='x',timezone='UTC')
        candidate=event_candidate(event,location,100,NOW)
        self.assertIsNotNone(candidate);self.assertEqual(candidate['source_at'],NOW);self.assertGreater(candidate['expires_at'],NOW)
        self.assertIsNone(event_candidate({**event,'material_update':None},location,100,NOW))
        self.assertIsNone(event_candidate(event,location,100,NOW,3))
        repeated=material_updates([{**event,'retrieved_at':iso(NOW+timedelta(minutes=10))}],[event])[0]
        self.assertEqual(repeated['material_update'],event['material_update'])
        self.assertIsNone(event_candidate({**event,'data_state':'stale'},location,100,NOW))
    def test_significant_usgs_revision_can_update_an_old_origin(self):
        event={'id':'usgs:isolated','provider':'usgs','category':'earthquake','reported_at':iso(NOW-timedelta(days=5)),
            'updated_at':iso(NOW),'retrieved_at':iso(NOW),'geometry':{'type':'Point','coordinates':[10,20]},'data_state':'available',
            'measurements':[{'label':'Magnitude (mw)','value':5.1}],'status':'reviewed'}
        loc=SimpleNamespace(latitude=20,longitude=10,name='Isolated',id='x',timezone='UTC')
        self.assertIsNotNone(event_candidate(event,loc,50,NOW,4.5));self.assertIsNone(event_candidate(event,loc,50,NOW,5.1));self.assertIsNone(event_candidate(event,loc,50,NOW))
    def test_new_reported_polygon_area_can_reach_a_saved_location(self):
        old=gdacs(updated=NOW-timedelta(hours=2));old['geometry']={'type':'Polygon','coordinates':[[[12,19],[13,19],[13,21],[12,21],[12,19]]]}
        new=gdacs();new['geometry']={'type':'Polygon','coordinates':[[[9,19],[11,19],[11,21],[9,21],[9,19]]]}
        previous=normalize('gdacs',{'features':[old]},iso(NOW),NOW)[0];latest=normalize('gdacs',{'features':[new]},iso(NOW),NOW)[0]
        event=material_updates(latest,previous)[0];event['data_state']='available'
        loc=SimpleNamespace(latitude=20,longitude=10,name='Isolated',id='x',timezone='UTC')
        self.assertEqual(event['material_update']['kind'],'reported_boundary_change')
        self.assertIsNotNone(event_candidate(event,loc,50,NOW,2))
        self.assertIsNone(event_candidate(event,SimpleNamespace(**{**vars(loc),'longitude':12.5}),50,NOW,2))
    def test_selected_geometry_is_bounded_cached_and_not_a_danger_area(self):
        from services.event_boundaries import selected_boundary
        actual=httpx.Client;requests=[]
        def handler(request):
            requests.append(request)
            return httpx.Response(200,json={'features':[{'geometry':{'type':'Polygon','coordinates':[[[9,19],[11,19],[11,21],[9,21],[9,19]]]}}]})
        with tempfile.TemporaryDirectory() as temp:
            store=EventCache(Path(temp));event=normalize('gdacs',{'features':[gdacs()]},iso(NOW),NOW)[0][0]
            with patch('services.event_boundaries.httpx.Client',side_effect=lambda **kw:actual(transport=httpx.MockTransport(handler),**kw)):
                first=selected_boundary(event,store);second=selected_boundary(event,store)
                self.assertEqual(first,second);self.assertEqual(len(requests),1);self.assertEqual(len(first['boundaries']),1)
                self.assertIn('no verified current danger area',first['meaning']);self.assertEqual(event['geometry']['type'],'Point')
    def test_real_global_ibtracs_excerpt_has_only_source_positions(self):
        path=ROOT/'tests/fixtures/ibtracs_v4r01_active_excerpt.csv';raw=path.read_bytes()
        meta=json.loads(path.with_suffix('.provenance.json').read_text(encoding='utf8'))
        self.assertEqual(sha256(raw).hexdigest(),meta['excerpt_sha256'])
        events,rejected=ibtracs_events(raw,meta['retrieved_at'],NOW)
        self.assertEqual(len(events),2);self.assertGreater(rejected,0)
        for event in events:
            self.assertGreater(len(event['track']['observed']),2);self.assertEqual(event['track']['forecast'],[])
            self.assertTrue(all(p['interpolation_flag'] in 'OIV' for p in event['track']['observed']))
        with self.assertRaises(ValueError):ibtracs_events(b'wrong,header\n',iso(NOW),NOW)
    def test_forecast_issue_expiration_identity_and_no_name_merge(self):
        # Isolated forecast contract fixture, not production/source weather data.
        storm={'id':'AL012026','binNumber':'AT1','name':'ISOLATED','lastUpdate':iso(NOW)}
        features=[{'attributes':{'binnumber':'AT1','basin':'AL','stormnum':1,'validtime':(NOW+timedelta(hours=h)).strftime('%Y%m%d%H'),'advdate':iso(NOW),'maxwind':65,'advisnum':'3'},'geometry':{'x':-60+h/6,'y':20}} for h in (6,12)]
        track=nhc_forecast(storm,{'features':features},iso(NOW),NOW)
        self.assertEqual(len(track['forecast']),2);self.assertEqual(track['observed'],[])
        self.assertEqual(track['forecast'][0]['wind_averaging_minutes'],1)
        self.assertIsNone(nhc_forecast(storm,{'features':features},iso(NOW),NOW+timedelta(hours=13)))
        wrong=copy.deepcopy(features);wrong[0]['attributes']['stormnum']=2
        self.assertEqual(len(nhc_forecast(storm,{'features':wrong},iso(NOW),NOW)['forecast']),1)
        event={'id':'ibtracs:isolated','provider':'ibtracs','provider_event_id':'isolated','track':{'atcf_ids':['WP012026'],'forecast':[]}}
        joined,unmatched=attach_forecasts([event],[track],NOW)
        self.assertEqual(joined[0]['track']['forecast'],[]);self.assertEqual(unmatched,['AL012026'])
        event['track']['atcf_ids']=['AL012026'];joined,unmatched=attach_forecasts([event],[track],NOW);self.assertEqual(len(joined[0]['track']['forecast']),2)
    def test_fair_allocation_does_not_let_quakes_erase_other_categories(self):
        events=[dict(id=f'usgs:{i}',provider='usgs',category='earthquake',reported_at=iso(NOW)) for i in range(1200)]
        events += [dict(id=f'eonet:{i}',provider='eonet',category='wildfire' if i else 'cyclone',reported_at=iso(NOW)) for i in range(650)]
        events += [dict(id='gdacs:1',provider='gdacs',category='drought',reported_at=iso(NOW))]
        out=fair_events(events);self.assertEqual(sum(e['provider']=='usgs' for e in out),400)
        self.assertTrue(any(e['category']=='drought' for e in out));self.assertTrue(any(e['category']=='cyclone' for e in out))
    def test_real_http_pagination_validators_304_and_request_budget(self):
        actual=httpx.Client;requests=[];cached=False
        def handler(request):
            requests.append(request);params=dict(request.url.params);group=params['eventlist'];page=params['pageNumber']
            tag=f'"{group}:{page}"'
            if request.headers.get('If-None-Match'):
                self.assertEqual(request.headers['If-None-Match'],tag);return httpx.Response(304,headers={'etag':tag})
            count=100 if group=='EQ;TC' else 1
            # Deliberately repeated second page must terminate, not loop.
            features=[{'properties':{'eventtype':'EQ' if count==100 else 'DR','eventid':i+1}} for i in range(count)]
            return httpx.Response(200,json={'features':features},headers={'etag':tag,'cache-control':'public,max-age=900'})
        with tempfile.TemporaryDirectory() as temp:
            clock=[time.time()];store=EventCache(Path(temp),clock=lambda:clock[0]);store.reserve('gdacs')
            with patch('services.natural_event_sources.httpx.Client',side_effect=lambda **kw:actual(transport=httpx.MockTransport(handler),**kw)):
                data,headers=acquire('gdacs',None,store,NOW)
                self.assertEqual(len(data['features']),101);self.assertEqual(len(requests),3);self.assertTrue(data['_acquisition']['coverage']['truncated'])
                clock[0]+=3701;store.reserve('gdacs')
                again,_=acquire('gdacs',{'parts':data['_acquisition']['parts']},store,NOW)
                self.assertEqual(len(again['features']),101);self.assertEqual(len(requests),6)
                self.assertEqual(again['features'][0]['_orbitwatch_retrieved_at'],data['features'][0]['_orbitwatch_retrieved_at'])


if __name__=='__main__':unittest.main()
