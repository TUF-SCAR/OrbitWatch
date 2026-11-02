"""Bounded official acquisition. Every actual request is charged to its provider.

Conditional validators are scoped to the exact URL+parameters, never reused on
another page. A refresh's first request is reserved by its owner; extra pages
consume the same persistent hourly/daily budget without spawning client fanout.
"""
from datetime import timedelta
from hashlib import sha256
import json
import time
import httpx
from services.natural_event_data import iso
from services.weather_cache import WeatherDeferred
from services.cyclone_tracks import IBTRACS_URL,NHC_URL,NHC_GIS,ibtracs_events,nhc_forecast,nhc_event

EONET='https://eonet.gsfc.nasa.gov/api/v3/events'
GDACS='https://www.gdacs.org/gdacsapi/api/Events/geteventlist/search'
USGS='https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_month.geojson'


def acquire(provider,previous,store,now):
    parts={};requests=0;total=0;coverage={'requests':0,'pages':0,'truncated':False,'notes':[]};old=(previous or {}).get('parts',{})
    with httpx.Client(timeout=httpx.Timeout(20,connect=5),follow_redirects=False,headers={'User-Agent':'OrbitWatch/1.0 (educational reported-event visualization)'}) as client:
        def get(url,params=None,binary=False):
            nonlocal requests,total
            key=sha256(json.dumps([url,params],sort_keys=True).encode()).hexdigest()[:24];prior=old.get(key);headers={}
            if requests:store.reserve_extra(provider)
            requests+=1
            if prior:
                for name,target in [('etag','If-None-Match'),('last-modified','If-Modified-Since')]:
                    if prior.get('headers',{}).get(name):headers[target]=prior['headers'][name]
            with client.stream('GET',url,params=params,headers=headers) as response:
                if response.status_code!=304:response.raise_for_status()
                safe={k:v[:1000] for k,v in response.headers.items() if k in {'cache-control','expires','etag','last-modified'}}
                if 'no-store' in safe.get('cache-control','').lower():raise ValueError('Provider forbids persisted response')
                if response.status_code==304:
                    if not prior:raise ValueError('304 without exact cached page')
                    part={**prior,'headers':{**prior['headers'],**safe}}
                else:
                    if response.status_code!=200:raise ValueError('Unexpected source status')
                    chunks=[];size=0;start=time.monotonic()
                    for chunk in response.iter_bytes():
                        size+=len(chunk);total+=len(chunk)
                        if size>8_000_000 or total>16_000_000 or time.monotonic()-start>35:raise ValueError('Feed exceeds bounds')
                        chunks.append(chunk)
                    raw=b''.join(chunks)
                    payload=raw.decode('utf-8-sig') if binary else json.loads(raw)
                    part={'data':payload,'headers':safe,'retrieved_at':iso(now),'sha256':sha256(raw).hexdigest()}
                parts[key]=part;coverage['requests']=requests;coverage['bytes']=total;coverage['pages']+=1
                return part
        def rows(part,field):
            data=part['data'];items=data.get(field) if isinstance(data,dict) else None
            if not isinstance(items,list) or len(items)>5000:raise ValueError('Invalid source collection')
            return [{**row,'_orbitwatch_retrieved_at':part['retrieved_at']} for row in items if isinstance(row,dict)]
        if provider=='eonet':
            items=[]
            for params in ({'status':'open','limit':500},{'status':'closed','days':30,'limit':150}):
                try:page=rows(get(EONET,params),'events')
                except WeatherDeferred:coverage['truncated']=True;coverage['notes'].append('Remaining query deferred by shared provider budget');break
                items.extend(page)
                if len(page)>=params['limit']:coverage['truncated']=True
            data={'events':items}
        elif provider=='gdacs':
            items=[];seen=set()
            for types,days in [('EQ;TC',30),('FL;VO;DR;WF',180)]:
                for page_number in (1,2):
                    params={'eventlist':types,'fromDate':(now-timedelta(days=days)).strftime('%Y-%m-%d'),'toDate':now.strftime('%Y-%m-%d'),'pageSize':100,'pageNumber':page_number}
                    try:page=rows(get(GDACS,params),'features')
                    except WeatherDeferred:coverage['truncated']=True;coverage['notes'].append('Further pages deferred by shared GDACS budget');break
                    ids=[str(row.get('properties',{}).get('eventtype'))+':'+str(row.get('properties',{}).get('eventid')) for row in page]
                    new=[row for row,identity in zip(page,ids) if identity not in seen]
                    if page and not new:coverage['truncated']=True;coverage['notes'].append('Repeated page stopped');break
                    seen.update(ids);items.extend(new)
                    if len(page)<100:break
                    if page_number==2:coverage['truncated']=True
            data={'features':items}
        elif provider=='usgs':
            part=get(USGS);data={'features':rows(part,'features')}
        elif provider=='ibtracs':
            part=get(IBTRACS_URL,binary=True);events,rejected=ibtracs_events(part['data'].encode('utf8'),part['retrieved_at'],now)
            data={'_normalized_events':events,'_rejected_count':rejected};coverage['source_sha256']=part['sha256']
        elif provider=='nhc':
            part=get(NHC_URL);storms=part['data'].get('activeStorms')
            if not isinstance(storms,list) or len(storms)>30:raise ValueError('Invalid NHC storm index')
            forecasts=[];reports=[]
            for storm in storms[:2]:
                # Reviewed NOAA GIS forecast point layer IDs for official bins.
                import re
                match=re.fullmatch(r'(AT|EP|CP)([1-5])',str(storm.get('binNumber','')).upper())
                if not match:coverage['notes'].append('Unsupported official bin');continue
                layer={'AT':6,'EP':136,'CP':266}[match[1]]+26*(int(match[2])-1)
                try:points=get(f'{NHC_GIS}/{layer}/query',{'f':'json','where':'1=1','outFields':'*','outSR':4326,'returnGeometry':'true','resultRecordCount':32})
                except WeatherDeferred:coverage['truncated']=True;break
                forecast=nhc_forecast(storm,points['data'],points['retrieved_at'],now)
                if forecast:forecasts.append(forecast);reports.append(nhc_event(storm,forecast,points['retrieved_at']))
                else:coverage['notes'].append('Forecast points unavailable, expired or could not be verified')
            coverage.update(active_storms=len(storms),forecast_storms=len(forecasts),truncated=coverage['truncated'] or len(storms)>2)
            data={'_normalized_events':reports,'forecasts':forecasts}
        else:raise ValueError('Unsupported provider')
    # Validators stay in parts. Synthetic aggregate headers are never reused for
    # network requests; restrictive freshness/cache hints still reach the owner.
    restrictive=any('no-cache' in p['headers'].get('cache-control','').lower() for p in parts.values())
    data['_acquisition']={'parts':parts,'coverage':coverage}
    import re
    ages=[int(m[1]) for part in parts.values() if (m:=re.search(r'max-age=(\d+)',part['headers'].get('cache-control',''),re.I))]
    return data,{'cache-control':'no-cache' if restrictive else 'public, max-age='+str(min(ages,default=store.policy(provider)[0]))}
