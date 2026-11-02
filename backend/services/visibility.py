"""On-demand bounded Skyfield/SGP4 previews. No provider orbital fetches or DB writes.

Screening: 10 degree satellite horizon reduces low-horizon extinction/obstructions;
Sun <= -6 degrees is civil twilight, not a naked-eye guarantee. Celestial useful
segments require altitude >=10 degrees (Moon Sun<=0, others Sun<=-6). No refraction
or terrain model. Samples bound useful-segment timing, not physical confidence.
"""
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from functools import lru_cache
import hashlib
import threading
from zoneinfo import ZoneInfo
import numpy as np
from skyfield.api import EarthSatellite, load, load_file, wgs84
from skyfield import almanac
from services.visibility_forecast import match_forecast

TS=load.timescale(builtin=True)
SATELLITE_MIN_ALT=10.0
MAX_ELEMENT_AGE_DAYS=7
MAX_WINDOWS=8
CACHE=OrderedDict()
LOCK=threading.Lock()
COMPUTE=threading.BoundedSemaphore(2)


@lru_cache(maxsize=1)
def ephemeris():
    # Pinned installed data only. Never calls load(url) or downloads at startup.
    try:
        from importlib.metadata import version
        from pathlib import Path
        if version('skyfield-data')!='7.0.0': return None
        from importlib.util import find_spec
        path=Path(find_spec('skyfield_data').origin).parent/'data'/'de421.bsp'
        if not path.is_file(): return None
        if hashlib.sha256(path.read_bytes()).hexdigest()!='a20a7139da04cbc462454634918e9a9ca69127044e2cc9d4f9c16e238d2deedc': return None
        return load_file(str(path))
    except (ImportError, OSError, ValueError):
        return None


def utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def local(moment, location):
    return utc(moment).astimezone(ZoneInfo(location['timezone'])).isoformat()


def stamp(moment): return utc(moment).isoformat()


def groups(mask):
    indexes=np.flatnonzero(mask)
    return np.split(indexes,np.where(np.diff(indexes)>1)[0]+1) if len(indexes) else []


def satellite_windows(record, location, start, hours, eph):
    epoch=utc(record.epoch)
    result={'windows':[],'element_epoch':stamp(epoch),'element_age_days':round((start-epoch).total_seconds()/86400,3),
            'source':f'Skyfield 1.55 / SGP4; current elements: {record.source}',
            'brightness':'Unverified; geometry cannot guarantee naked-eye visibility'}
    if not -1 <= result['element_age_days'] <= MAX_ELEMENT_AGE_DAYS:
        return {**result,'state':'unavailable','reason':'Orbital elements stale or epoch invalid (maximum seven days)'}
    sat=EarthSatellite(record.tle_line1,record.tle_line2,record.object_name,TS)
    if str(sat.model.satnum)!=str(record.norad_id): raise ValueError('TLE identity mismatch')
    tle_epoch=sat.epoch.utc_datetime()
    if abs((tle_epoch-epoch).total_seconds())>120: raise ValueError('TLE epoch mismatch')
    observer=wgs84.latlon(location['latitude'],location['longitude'])
    end=start+timedelta(hours=hours); t0,t1=TS.from_datetimes([start,end])
    initial=sat.at(t0)
    if initial.message or not np.all(np.isfinite(initial.position.km)): raise ValueError('Invalid trajectory')
    times,events=sat.find_events(observer,t0,t1,altitude_degrees=SATELLITE_MIN_ALT)
    # Rise/set group passes; multiple culminations remain in the same pass.
    active=start if (sat-observer).at(t0).altaz()[0].degrees>=SATELLITE_MIN_ALT else None
    spans=[]
    for moment,event in zip(times.utc_datetime(),events):
        if event==0: active=moment
        elif event==2 and active is not None:
            spans.append((active,moment)); active=None
    if active is not None: spans.append((active,end))
    for begin,finish in spans[:MAX_WINDOWS]:
        # At most 241 samples/pass, including exact culminations for maximum elevation.
        dates=[begin+(finish-begin)*i/240 for i in range(241)]
        dates+= [m for m,e in zip(times.utc_datetime(),events) if e==1 and begin<=m<=finish]
        dates=sorted(set(dates)); t=TS.from_datetimes(dates)
        position=sat.at(t)
        if any(message for message in np.atleast_1d(position.message)): raise ValueError('SGP4 failed')
        alt,az,_=(sat-observer).at(t).altaz()
        if not np.all(np.isfinite(alt.degrees)): raise ValueError('Invalid trajectory')
        peak=int(np.argmax(alt.degrees)); useful=[]; status='Geometric pass; brightness unverified'
        sun_alt=None; sunlit=None
        if eph is not None:
            sun_alt=(eph['earth']+observer).at(t).observe(eph['sun']).apparent().altaz()[0].degrees
            sunlit=position.is_sunlit(eph)
            mask=(sun_alt<=-6)&sunlit&(alt.degrees>=SATELLITE_MIN_ALT)
            for group in groups(mask):
                if len(group)>1: useful.append({'start_utc':stamp(dates[int(group[0])]),'end_utc':stamp(dates[int(group[-1])])})
            status='Potentially observable; brightness unverified' if useful else ('Daylight / difficult viewing conditions' if np.all(sun_alt>-6) else 'Eclipsed / not sunlit during dark segment')
        row={'start_utc':stamp(begin),'end_utc':stamp(finish),'start_local':local(begin,location),'end_local':local(finish,location),
             'duration_seconds':round((finish-begin).total_seconds()),'max_elevation_degrees':round(float(alt.degrees[peak]),2),
             'maximum_at_utc':stamp(dates[peak]),'azimuth_degrees':round(float(az.degrees[peak]),1),
             'sun_altitude_degrees':round(float(sun_alt[peak]),2) if sun_alt is not None else None,
             'sunlit_at_maximum':bool(sunlit[peak]) if sunlit is not None else None,
             'useful_segments':useful[:8],'status':status,'conditions_available':eph is not None,
             'segment_precision_seconds':round((finish-begin).total_seconds()/240,1),
             'window_clipped':begin==start or finish==end}
        result['windows'].append(row)
    return {**result,'state':'available','reason':None if spans else 'No pass above 10° in this forecast window'}


def celestial_windows(target, location, start, hours, eph):
    if eph is None: return {'state':'unavailable','reason':'Pinned local DE421 ephemeris unavailable','windows':[]}
    observer=wgs84.latlon(location['latitude'],location['longitude'])
    earth_observer=eph['earth']+observer
    body=eph['moon' if target=='moon' else target+' barycenter']
    # Two-minute samples; bounded 1,441 samples for 48 hours, no precision claim.
    dates=[start+timedelta(seconds=i*120) for i in range(hours*30+1)]
    t=TS.from_datetimes(dates)
    apparent=earth_observer.at(t).observe(body).apparent()
    alt,az,_=apparent.altaz()
    sun=earth_observer.at(t).observe(eph['sun']).apparent().altaz()[0].degrees
    mask=(alt.degrees>=10)&(sun<=(0 if target=='moon' else -6))
    windows=[]
    for group in groups(mask)[:MAX_WINDOWS]:
        if len(group)<2: continue
        a,b=int(group[0]),int(group[-1]); peak=int(group[np.argmax(alt.degrees[group])])
        windows.append({'start_utc':stamp(dates[a]),'end_utc':stamp(dates[b]),'start_local':local(dates[a],location),'end_local':local(dates[b],location),
                        'maximum_at_utc':stamp(dates[peak]),'max_elevation_degrees':round(float(alt.degrees[peak]),2),
                        'azimuth_degrees':round(float(az.degrees[peak]),1),'sun_altitude_degrees':round(float(sun[peak]),2),
                        'status':'Astronomical viewing window; weather and local horizon apply','segment_precision_seconds':120,
                        'window_clipped':a==0 or b==len(dates)-1})
    f=almanac.risings_and_settings(eph,body,observer,horizon_degrees=0)
    transitions,states=almanac.find_discrete(TS.from_datetime(start),TS.from_datetime(start+timedelta(hours=hours)),f)
    ra,dec,_=apparent[0].radec()
    return {'state':'available','windows':windows,'reason':None if windows else 'No useful dark-sky window above 10° in this horizon',
            'rise_set':[{'event':'rise' if state else 'set','utc':stamp(moment),'local':local(moment,location)} for moment,state in zip(transitions.utc_datetime(),states)][:8],
            'altitude_now_degrees':round(float(alt.degrees[0]),2),'azimuth_now_degrees':round(float(az.degrees[0]),2),
            'ra_hours':float(ra.hours),'declination_degrees':float(dec.degrees),
            'moon_illumination_percent':round(float(almanac.fraction_illuminated(eph,'moon',t[0]))*100,1) if target=='moon' else None,
            'equipment':'Telescope generally required; no naked-eye guarantee' if target in ('uranus','neptune') else 'Visibility depends on brightness, twilight and local horizon',
            'source':'JPL DE421 / Skyfield 1.55; topocentric apparent, unrefracted; two-minute screening'}


def prediction(kind, target, record, location, start, hours, dataset):
    # Five-minute time bucket. Exact observer coordinates and epoch/TLE invalidate cache.
    bucket=start.replace(minute=start.minute//5*5,second=0,microsecond=0)
    key=(kind,target,location['latitude'],location['longitude'],location['timezone'],stamp(bucket),hours,
         (stamp(record.epoch),hashlib.sha256((record.tle_line1+record.tle_line2).encode()).hexdigest()) if record else None)
    with LOCK:
        cached=CACHE.get(key)
        if cached: CACHE.move_to_end(key)
    if cached is None:
        eph=ephemeris()
        try:
            if kind=='satellite':
                value=satellite_windows(record,location,bucket,hours,eph) if record else {'state':'unavailable','windows':[],'reason':'Current orbital elements missing; no historical fallback'}
            else: value=celestial_windows(target,location,bucket,hours,eph)
        except (ValueError, KeyError, OverflowError, ArithmeticError):
            value={'state':'unavailable','windows':[],'reason':'Scientific propagation unavailable for this source/window'}
        cached={**value,'computed_at':stamp(start)}
        with LOCK:
            CACHE[key]=cached
            while len(CACHE)>256: CACHE.popitem(last=False)
    result={**cached,'target_id':target,'windows':[]}
    for window in cached['windows']:
        if datetime.fromisoformat(window['end_utc'])<=start: continue
        useful=window.get('useful_segments',[])
        moment=datetime.fromisoformat(useful[0]['start_utc'] if useful else window['maximum_at_utc'])
        result['windows'].append({**window,'weather':match_forecast(dataset,moment)})
    return result
