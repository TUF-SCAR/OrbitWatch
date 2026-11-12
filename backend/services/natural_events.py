"""Read-only natural reports, independently cached/budgeted per provider.

No startup fetches, arbitrary URL proxy, event-by-event fanout or Supabase writes.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
import json
import os
from pathlib import Path
import re
import threading
import time
import httpx
from core.config import enabled
from core.database import database_availability
from services.weather_cache import WeatherCache, WeatherDeferred
from services.natural_event_data import normalize, cross_references, iso, date
from services.natural_event_sources import acquire
from services.event_policy import fair_events,material_updates
from services.cyclone_tracks import IBTRACS_URL,NHC_URL,attach_forecasts
from services.weather_cache import WeatherDeferred

POLICIES={'eonet':(900,4,96),'gdacs':(900,4,96),'usgs':(300,12,288),'ibtracs':(43200,2,2),'nhc':(900,4,96)}
URLS={'eonet':'https://eonet.gsfc.nasa.gov/api/v3/events',
      'gdacs':'https://www.gdacs.org/gdacsapi/api/Events/geteventlist/search',
      'usgs':'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_month.geojson','ibtracs':IBTRACS_URL,'nhc':NHC_URL}
LIMITATIONS={'eonet':'Up to 500 open curated events without an age cutoff, plus 150 closed reports in 30 days. Open does not verify an ongoing hazard.',
             'gdacs':'Two pages each: EQ/TC in 30 days; FL/VO/DR/WF in 180 days. Shared 4-request/hour budget; incomplete pagination is disclosed. Overall and episode alerts differ.',
             'usgs':'Official M2.5+ month feed; not all earthquakes or continuing hazards. Origin and review update times differ.',
             'ibtracs':'NOAA v4r01 ACTIVE global subset, storms active in archive last 7 days; batch updates can lag. Only original agency positions, no interpolated/spur positions; at most 32 storms/512 points each.',
             'nhc':'NHC/CPHC official forecast points for Atlantic/Eastern and Central Pacific only. At most two active bins per refresh, 12-hour issue freshness. No inferred global forecast.'}


class EventCache(WeatherCache):
    def policy(self,provider):return POLICIES[provider]
    def reserve_extra(self,provider):
        # Pagination is one owned refresh; charge every additional HTTP request
        # while retaining the normal refresh interval and hourly/daily ceilings.
        now=self.clock();_,hourly,daily=self.policy(provider)
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            hour=db.execute('SELECT count(*) FROM calls WHERE provider=? AND stamp>?',(provider,now-3600)).fetchone()[0]
            day=db.execute('SELECT count(*) FROM calls WHERE provider=? AND stamp>?',(provider,now-86400)).fetchone()[0]
            if hour>=hourly or day>=daily:raise WeatherDeferred()
            db.execute('INSERT INTO calls VALUES(?,?)',(provider,now))


root=Path(os.getenv('ORBITWATCH_EVENTS_CACHE_DIR') or Path(__file__).resolve().parents[1]/'.runtime'/'events')
stores={p:EventCache(root/p) for p in POLICIES}
lock=threading.Lock();pending={};executor=None


def utcnow():return datetime.now(timezone.utc)


def fetch(provider,previous):
    return acquire(provider,previous,stores[provider],utcnow())


def respect_headers(store,provider,headers):
    now=store.clock();deadline=now
    match=re.search(r'(?:^|,)\s*max-age=(\d+)',headers.get('cache-control',''),re.I)
    if match:deadline=max(deadline,now+min(86400,int(match[1])))
    try:deadline=max(deadline,min(now+86400,parsedate_to_datetime(headers.get('expires','')).timestamp()))
    except (ValueError,TypeError,OverflowError):pass
    with store.db() as db:
        db.execute('UPDATE gates SET next_at=MAX(next_at,?) WHERE provider=?',(deadline,provider))


def freshness_seconds(provider,cached):
    """Provider cache policy can shorten freshness, never our request interval.

    no-cache reports are retained as explicitly stale application snapshots;
    they are not represented as a fresh reusable upstream HTTP response.
    """
    headers=cached.get('headers',{});control=headers.get('cache-control','').lower()
    if 'no-cache' in control or 'no-store' in control:return 0
    ttl=POLICIES[provider][0]
    match=re.search(r'(?:^|,)\s*max-age=(\d+)',control)
    if match:ttl=min(ttl,int(match[1]))
    try:ttl=min(ttl,max(0,parsedate_to_datetime(headers.get('expires','')).timestamp()-cached['validated_at']))
    except (ValueError,TypeError,OverflowError):pass
    return ttl


def refresh(provider):
    store=stores[provider]
    with store.lease() as owned:
        if not owned:raise WeatherDeferred()
        previous=store.get('feed')
        if previous and previous.get('schema_version')==2 and time.time()-previous['validated_at']<POLICIES[provider][0]:return previous
        database_availability.ensure()
        if not enabled('ORBITWATCH_EVENT_PROVIDER_REQUESTS',True):raise WeatherDeferred()
        store.reserve(provider);store.record(provider,'downloading')
        try:
            data,headers=fetch(provider,previous)
            if 'no-store' in headers.get('cache-control','').lower():raise ValueError('Provider disallows persisted response')
            if data is None:
                value={**previous,'validated_at':time.time(),'headers':{**previous.get('headers',{}),**headers}}
            else:
                retrieved=iso(utcnow())
                if '_normalized_events' in data:events,rejected=data['_normalized_events'],data.get('_rejected_count',0)
                else:events,rejected=normalize(provider,data,retrieved)
                events=material_updates(events,(previous or {}).get('events',[]))
                acquisition=data.get('_acquisition',{})
                value={'events':events,'retrieved_at':retrieved,'validated_at':time.time(),'headers':headers,
                       'rejected_count':rejected,'source_url':URLS[provider],'schema_version':2,
                       'parts':acquisition.get('parts',{}),'coverage':acquisition.get('coverage',{}),'forecasts':data.get('forecasts',[])}
            respect_headers(store,provider,value['headers']);store.put('feed','global',value);store.succeeded(provider)
            return value
        except Exception as error:
            store.failed(provider,error)
            raise WeatherDeferred() from None


def revalidate(provider):
    global executor
    with lock:
        future=pending.get(provider)
        if future and not future.done():return
        if stores[provider].gate(provider)['retry_after_seconds'] or not enabled('ORBITWATCH_EVENT_PROVIDER_REQUESTS',True):return
        if executor is None:executor=ThreadPoolExecutor(max_workers=3,thread_name_prefix='natural-events')
        future=executor.submit(refresh,provider);pending[provider]=future
        future.add_done_callback(lambda job:job.exception())


def current_events(schedule=True,refresh_providers=None):
    events=[];forecasts=[];providers={};usable=0;now=time.time()
    for provider,store in stores.items():
        cached=store.get('feed');age=max(0,now-cached['validated_at']) if cached else None
        ttl=freshness_seconds(provider,cached) if cached else 0
        if schedule and (refresh_providers is None or provider in refresh_providers) and (age is None or age>=ttl):revalidate(provider)
        gate=store.gate(provider);future=pending.get(provider)
        with store.lease() as free:busy=not free
        active=(future is not None and not future.done()) or busy
        valid=cached is not None and age<=(7*86400 if provider=='ibtracs' else 86400)
        state=('refreshing' if active else 'stale' if age>=ttl else 'available') if valid else 'preparing' if active else 'unavailable'
        if valid:
            usable+=1
            forecasts.extend(cached.get('forecasts',[]))
            for e in cached['events']:
                # Legacy caches never retain the old arbitrary polygon marker.
                g=e.get('geometry') or {};position=g.get('coordinates') if g.get('type')=='Point' else None
                events.append({**e,'position':position,'provider_validated_at':iso(datetime.fromtimestamp(cached['validated_at'],timezone.utc)),
                    'recent_activity_verified':False,'recent_report_available':utcnow()-date(e['reported_at'])<=timedelta(days=7),'data_state':'stale' if state in {'stale','refreshing'} else 'available'})
        activity=store.event(provider)
        latest=max((e['reported_at'] for e in cached['events']),default=None,key=date) if cached else None
        providers[provider]={'state':state,'retrieved_at':cached['retrieved_at'] if cached else None,
                             'validated_at':iso(datetime.fromtimestamp(cached['validated_at'],timezone.utc)) if cached else None,
                             'retry_after_seconds':3 if active else max(5,gate['retry_after_seconds']),
                             'failure':activity.get('category') if activity and gate['failures'] else None,
                             'http_status':activity.get('http_status') if activity and gate['failures'] else None,
                             'count':len(cached['events']) if valid else 0,'rejected_count':cached.get('rejected_count',0) if cached else 0,
                             'source_url':URLS[provider],'limitation':LIMITATIONS[provider],
                             'coverage':cached.get('coverage',{}) if cached else {},
                             'latest_observation':latest,'source_age_seconds':max(0,now-date(latest).timestamp()) if latest else None,'cache_age_seconds':age}
    total=len(events);events,unmatched=attach_forecasts(events,forecasts)
    events=cross_references(fair_events(events))
    return {'state':'available' if usable==len(stores) else 'partial' if usable else 'preparing' if any(p['state']=='preparing' for p in providers.values()) else 'unavailable',
            'events':events,'providers':providers,'generated_at':iso(utcnow()),
            'coverage':{'normalized_reports':total,'displayed_reports':len(events),'display_cap':1200,'provider_cap':400,'allocation':'Round robin across provider/category groups','truncated':len(events)<total,'unmatched_forecast_ids':unmatched},
            'optional_sources':{'firms':'Not enabled. A NASA FIRMS MAP_KEY and separately reviewed hotspot budget are required.',
                'imd':'Official cyclone_track endpoint requires authorization (HTTP 401); no key configured or bypass attempted.','gdacs_forecast':'No forecast path inferred from general event geometry.'},
            'disclaimer':'Educational visualization of reported events; not a public warning service. Consult official local authorities.'}


def shutdown():
    global executor
    with lock:
        if executor:executor.shutdown(wait=False,cancel_futures=True)
        executor=None;pending.clear()
