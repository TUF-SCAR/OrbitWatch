from datetime import datetime, timezone
import time
from typing import Literal
from uuid import UUID
from types import SimpleNamespace
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session
from core.database import get_database_session
from core.security import get_current_user
from models.user import User
from models.account import ObservationLocation
from models.alerts import AlertSubscription
from models.satellite_orbital_data import SatelliteOrbitalData
from routes.account import account_storage, owned_location
from services.account_targets import target_name
from services.visibility import COMPUTE, prediction
from services.visibility_forecast import forecast, match_forecast

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
            results.append({**prediction(kind,identity,records.get(identity),loc,now,hours,None),'target_name':names[identity]})
        # Do not spend a weather call on missing/stale or windowless astronomy.
        dataset=forecast(loc['latitude'],loc['longitude']) if any(item['windows'] for item in results) else None
        for item in results:
            for window in item['windows']:
                useful=window.get('useful_segments',[])
                moment=datetime.fromisoformat(useful[0]['start_utc'] if useful else window['maximum_at_utc'])
                window['weather']=match_forecast(dataset,moment)
    finally: COMPUTE.release()
    return {'location':loc,'generated_at':now.isoformat(),'horizon_hours':hours,'items':results,
            'preview_only':True,'screening':{'minimum_altitude_degrees':10,'satellite_sun_altitude_max_degrees':-6,'maximum_element_age_days':7},
            'limitations':'No brightness guarantee, terrain or atmospheric refraction model. Forecast is separate from geometry. No scheduled alerts.'}
