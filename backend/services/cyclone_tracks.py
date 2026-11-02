"""Genuine supplied positions only. No motion extrapolation/name-only joining."""
import csv
from datetime import datetime,timezone,timedelta
from hashlib import sha256
import io
import re
from services.natural_event_data import date,iso,number,text,point,safe_url

IBTRACS_URL='https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.ACTIVE.list.v04r01.csv'
NHC_URL='https://www.nhc.noaa.gov/CurrentStorms.json'
NHC_GIS='https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer'
AGENCIES={'usa':(0,'USA',1),'tokyo':(1,'TOKYO',10),'cma':(2,'CMA',2),'hko':(3,'HKO',10),'kma':(4,'KMA',10),
          'newdelhi':(5,'NEWDELHI',3),'reunion':(6,'REUNION',10),'bom':(7,'BOM',10),'nadi':(8,'NADI',10),'wellington':(9,'WELLINGTON',10)}


def numeric(value,lo,hi):
    try:return number(float(value),lo,hi)
    except (ValueError,TypeError):return None


def eonet_track(event,now):
    observations=[];seen=set()
    for item in event.get('timeline') or []:
        if item['geometry']['type']!='Point' or date(item['at'])>now:continue
        if item['at'] in seen:continue
        seen.add(item['at']);lon,lat=item['geometry']['coordinates']
        observations.append(dict(at=item['at'],longitude=lon,latitude=lat,classification='reported_position',agency='EONET source curation',wind=None,wind_units=None,wind_averaging_minutes=None))
    if len(observations)<2:return None
    return dict(observed=observations[-256:],forecast=[],source='NASA EONET dated point reports',source_url=event['source_url'],
        official_id=event['provider_event_id'],latest_observation=observations[-1]['at'],issued_at=None,expires_at=None,
        note='Reported positions only. EONET is not a forecast service; curation may lag activity.')


def ibtracs_events(raw,retrieved_at,now=None):
    now=now or datetime.now(timezone.utc)
    if len(raw)>8_000_000:raise ValueError('IBTrACS active subset exceeds bound')
    reader=csv.DictReader(io.StringIO(raw.decode('utf-8-sig')))
    required={'SID','SEASON','BASIN','NAME','ISO_TIME','TRACK_TYPE','IFLAG','USA_ATCF_ID','USA_LAT','USA_LON'}
    if not required.issubset(reader.fieldnames or []):raise ValueError('Unexpected IBTrACS v4r01 columns')
    storms={};rejected=0
    for count,row in enumerate(reader):
        if count>10000:raise ValueError('IBTrACS row cap exceeded')
        row={k:v.strip() if isinstance(v,str) else v for k,v in row.items()}
        sid=row.get('SID','')
        if not re.fullmatch(r'\d{7}[NS]\d{5}',sid):continue  # Includes official units row.
        at=date(row.get('ISO_TIME'));kind=row.get('TRACK_TYPE')
        if not at or at>now or kind not in ('MAIN','PROVISIONAL','US-PROVISIONAL'):rejected+=1;continue
        agency=row.get('WMO_AGENCY','').lower()
        choices=[agency,'usa'] if agency!='usa' else ['usa']
        supplied=None
        for agency in choices:
            if agency not in AGENCIES:continue
            idx,prefix,averaging=AGENCIES[agency];flags=row.get('IFLAG','')
            flag=flags[idx] if len(flags)>idx else '_'
            # P positions are source interpolations, excluded from reported route.
            if flag not in ('O','I','V'):continue
            lat=numeric(row.get(prefix+'_LAT'),-90,90);lon=numeric(row.get(prefix+'_LON'),-180,180)
            if lat is None or lon is None:continue
            wind=numeric(row.get(prefix+'_WIND'),0,250) if flag in ('O','V') else None
            supplied=dict(at=iso(at),latitude=lat,longitude=lon,wind=wind,wind_units='kt' if wind is not None else None,
                wind_averaging_minutes=averaging if wind is not None else None,agency=row.get('USA_AGENCY') if agency=='usa' else agency,
                classification='best_track' if kind=='MAIN' else 'provisional',interpolation_flag=flag)
            break
        if supplied is None:rejected+=1;continue
        if sid not in storms:
            if len(storms)>=32:raise ValueError('IBTrACS storm cap exceeded')
            storms[sid]=dict(points={},name=text(row.get('NAME'),120) or sid,basin=text(row.get('BASIN'),3),season=row.get('SEASON'),atcf_ids=set())
        storm=storms[sid];storm['points'][supplied['at']]=supplied
        if len(storm['points'])>512:raise ValueError('IBTrACS point cap exceeded')
        atcf=row.get('USA_ATCF_ID','').upper()
        if re.fullmatch(r'(AL|EP|CP|WP|IO|SH)\d{6}',atcf):storm['atcf_ids'].add(atcf)
    events=[]
    for sid,storm in storms.items():
        points=sorted(storm['points'].values(),key=lambda p:p['at']);latest=points[-1]
        if date(latest['at'])<now-timedelta(days=14):continue
        track=dict(observed=points,forecast=[],official_id=sid,atcf_ids=sorted(storm['atcf_ids']),basin=storm['basin'],season=storm['season'],source='NOAA IBTrACS v4r01 ACTIVE',source_url=IBTRACS_URL,
            latest_observation=latest['at'],issued_at=None,expires_at=None,note='Batch-updated provisional/best-track agency positions; not a live storm locator. Interpolated positions/spurs excluded; wind averaging differs by agency.')
        events.append(dict(id='ibtracs:'+sid,provider='ibtracs',provider_event_id=sid,provider_event_type='TC',source_episode_id=None,episode_status=None,
            category='cyclone',title=f"{storm['name']} · {storm['basin']} {storm['season']}",status=latest['classification'],
            status_meaning='IBTrACS track classification, not an active emergency designation.',closed_at=None,
            started_at=points[0]['at'],reported_at=latest['at'],last_report_at=latest['at'],updated_at=None,source_updated_at=None,
            retrieved_at=retrieved_at,recent_activity_verified=now-date(latest['at'])<=timedelta(days=2),report_context='recent_report',
            geometry={'type':'Point','coordinates':[latest['longitude'],latest['latitude']]},position=[latest['longitude'],latest['latitude']],
            position_meaning='Latest supplied agency position in the batch archive; not real-time',measurements=[] if latest['wind'] is None else [dict(label='Reported sustained wind',value=latest['wind'],units='kt',description=f"{latest['agency']} · {latest['wind_averaging_minutes']}-minute average")],
            description=None,source_url='https://www.ncei.noaa.gov/products/international-best-track-archive',references=[],timeline=None,track=track,related_ids=[],size_km=None,danger_radius_km=None))
    return events,rejected


def nhc_time(value):
    parsed=date(value)
    if parsed:return parsed
    if isinstance(value,str):
        for pattern in ('%Y%m%d%H','%Y%m%d%H%M','%Y-%m-%d %H:%M:%S %Z','%H%M UTC %b %d %Y','%I%M %p %Z %a %b %d %Y'):
            try:return datetime.strptime(value,pattern).replace(tzinfo=timezone.utc)
            except ValueError:pass
    return None


def nhc_forecast(storm,collection,retrieved_at,now=None):
    now=now or datetime.now(timezone.utc);identity=str(storm.get('id','')).upper()
    if not re.fullmatch(r'(AL|EP|CP)\d{6}',identity):return None
    features=collection.get('features')
    if not isinstance(features,list) or len(features)>32 or collection.get('exceededTransferLimit'):raise ValueError('NHC forecast response exceeds bound')
    output=[];issued=None
    for f in features:
        p=f.get('attributes') or f.get('properties') or {}
        p={k.lower():v for k,v in p.items()};g=f.get('geometry') or {}
        coords=point(g.get('coordinates')) if g.get('type')=='Point' else point([g.get('x'),g.get('y')])
        stamp=nhc_time(p.get('validtime'));release=nhc_time(p.get('advdate')) or nhc_time(storm.get('lastUpdate'))
        if not coords or not stamp or not release or not timedelta(0)<=now-release<=timedelta(hours=12) or not release<=stamp<=release+timedelta(hours=126):continue
        # Identity must match the requested official bin and storm number/basin.
        if str(p.get('binnumber','')).upper()!=str(storm.get('binNumber','')).upper() or str(p.get('basin','')).upper()!=identity[:2] or numeric(p.get('stormnum'),1,99)!=int(identity[2:4]):continue
        if issued and issued!=release:raise ValueError('Mixed NHC advisory issue times')
        issued=release
        if stamp<=now:continue
        wind=numeric(p.get('maxwind'),0,250)
        output.append(dict(at=iso(stamp),latitude=coords[1],longitude=coords[0],issued_at=iso(release),
            wind=wind,wind_units='kt' if wind is not None else None,wind_averaging_minutes=1 if wind is not None else None,
            agency='NOAA NHC/CPHC',classification='forecast',product='NHC GIS forecast points',advisory=text(str(p.get('advisnum','')),40)))
    output=sorted({p['at']:p for p in output}.values(),key=lambda p:p['at'])
    if not output:return None
    return dict(official_id=identity,observed=[],forecast=output,source='NOAA NHC/CPHC official forecast points',source_url='https://www.nhc.noaa.gov/gis/',
        latest_observation=None,issued_at=iso(issued),expires_at=iso(issued+timedelta(hours=12)),note='Official forecast positions, not certain passage or an impact area; NHC/CPHC covered basins only.')


def nhc_event(storm,track,retrieved_at):
    # Forecast-only reports have no fabricated current marker/observed history.
    identity=track['official_id'];stamp=track['issued_at']
    return dict(id='nhc:'+identity,provider='nhc',provider_event_id=identity,provider_event_type='TC',source_episode_id=None,episode_status=None,
        category='cyclone',title=(text(storm.get('name'),120) or identity)+' · official NHC forecast',status='official_forecast',
        status_meaning='Official forecast advisory, not certain passage or an impact warning.',closed_at=None,
        started_at=stamp,reported_at=stamp,last_report_at=stamp,updated_at=stamp,source_updated_at=stamp,
        retrieved_at=retrieved_at,recent_activity_verified=False,recent_report_available=True,report_context='recent_report',
        geometry=None,position=None,position_meaning='Forecast-only source report; no verified observed/current anchor supplied by this product',
        measurements=[],description=None,source_url=track['source_url'],references=[],timeline=None,track=track,related_ids=[],size_km=None,danger_radius_km=None)


def attach_forecasts(events,forecasts,now=None):
    now=now or datetime.now(timezone.utc);out=[];used=set()
    for event in events:
        track=event.get('track')
        if track:
            matches=[f for f in forecasts if f['official_id'] in track.get('atcf_ids',[]) and date(f['expires_at'])>now
                and sum(f['official_id'] in (other.get('track') or {}).get('atcf_ids',[]) for other in events)==1]
            if len(matches)==1:
                f=matches[0];used.add(f['official_id']);track={**track,'forecast':f['forecast'],'issued_at':f['issued_at'],'expires_at':f['expires_at'],'forecast_source':f['source'],'forecast_source_url':f['source_url']}
                event={**event,'track':track}
        out.append(event)
    # Unmatched forecast records are never guessed onto a named nearby storm.
    # Keep them explicit in source status rather than inventing an observed anchor.
    out=[e for e in out if not(e['provider']=='nhc' and e['provider_event_id'] in used)]
    return out,sorted(f['official_id'] for f in forecasts if f['official_id'] not in used)
