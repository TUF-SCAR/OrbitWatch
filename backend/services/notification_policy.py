"""Conservative eligibility, never an emergency warning or confidence score."""
from datetime import datetime,timedelta,timezone
from hashlib import sha256
import math
from zoneinfo import ZoneInfo
from urllib.parse import urlsplit
from services.account_inbox import utc
from services.natural_event_data import date
from services.visibility_forecast import match_forecast


def quiet(preferences,locations,now):
    if not preferences.quiet_hours_enabled:return False
    default=next((row for row in locations if row.is_default),None)
    zone=preferences.quiet_timezone if preferences.quiet_timezone_mode=='explicit' else default.timezone if default else None
    if not zone or not preferences.quiet_start or not preferences.quiet_end:return True
    try: current=now.astimezone(ZoneInfo(zone)).time().replace(tzinfo=None)
    except (ValueError,KeyError):return True
    a,b=preferences.quiet_start,preferences.quiet_end
    return a<=current<b if a<b else current>=a or current<b


def distance(lat1,lon1,lat2,lon2):
    a,b=math.radians(lat1),math.radians(lat2)
    value=math.sin((b-a)/2)**2+math.cos(a)*math.cos(b)*math.sin(math.radians(lon2-lon1)/2)**2
    return 6371.0088*2*math.asin(math.sqrt(min(1,max(0,value))))


def weather_allowed(dataset,moment,now):
    weather=match_forecast(dataset,moment,now)
    # Explicit forecast filter, not certainty: suppress >=80% cloud, >=70%
    # precipitation probability or >=0.2 mm hourly precipitation. Missing is labeled.
    allowed=weather['state']!='available' or (weather['cloud_cover_percent']<80 and weather['precipitation_probability_percent']<70 and weather['precipitation_mm']<.2)
    return allowed,weather


def astronomy_candidate(kind,identity,name,result,location,preferences,now,dataset=None):
    if result.get('state')!='available':return None
    for window in result['windows']:
        # A future start remains valid when only the END exceeds the short worker
        # horizon. A clipped/ongoing start is rejected by the future warning gate.
        if kind=='satellite':
            if not window.get('conditions_available') or not window.get('useful_segments'):continue
            moment=date(window['useful_segments'][0]['start_utc'])
        else: moment=date(window['start_utc'])
        if not moment:continue
        due=moment-timedelta(minutes=preferences.advance_warning_minutes)
        if not due<=now<min(moment,due+timedelta(minutes=10)):continue
        allowed,weather=weather_allowed(dataset,moment,now)
        if not allowed:continue
        local=moment.astimezone(ZoneInfo(location.timezone)).strftime('%d %b %H:%M %Z')
        conditions=f"Forecast cloud {weather['cloud_cover_percent']}%." if weather['state']=='available' else 'Weather forecast unavailable.'
        limitation='Brightness unverified; no naked-eye guarantee.' if kind=='satellite' else result.get('equipment','Visibility depends on conditions.')
        message=f"A screened viewing segment near {location.name} begins {local}. Maximum elevation {window['max_elevation_degrees']:.0f}°. {conditions} {limitation}"
        return {'kind':kind,'target_id':identity,'category':kind,'title':f'Potential {name} viewing opportunity'[:120],
                'message':message[:400],'opportunity_at':moment,'expires_at':moment,'source_at':date(result.get('element_epoch')) or date(result.get('computed_at')) or now,
                'key':f'{kind}:{identity}:{location.id}:{round(moment.timestamp()/120)}','severity':None,'source_url':None,
                'warning_minutes':preferences.advance_warning_minutes,
                'observer':(float(location.latitude),float(location.longitude),location.timezone,getattr(location,'version',None))}
    return None


def event_candidate(event,location,radius,now,previous_severity=None):
    provider=event.get('provider');geometry=event.get('geometry') or {}
    # Boundary vertices/centroids are NOT used to invent polygon proximity.
    if geometry.get('type')!='Point' or event.get('data_state')!='available':return None
    coordinates=geometry.get('coordinates',[])
    if len(coordinates)<2:return None
    reported=date(event.get('reported_at'));updated=date(event.get('updated_at'));retrieved=date(event.get('retrieved_at'))
    if not reported or not retrieved or not timedelta(0)<=now-reported<=timedelta(hours=24) or not timedelta(0)<=now-retrieved<=timedelta(hours=1):return None
    if updated and not -timedelta(minutes=5)<=now-updated<=timedelta(hours=24):return None
    km=distance(float(location.latitude),float(location.longitude),coordinates[1],coordinates[0])
    if km>radius:return None
    severity=None;version='new'
    if provider=='usgs':
        severity=next((m['value'] for m in event.get('measurements',[]) if m.get('label','').startswith('Magnitude')),None)
        if severity is None or severity<4:return None
        if previous_severity is not None:
            if severity-previous_severity<.5 or not updated:return None
            version=f'magnitude:{math.floor(severity*2)}'
    elif provider=='gdacs':
        severity={'green':1,'orange':2,'red':3}.get(str(event.get('status','')).lower(),0)
        if severity<2:return None
        if previous_severity is not None:
            if severity<=previous_severity or not updated:return None
            version=f'level:{int(severity)}'
    elif provider=='eonet':
        if event.get('closed_at') or event.get('status')!='open' or previous_severity is not None:return None
        severity=0  # Single recent curation report per identity, no automatic updates.
    else:return None
    identity=event['id']
    url=event.get('source_url') or ''
    parsed=urlsplit(url)
    host=parsed.hostname or ''
    if parsed.scheme!='https' or parsed.username or parsed.password or not any(host==domain or host.endswith('.'+domain) for domain in ('usgs.gov','nasa.gov','gdacs.org')):url=None
    return {'kind':'event','target_id':identity,'category':event['category'],'title':f"{provider.upper()} {event['category'].replace('_',' ')} report"[:120],
            'message':f"A {event['category'].replace('_',' ')} was reported by {provider.upper()} within your selected radius ({km:.0f} km from {location.name}). Source status: {event.get('status','unavailable')}. This is a source report, not a local emergency warning. OrbitWatch does not replace official emergency alert systems."[:400],
            'opportunity_at':reported,'expires_at':reported+timedelta(hours=24),'source_at':updated or reported,
            'key':f'event:{identity}:{version}','severity':severity,'source_url':url,'distance_km':km,
            'observer':(float(location.latitude),float(location.longitude),location.timezone,getattr(location,'version',None))}


def digest(candidate):return sha256(candidate['key'].encode()).hexdigest()
