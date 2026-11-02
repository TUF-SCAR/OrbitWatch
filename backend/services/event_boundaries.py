"""One explicit selected GDACS geometry request, sharing its normal quota/lease."""
from datetime import datetime,timezone
import json
import re
import time
import httpx
from services.natural_event_data import geometry,iso
from services.weather_cache import WeatherDeferred


def boundary_key(event):return 'boundary:'+event['id']+':'+str(event.get('source_episode_id') or '0')


def selected_boundary(event,store,allow_fetch=True):
    key=boundary_key(event);cached=store.get(key)
    if cached and time.time()-cached['validated_at']<cached.get('max_age_seconds',3600):return cached
    if not allow_fetch:raise WeatherDeferred()
    if event['provider']!='gdacs':raise ValueError('Only documented GDACS geometry enrichment supported')
    with store.lease() as owned:
        if not owned:raise WeatherDeferred()
        store.reserve('gdacs');store.record('gdacs','downloading')
        try:
            params={'eventtype':event['provider_event_type'],'eventid':int(event['provider_event_id'])}
            if event.get('source_episode_id'):params['episodeid']=int(event['source_episode_id'])
            with httpx.Client(timeout=httpx.Timeout(20,connect=5),follow_redirects=False) as client:
                with client.stream('GET','https://www.gdacs.org/gdacsapi/api/Polygons/getgeometry',params=params) as response:
                    response.raise_for_status()
                    control=response.headers.get('cache-control','').lower()
                    if 'no-store' in control:raise ValueError('Source forbids persistent geometry caching')
                    match=re.search(r'max-age=(\d+)',control)
                    max_age=0 if 'no-cache' in control else min(3600,int(match[1])) if match else 3600
                    raw=bytearray();started=time.monotonic()
                    for chunk in response.iter_bytes():
                        raw.extend(chunk)
                        if len(raw)>2_000_000 or time.monotonic()-started>25:raise ValueError('Geometry response exceeds bound')
                    data=json.loads(raw)
            features=data.get('features',[]) if isinstance(data,dict) else []
            if isinstance(data,dict) and data.get('type') in ('Polygon','MultiPolygon','GeometryCollection'):features=[{'geometry':data}]
            if not isinstance(features,list) or len(features)>64:raise ValueError('Geometry collection exceeds bound')
            boundaries=[];nodes=0
            pending=[feature.get('geometry') for feature in features if isinstance(feature,dict)];visited=0
            while pending:
                raw_geometry=pending.pop();visited+=1
                if visited>128:raise ValueError('Nested geometry cap exceeded')
                if isinstance(raw_geometry,dict) and raw_geometry.get('type')=='GeometryCollection':
                    children=raw_geometry.get('geometries',[])
                    if not isinstance(children,list) or len(children)>64:raise ValueError('Invalid geometry collection')
                    pending.extend(children);continue
                g=geometry(raw_geometry)
                if not g or g['type'] not in ('Polygon','MultiPolygon'):continue
                polygons=[g['coordinates']] if g['type']=='Polygon' else g['coordinates']
                nodes+=sum(len(ring) for polygon in polygons for ring in polygon)
                if nodes>4096 or len(boundaries)>=16:raise ValueError('Geometry node cap exceeded')
                boundaries.append(g)
            value={'event_id':event['id'],'boundaries':boundaries,'validated_at':time.time(),'max_age_seconds':max_age,'retrieved_at':iso(datetime.now(timezone.utc)),
                'meaning':'Official source boundaries. Geometry role may include forecast/impact products; no verified current danger area or notification proximity is inferred.'}
            store.put(key,'boundary',value)
            with store.db() as db:db.execute("DELETE FROM data WHERE kind='boundary' AND key NOT IN (SELECT key FROM data WHERE kind='boundary' ORDER BY retrieved DESC LIMIT 16)")
            store.succeeded('gdacs');return value
        except Exception as error:store.failed('gdacs',error);raise WeatherDeferred() from None
