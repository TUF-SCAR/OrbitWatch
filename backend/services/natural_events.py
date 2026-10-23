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

POLICIES={'eonet':(900,4,96),'gdacs':(900,4,96),'usgs':(300,12,288)}
URLS={'eonet':'https://eonet.gsfc.nasa.gov/api/v3/events',
      'gdacs':'https://www.gdacs.org/gdacsapi/api/Events/geteventlist/search',
      'usgs':'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson'}
LIMITATIONS={'eonet':'Latest 300 events in 30 days. Open is curation status, not a current threat.',
             'gdacs':'Latest 100 reports in 30 days. Overall alert level may differ from the latest episode. Dates without offsets are interpreted as UTC.',
             'usgs':'M2.5+ reported earthquakes in the past 7 days; not all earthquakes. Origin time and review updates are distinct.'}


class EventCache(WeatherCache):
    def policy(self,provider):return POLICIES[provider]


root=Path(os.getenv('ORBITWATCH_EVENTS_CACHE_DIR') or Path(__file__).resolve().parents[1]/'.runtime'/'events')
stores={p:EventCache(root/p) for p in POLICIES}
lock=threading.Lock();pending={};executor=None


def utcnow():return datetime.now(timezone.utc)


def fetch(provider,previous):
    now=utcnow();params={}
    if provider=='eonet':params={'status':'all','days':30,'limit':300}
    if provider=='gdacs':params={'eventlist':'EQ;TC;FL;VO;DR;WF','fromDate':(now-timedelta(days=30)).strftime('%Y-%m-%d'),
                               'toDate':now.strftime('%Y-%m-%d'),'pageSize':100,'pageNumber':1}
    headers={'User-Agent':'OrbitWatch/1.0 (educational natural-event visualization)'}
    if previous:
        for source,target in [('etag','If-None-Match'),('last-modified','If-Modified-Since')]:
            value=previous.get('headers',{}).get(source)
            if value:headers[target]=value
    with httpx.Client(timeout=httpx.Timeout(20,connect=5),follow_redirects=False) as client:
        with client.stream('GET',URLS[provider],params=params,headers=headers) as response:
            response.raise_for_status()
            safe_headers={k:v[:1000] for k,v in response.headers.items() if k in {'cache-control','expires','etag','last-modified'}}
            if response.status_code==304 and previous:return None,safe_headers
            if response.status_code!=200:raise ValueError('Unexpected feed status')
            chunks=[];size=0;start=time.monotonic()
            for chunk in response.iter_bytes():
                size+=len(chunk)
                if size>8000000 or time.monotonic()-start>35:raise ValueError('Feed exceeds bounds')
                chunks.append(chunk)
            return json.loads(b''.join(chunks)),safe_headers


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
        if previous and time.time()-previous['validated_at']<POLICIES[provider][0]:return previous
        database_availability.ensure()
        if not enabled('ORBITWATCH_EVENT_PROVIDER_REQUESTS',True):raise WeatherDeferred()
        store.reserve(provider);store.record(provider,'downloading')
        try:
            data,headers=fetch(provider,previous)
            if 'no-store' in headers.get('cache-control','').lower():raise ValueError('Provider disallows persisted response')
            if data is None:
                value={**previous,'validated_at':time.time(),'headers':{**previous.get('headers',{}),**headers}}
            else:
                retrieved=iso(utcnow());events,rejected=normalize(provider,data,retrieved)
                value={'events':events,'retrieved_at':retrieved,'validated_at':time.time(),'headers':headers,
                       'rejected_count':rejected,'source_url':URLS[provider]}
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


def current_events(schedule=True):
    events=[];providers={};usable=0;now=time.time()
    for provider,store in stores.items():
        cached=store.get('feed');age=max(0,now-cached['validated_at']) if cached else None
        ttl=freshness_seconds(provider,cached) if cached else 0
        if schedule and (age is None or age>=ttl):revalidate(provider)
        gate=store.gate(provider);future=pending.get(provider)
        with store.lease() as free:busy=not free
        active=(future is not None and not future.done()) or busy
        valid=cached is not None and age<=86400
        state=('refreshing' if active else 'stale' if age>=ttl else 'available') if valid else 'preparing' if active else 'unavailable'
        if valid:
            usable+=1
            for e in cached['events']:
                events.append({**e,'data_state':'stale' if state in {'stale','refreshing'} else 'available'})
        activity=store.event(provider)
        providers[provider]={'state':state,'retrieved_at':cached['retrieved_at'] if cached else None,
                             'validated_at':iso(datetime.fromtimestamp(cached['validated_at'],timezone.utc)) if cached else None,
                             'retry_after_seconds':3 if active else max(5,gate['retry_after_seconds']),
                             'failure':activity.get('category') if activity and gate['failures'] else None,
                             'http_status':activity.get('http_status') if activity and gate['failures'] else None,
                             'count':len(cached['events']) if valid else 0,'rejected_count':cached.get('rejected_count',0) if cached else 0,
                             'source_url':URLS[provider],'limitation':LIMITATIONS[provider]}
    events=cross_references(sorted(events,key=lambda e:date(e['reported_at']),reverse=True))
    return {'state':'available' if usable==3 else 'partial' if usable else 'preparing' if any(p['state']=='preparing' for p in providers.values()) else 'unavailable',
            'events':events,'providers':providers,'generated_at':iso(utcnow()),
            'optional_sources':{'firms':'Not enabled. A NASA FIRMS MAP_KEY and separately reviewed hotspot budget are required.'},
            'disclaimer':'Educational visualization of reported events; not a public warning service. Consult official local authorities.'}


def shutdown():
    global executor
    with lock:
        if executor:executor.shutdown(wait=False,cancel_futures=True)
        executor=None;pending.clear()
