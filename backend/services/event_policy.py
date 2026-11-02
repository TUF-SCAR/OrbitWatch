"""Fair display allocation and evidence of material source changes, not refetches."""
from collections import defaultdict,deque
from hashlib import sha256
import json
from services.natural_event_data import date,iso


def severity(event):
    if event.get('provider')=='usgs':
        return next((m.get('value') for m in event.get('measurements',[]) if m.get('label','').startswith('Magnitude')),None)
    if event.get('provider')=='gdacs':return {'green':1,'orange':2,'red':3}.get(str(event.get('episode_status') or event.get('status','')).lower())
    return None


def material_signature(event):
    return sha256(json.dumps([event.get('id'),event.get('source_episode_id'),severity(event),event.get('geometry')],sort_keys=True,separators=(',',':')).encode()).hexdigest()[:24]


def material_updates(events,previous):
    old={e['id']:e for e in previous or []};out=[]
    for event in events:
        prior=old.get(event['id']);record=None
        stamp=date(event.get('source_updated_at') or event.get('updated_at'))
        previous_stamp=date(prior.get('source_updated_at') or prior.get('updated_at')) if prior else None
        signature=material_signature(event)
        if prior and material_signature(prior)==signature:record=prior.get('material_update')
        elif prior and stamp and previous_stamp and stamp>previous_stamp:
            a,b=severity(prior),severity(event);kind=None
            if event['provider']=='usgs' and a is not None and b is not None and b-a>=.5:kind='significant_magnitude_increase'
            if event['provider']=='gdacs' and a is not None and b is not None and b>a:kind='official_alert_escalation'
            if kind:record={'at':iso(stamp),'kind':kind,'signature':signature,'previous_severity':a}
            elif event['provider']=='gdacs' and event.get('geometry',{}).get('type') in ('Polygon','MultiPolygon') and prior.get('geometry',{}).get('type') in ('Polygon','MultiPolygon') and event['geometry']!=prior['geometry']:
                record={'at':iso(stamp),'kind':'reported_boundary_change','signature':signature,'previous_geometry':prior['geometry']}
        out.append({**event,'material_update':record,'material_signature':signature})
    return out


def fair_events(events,limit=1200,provider_limit=400):
    groups=defaultdict(list)
    for event in events:groups[(event['provider'],event['category'])].append(event)
    buckets=[deque(sorted(group,key=lambda e:date(e.get('updated_at')) or date(e['reported_at']),reverse=True)) for _,group in sorted(groups.items())]
    counts=defaultdict(int);out=[]
    while len(out)<limit:
        progressed=False
        for bucket in buckets:
            if not bucket:continue
            provider=bucket[0]['provider']
            if counts[provider]>=provider_limit:continue
            out.append(bucket.popleft());counts[provider]+=1;progressed=True
            if len(out)>=limit:break
        if not progressed:break
    return out
