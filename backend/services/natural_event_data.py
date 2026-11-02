"""Untrusted official feed normalization. No network or database writes here."""
from datetime import datetime, timezone, timedelta
from html import unescape
import ipaddress
import math
import re
from urllib.parse import urlsplit

CATEGORIES = {'wildfires':'wildfire','severeStorms':'storm','volcanoes':'volcano','floods':'flood',
              'earthquakes':'earthquake','landslides':'landslide','drought':'drought','dustHaze':'dust',
              'snow':'snow_ice','seaLakeIce':'snow_ice','tempExtremes':'temperature_extreme',
              'waterColor':'water_color',
              'TC':'cyclone','EQ':'earthquake','FL':'flood','VO':'volcano','DR':'drought','WF':'wildfire'}
PROVIDER_URLS={'eonet':'https://eonet.gsfc.nasa.gov/','gdacs':'https://www.gdacs.org/','usgs':'https://earthquake.usgs.gov/'}
FUTURE_TOLERANCE=timedelta(minutes=5)


def text(value,limit=1000):
    if not isinstance(value,str):return None
    return re.sub(r'\s+',' ',re.sub(r'<[^>]*>','',unescape(value)))[:limit].strip() or None


def safe_url(value):
    if not isinstance(value,str) or len(value)>1500:return None
    try:
        u=urlsplit(value)
        if u.scheme not in {'https','http'} or not u.hostname or u.username or u.password or u.port not in {None,80,443}:return None
        if any(ord(c)<33 for c in value) or u.hostname.lower() in {'localhost','localhost.localdomain'} or '.' not in u.hostname:return None
        try:
            if not ipaddress.ip_address(u.hostname).is_global:return None
        except ValueError:pass
        return value
    except (ValueError,TypeError):return None


def official_url(provider,value):
    value=safe_url(value)
    if not value:return None
    host=urlsplit(value).hostname.lower();domain={'eonet':'nasa.gov','gdacs':'gdacs.org','usgs':'usgs.gov'}[provider]
    return value if host==domain or host.endswith('.'+domain) else None


def date(value):
    try:
        if isinstance(value,(int,float)) and not isinstance(value,bool):
            d=datetime.fromtimestamp(value/1000,timezone.utc)
        elif isinstance(value,str):
            d=datetime.fromisoformat(value.replace('Z','+00:00'))
            if d.tzinfo is None:d=d.replace(tzinfo=timezone.utc) # GDACS ISO dates are UTC without an offset
        else:return None
        return d.astimezone(timezone.utc)
    except (ValueError,OverflowError,OSError):return None


def iso(d):return d.isoformat().replace('+00:00','Z') if d else None
def number(value,low=-1e9,high=1e9):
    return float(value) if isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value) and low<=value<=high else None


def point(value):
    if not isinstance(value,list) or len(value)<2:return None
    lon,lat=number(value[0],-180,180),number(value[1],-90,90)
    return [lon,lat] if lon is not None and lat is not None else None


def geometry(g):
    if not isinstance(g,dict):return None
    kind=g.get('type');coordinates=g.get('coordinates')
    if kind=='Point':
        p=point(coordinates);return {'type':'Point','coordinates':p} if p else None
    if kind not in {'Polygon','MultiPolygon'} or not isinstance(coordinates,list):return None
    polygons=[coordinates] if kind=='Polygon' else coordinates
    if not polygons or len(polygons)>32:return None
    total=0;out=[]
    for polygon in polygons:
        if not isinstance(polygon,list) or not polygon or len(polygon)>32:return None
        rings=[]
        for ring in polygon:
            if not isinstance(ring,list) or len(ring)<4:return None
            total+=len(ring)
            if total>2048:return None
            points=[point(p) for p in ring]
            if any(p is None for p in points) or points[0]!=points[-1]:return None
            rings.append(points)
        out.append(rings)
    return {'type':kind,'coordinates':out[0] if kind=='Polygon' else out}


def anchor(g):
    if g['type']=='Point':return g['coordinates']
    return None  # A boundary is not evidence of a precise incident centre.


def normalize(provider,data,retrieved_at,now=None):
    now=now or datetime.now(timezone.utc)
    items=data.get('events' if provider=='eonet' else 'features') if isinstance(data,dict) else None
    if not isinstance(items,list) or len(items)>5000:raise ValueError('Invalid event collection')
    events={};rejected=0
    if len(items)>5000:raise ValueError('Collection exceeds normalized input bound')
    for row in items:
        try:
            e=normalize_one(provider,row,retrieved_at,now)
            if not e:rejected+=1;continue
            previous=events.get(e['id'])
            if not previous or (date(previous.get('updated_at')) or date(previous['reported_at']))<(date(e.get('updated_at')) or date(e['reported_at'])):events[e['id']]=e
        except (TypeError,ValueError,KeyError,IndexError,AttributeError):rejected+=1
    return sorted(events.values(),key=lambda e:date(e.get('updated_at')) or date(e['reported_at']),reverse=True),rejected


def normalize_one(provider,row,retrieved_at,now):
    if not isinstance(row,dict):return None
    measurements=[];timeline=[];references=[];closed=None;updated=None;started=None;ended=None
    retrieved_at=row.get('_orbitwatch_retrieved_at') or retrieved_at
    if provider=='eonet':
        ident=text(row.get('id'),100)
        if not ident or not re.fullmatch(r'[A-Za-z0-9_-]+',ident):return None
        categories=[CATEGORIES.get(c.get('id')) for c in row.get('categories',[]) if isinstance(c,dict)]
        if not any(categories):return None
        # EONET's severeStorms category includes cyclones and other storms.
        category=next((c for c in categories if c),'other');title=text(row.get('title'),240)
        if category=='storm' and title and re.search(r'\b(hurricane|typhoon|tropical (cyclone|storm))\b',title,re.I):category='cyclone'
        for item in row.get('geometry',[])[:512]:
            if not isinstance(item,dict):continue
            d=date(item.get('date'));g=geometry(item)
            if d and g and d<=now+FUTURE_TOLERANCE:timeline.append({'at':iso(d),'geometry':g,'value':number(item.get('magnitudeValue')),'units':text(item.get('magnitudeUnit'),50)})
        if not timeline:return None
        timeline.sort(key=lambda t:date(t['at']));last=timeline[-1];g=last['geometry'];reported=date(last['at'])
        started=date(timeline[0]['at'])
        if last['value'] is not None:measurements.append({'label':'Source magnitude','value':last['value'],'units':last['units']})
        closed=iso(date(row.get('closed')));status='closed' if row.get('closed') else 'open'
        meaning='EONET curation status; open does not imply an active threat or emergency warning.'
        description=text(row.get('description'));url=safe_url(row.get('link'))
        for source in row.get('sources',[])[:20]:
            if isinstance(source,dict) and safe_url(source.get('url')):references.append({'provider':text(source.get('id'),80),'url':safe_url(source['url'])})
    else:
        p=row.get('properties',{});g=geometry(row.get('geometry'))
        if not g:return None
        if provider=='usgs':
            if p.get('type')!='earthquake':return None
            ident=text(row.get('id'),100);category='earthquake';title=text(p.get('title') or p.get('place'),240)
            reported=date(p.get('time'));updated=iso(date(p.get('updated')));status=text(p.get('status'),80)
            started=reported
            meaning='USGS review status, not an emergency alert. Magnitude and location may be revised.'
            coordinates=row.get('geometry',{}).get('coordinates',[])
            mag=number(p.get('mag'),-3,10);depth=number(coordinates[2],-10,1000) if len(coordinates)>2 else None
            if mag is not None:measurements.append({'label':f"Magnitude ({text(p.get('magType'),20) or 'type unavailable'})",'value':mag,'units':None})
            if depth is not None:measurements.append({'label':'Hypocentral depth','value':depth,'units':'km'})
            description=text(p.get('place'));url=safe_url(p.get('url'))
        else:
            event_type=text(p.get('eventtype'),4)
            if event_type not in {'TC','EQ','FL','VO','DR','WF'}:return None
            source_id=str(p.get('eventid'))
            if not re.fullmatch(r'[0-9]{1,20}',source_id) or int(source_id)<=0:return None
            ident=f"{event_type}:{source_id}";category=CATEGORIES[event_type];title=text(p.get('name'),240)
            started=date(p.get('fromdate'));ended=date(p.get('todate'));updated=iso(date(p.get('datemodified')));status=text(p.get('alertlevel'),80)
            # GDACS end dates may describe a forecast period, not a new report.
            reported=ended if ended and ended<=now+FUTURE_TOLERANCE else date(updated) or started
            meaning='GDACS overall humanitarian-impact alert level; not a local warning. Latest episode may differ.'
            description=text(p.get('htmldescription') or p.get('description'));url=safe_url(p.get('url',{}).get('report'))
            severity=p.get('severitydata') or {};value=number(severity.get('severity'));unit=text(severity.get('severityunit'),40)
            # GDACS uses zero with an empty unit for unavailable flood/volcano
            # intensity. It is a placeholder, not a measured zero magnitude.
            if value is not None and unit:measurements.append({'label':'Source severity','value':value,'units':unit,'description':text(severity.get('severitytext'),240)})
        if not ident or not re.fullmatch(r'[A-Za-z0-9_:-]+',ident):return None
    if not title or not reported or reported>now+FUTURE_TOLERANCE:return None
    freshness=date(updated) or reported
    if freshness>now+FUTURE_TOLERANCE:return None
    # Source-specific retention: open EONET curation can span years. It is NOT
    # evidence that the physical hazard remains active. GDACS retains a bounded
    # six-month report/update window; USGS uses its official month feed.
    if provider=='eonet' and status=='closed' and (date(closed) or reported)<now-timedelta(days=30):return None
    if provider=='gdacs' and freshness<now-timedelta(days=185):return None
    if provider=='usgs' and freshness<now-timedelta(days=32):return None
    position=anchor(g)
    event={'id':f'{provider}:{ident}','provider':provider,'provider_event_id':ident.split(':')[-1] if provider=='gdacs' else ident,
            'provider_event_type':p.get('eventtype') if provider=='gdacs' else None,
            'source_episode_id':text(str(p.get('episodeid')),40) if provider=='gdacs' and p.get('episodeid') is not None else None,
            'episode_status':text(p.get('episodealertlevel'),80) if provider=='gdacs' else None,'category':category,
            'title':title,'status':status,'status_meaning':meaning,'closed_at':closed,
            'reported_at':iso(reported),'updated_at':updated,'retrieved_at':retrieved_at,
            'started_at':iso(started or reported),'last_report_at':iso(reported),'source_updated_at':updated,
            'source_end_at':iso(ended),'recent_activity_verified':False,'recent_report_available':now-reported<=timedelta(days=7),
            'report_context':'older_source_monitored' if reported<now-timedelta(days=30) else 'recent_report',
            'geometry':g,'position':position,'position_meaning':('GDACS reported centroid; not a verified eye' if provider=='gdacs' and category=='cyclone' else 'reported location') if g['type']=='Point' else 'source-reported boundary; no verified incident centre',
            'measurements':measurements,'description':description,'source_url':official_url(provider,url) or PROVIDER_URLS[provider],
            'references':references,'timeline':timeline[-128:] or None,'track':None,
            'size_km':None,'danger_radius_km':None}
    if category=='cyclone' and provider=='eonet':
        from services.cyclone_tracks import eonet_track
        event['track']=eonet_track(event,now)
    return event


def cross_references(events):
    # Only exact official report URLs establish a relation. No proximity/name
    # merging: separate providers can legitimately report nearby distinct events.
    by_url={e['source_url']:e['id'] for e in events if urlsplit(e['source_url']).path.strip('/')}
    return [{**e,'related_ids':sorted({by_url[r['url']] for r in e['references'] if r['url'] in by_url and by_url[r['url']]!=e['id']})} for e in events]
