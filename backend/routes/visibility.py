from datetime import datetime, timezone
import time
from typing import Literal
from uuid import UUID
from types import SimpleNamespace
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session
from core.database import get_database_session,database_engine
from core.security import get_current_user
from models.user import User
from models.account import ObservationLocation
from models.alerts import AlertSubscription
from models.satellite_orbital_data import SatelliteOrbitalData
from routes.account import account_storage, owned_location
from services.account_targets import target_name
from services.visibility import COMPUTE, prediction
from services.visibility_forecast import forecast, match_forecast
from services.viewing_plans import shared_prediction
from services.account_targets import SATELLITES,CELESTIAL
from services.viewing_score import assessment

router=APIRouter(prefix='/api/account/visibility',tags=['Visibility previews'])


@router.get('/{collection}')
def preview(collection:Literal['satellites','celestial'],response:Response,location_id:UUID|None=None,
            hours:int=Query(24,ge=1,le=48),target_id:str|None=Query(None,max_length=12),
            user:User=Depends(get_current_user),database:Session=Depends(get_database_session)):
    response.headers['Cache-Control']='no-store'
    kind='satellite' if collection=='satellites' else 'celestial'
    with account_storage(database):
        location=owned_location(database,user.id,location_id) if location_id else database.scalar(
            select(ObservationLocation).where(ObservationLocation.owner_id==user.id).order_by(ObservationLocation.is_default.desc(),ObservationLocation.slot).limit(1))
        if location is None: raise HTTPException(409,'Save an observation location to preview visibility')
        if target_id is not None and not target_name(kind,target_id): raise HTTPException(422,'Invalid observation target')
        rows=list(database.scalars(select(AlertSubscription).where(AlertSubscription.owner_id==user.id,AlertSubscription.kind==kind).order_by(AlertSubscription.slot).limit(20 if kind=='satellite' else 8)))
        if target_id:
            rows=[row for row in rows if row.target_id==target_id]
            if not rows: raise HTTPException(404,'Follow this target before requesting a preview')
        loc={'id':location.id,'name':location.name,'latitude':float(location.latitude),'longitude':float(location.longitude),'timezone':location.timezone}
        identities=[row.target_id for row in rows]
        records={str(row.norad_id):row for row in database.scalars(select(SatelliteOrbitalData).where(SatelliteOrbitalData.norad_id.in_([int(i) for i in identities])))} if kind=='satellite' and identities else {}
        records={key:SimpleNamespace(**{name:getattr(row,name) for name in ('norad_id','epoch','tle_line1','tle_line2','object_name','source')}) for key,row in records.items()}
        names={row.target_id:row.target_name for row in rows}
    # Release DB transaction before CPU/network. No writes or historical queries.
    database.rollback()
    now=datetime.now(timezone.utc); results=[]
    if not COMPUTE.acquire(blocking=False): raise HTTPException(429,'Prediction workers busy; retry shortly',headers={'Retry-After':'10'})
    try:
        started=time.monotonic()
        for identity in identities:
            if time.monotonic()-started>6:
                results.append({'target_id':identity,'target_name':names[identity],'state':'unavailable','reason':'Computation budget reached; request this target separately','windows':[]})
                continue
            results.append({**shared_prediction(database_engine,kind,identity,records.get(identity),loc,now,hours),'target_name':names[identity]})
        # Do not spend a weather call on missing/stale or windowless astronomy.
        dataset=forecast(loc['latitude'],loc['longitude']) if any(item['windows'] for item in results) else None
        for item in results:
            for window in item['windows']:
                useful=window.get('useful_segments',[])
                moment=datetime.fromisoformat(useful[0]['start_utc'] if useful else window['maximum_at_utc'])
                window['weather']=match_forecast(dataset,moment)
                segment=useful[0] if useful else window
                window['assessment']=assessment(kind,item['target_id'],{'altitude_degrees':segment.get('max_elevation_degrees'),'azimuth_degrees':segment.get('start_azimuth_degrees',segment.get('azimuth_degrees')),'sun_altitude_degrees':segment.get('sun_altitude_degrees'),'sunlit':segment.get('sunlit',window.get('sunlit_at_maximum'))},window['weather'])
    finally: COMPUTE.release()
    return {'location':loc,'generated_at':now.isoformat(),'horizon_hours':hours,'items':results,
            'preview_only':True,'screening':{'minimum_altitude_degrees':10,'satellite_sun_altitude_max_degrees':-6,'maximum_element_age_days':7},
            'limitations':'No brightness guarantee, terrain or atmospheric refraction model. Forecast is separate from geometry. Alerts require enabled preferences and a healthy background worker.'}


@router.get('/targets/{collection}')
def targets(collection:Literal['satellites','celestial'],response:Response,offset:int=Query(0,ge=0,le=256),
            user:User=Depends(get_current_user),database:Session=Depends(get_database_session)):
    """Paginated planning, shared cache; no full catalogue work per UI render."""
    response.headers['Cache-Control']='private, no-store'
    kind='satellite' if collection=='satellites' else 'celestial';horizon=48 if kind=='satellite' else 168
    with account_storage(database):
        locations=[{key:getattr(row,key) for key in ('id','name','latitude','longitude','timezone')} for row in database.scalars(select(ObservationLocation).where(ObservationLocation.owner_id==user.id).order_by(ObservationLocation.is_default.desc(),ObservationLocation.slot))]
        catalog=sorted(SATELLITES if kind=='satellite' else CELESTIAL)
        selected=catalog[offset:offset+4]
        records={str(row.norad_id):SimpleNamespace(**{key:getattr(row,key) for key in ('norad_id','epoch','tle_line1','tle_line2','object_name','source')}) for row in database.scalars(select(SatelliteOrbitalData).where(SatelliteOrbitalData.norad_id.in_([int(id) for id in selected])))} if kind=='satellite' else {}
    database.rollback();items=[];now=datetime.now(timezone.utc)
    if not COMPUTE.acquire(blocking=False):raise HTTPException(429,'Planning busy; retry shortly',headers={'Retry-After':'10'})
    try:
        started=time.monotonic()
        for identity in selected:
            matches=[];unknown=False;searched=0;sample_score=None
            for location in locations:
                if time.monotonic()-started>8:unknown=True;break
                loc={**location,'latitude':float(location['latitude']),'longitude':float(location['longitude'])}
                result=shared_prediction(database_engine,kind,identity,records.get(identity),loc,now,horizon);searched+=1
                if result.get('state')!='available':unknown=True;continue
                windows=[window for window in result['windows'] if window.get('useful_segments') or kind=='celestial']
                if windows:
                    window=windows[0];segment=(window.get('useful_segments') or [window])[0]
                    sample_score=assessment(kind,identity,{'altitude_degrees':segment.get('max_elevation_degrees'),'sun_altitude_degrees':segment.get('sun_altitude_degrees'),'sunlit':segment.get('sunlit',window.get('sunlit_at_maximum'))},{'state':'unavailable'})
                    matches.append({'location_id':location['id'],'name':location['name'],'start_utc':segment['start_utc'],'end_utc':segment['end_utc']})
            state='potential' if matches else 'insufficient_data' if unknown or not locations or not searched else 'no_window'
            items.append({'target_id':identity,'target_name':target_name(kind,identity),'state':state,'locations':matches,'horizon_hours':horizon,'searched_locations':searched,'assessment':sample_score,
                          'explanation':'Screened geometry found; forecast and equipment still apply.' if matches else 'Save a location or wait for sufficient current source data.' if state=='insufficient_data' else f'No qualifying window in the next {horizon} hours at the searched locations; this does not mean never visible.',
                          'source':'Current SGP4 elements + pinned JPL DE421' if kind=='satellite' else 'Pinned JPL DE421 / Skyfield; topocentric apparent, unrefracted'})
    finally:COMPUTE.release()
    return {'items':items,'next_offset':offset+len(selected) if offset+len(selected)<len(catalog) else None,'generated_at':now,'horizon_hours':horizon,'weather_policy':'Geometry planning only; forecast is checked for previews and alerts. Missing forecast gives no numeric score.'}
