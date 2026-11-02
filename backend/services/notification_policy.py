"""Conservative eligibility, never an emergency warning or confidence score."""
from datetime import datetime,timedelta,timezone
from hashlib import sha256
import math
from zoneinfo import ZoneInfo
from urllib.parse import urlsplit
from services.account_inbox import utc
from services.natural_event_data import date
from services.visibility_forecast import match_forecast
from services.event_geometry import proximity
from services.event_policy import severity as event_severity


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
    if event.get('data_state')!='available':return None
    reported=date(event.get('reported_at'));updated=date(event.get('updated_at'));retrieved=date(event.get('retrieved_at'))
    validated=date(event.get('provider_validated_at')) or retrieved
    if not reported or not retrieved or not validated or reported>now or not timedelta(0)<=now-validated<=timedelta(hours=1):return None
    if updated and not -timedelta(minutes=5)<=now-updated<=timedelta(hours=24):return None
    km=proximity(geometry,float(location.latitude),float(location.longitude))
    if km is None or km>radius:return None
    severity=None;version='new';material=event.get('material_update') or {}
    material_at=date(material.get('at'))
    verified_update=bool(material_at and updated and material_at==updated and timedelta(0)<=now-material_at<=timedelta(hours=24))
    new_report=timedelta(0)<=now-reported<=timedelta(hours=24)
    if provider=='usgs':
        severity=event_severity(event)
        if not isinstance(severity,(int,float)) or isinstance(severity,bool) or not math.isfinite(severity) or not 4<=severity<=10:return None
        if previous_severity is not None:
            if severity-previous_severity<.5 or not updated:return None
            version=f'magnitude:{math.floor(severity*2)}'
        elif not new_report:
            if not verified_update or material.get('kind')!='significant_magnitude_increase':return None
            version='change:'+material['signature']
    elif provider=='gdacs':
        severity=event_severity(event)
        if severity is None or severity<2:return None
        area_change=False
        if verified_update and material.get('kind')=='reported_boundary_change':
            old_distance=proximity(material.get('previous_geometry') or {},float(location.latitude),float(location.longitude))
            area_change=old_distance is not None and old_distance>radius
        if previous_severity is not None:
            if area_change:version='area:'+material['signature']
            elif severity>previous_severity and updated:version=f'level:{int(severity)}'
            else:return None
        elif not new_report:
            if not verified_update or not(area_change or material.get('kind')=='official_alert_escalation'):return None
            version='change:'+material['signature']
    elif provider=='eonet':
        if not new_report or event.get('closed_at') or event.get('status')!='open' or previous_severity is not None:return None
        severity=0  # Single recent curation report per identity, no automatic updates.
    else:return None
    source_at=updated if version!='new' else reported
    if not source_at:return None
    identity=event['id']
    url=event.get('source_url') or ''
    parsed=urlsplit(url)
    host=parsed.hostname or ''
    if parsed.scheme!='https' or parsed.username or parsed.password or not any(host==domain or host.endswith('.'+domain) for domain in ('usgs.gov','nasa.gov','gdacs.org')):url=None
    return {'kind':'event','target_id':identity,'category':event['category'],'title':f"{provider.upper()} {event['category'].replace('_',' ')} report"[:120],
            'message':f"{'An updated' if version!='new' else 'A'} {provider.upper()} {event['category'].replace('_',' ')} report was issued near your saved observation area ({km:.0f} km). Source {'episode' if event.get('episode_status') else 'overall'} status: {event.get('episode_status') or event.get('status','unavailable')}. Proximity is to a reported point/boundary, not a danger radius or forecast impact. Consult official local authorities."[:400],
            'opportunity_at':source_at,'expires_at':source_at+timedelta(hours=24),'source_at':source_at,
            'key':f'event:{identity}:{version}','severity':severity,'source_url':url,'distance_km':km,
            'observer':(float(location.latitude),float(location.longitude),location.timezone,getattr(location,'version',None))}


def digest(candidate):return sha256(candidate['key'].encode()).hexdigest()
