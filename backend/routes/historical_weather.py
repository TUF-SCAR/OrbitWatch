import gzip
import json
from fastapi import APIRouter, Depends, HTTPException, Query, Response, Request
from fastapi.encoders import jsonable_encoder
from pydantic import AwareDatetime
from sqlalchemy.exc import SQLAlchemyError
from core.security import get_current_user
from services import historical_weather as archive
from services.historical_weather_storage import WeatherStorageUnavailable
from services.historical_weather_codec import utc

router=APIRouter(prefix='/api/historical/weather',tags=['Historical weather'],dependencies=[Depends(get_current_user)])


def run(operation):
    try: return operation()
    except HTTPException: raise
    except (WeatherStorageUnavailable,ValueError,KeyError,SQLAlchemyError):
        raise HTTPException(503,'Historical weather archive unavailable. Astronomical exploration remains available.',headers={'Retry-After':'60'}) from None


def valid_time(timestamp):
    try: return utc(timestamp)
    except ValueError as error: raise HTTPException(422,str(error)) from None


@router.get('/coverage')
def coverage(): return run(archive.coverage)


@router.get('/snapshot')
def snapshot(request:Request,timestamp:AwareDatetime):
    date=valid_time(timestamp)
    result=run(lambda:archive.snapshot(date))
    if result is None: raise HTTPException(404,'No authentic weather snapshot exists for this exact timestamp')
    # Bounded decoded response; HTTP compression is transparent to fetch().
    raw=json.dumps(jsonable_encoder(result),allow_nan=False,separators=(',',':')).encode('utf8')
    if len(raw)>8*1024*1024: raise HTTPException(503,'Snapshot response exceeds bound')
    headers={'Vary':'Accept-Encoding','Cache-Control':'private, max-age=300'}
    if 'gzip' in request.headers.get('Accept-Encoding',''):
        raw=gzip.compress(raw,mtime=0);headers['Content-Encoding']='gzip'
    return Response(raw,media_type='application/json',headers=headers)


@router.get('/location')
def location(timestamp:AwareDatetime,latitude:float=Query(ge=-90,le=90,allow_inf_nan=False),longitude:float=Query(ge=-180,le=180,allow_inf_nan=False)):
    date=valid_time(timestamp)
    result=run(lambda:archive.location(date,latitude,longitude))
    if result is None: raise HTTPException(404,'No authentic weather snapshot exists for this exact timestamp')
    return result
