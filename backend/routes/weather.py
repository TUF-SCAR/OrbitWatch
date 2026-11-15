from fastapi import APIRouter, Depends, HTTPException, Query, Response, Request
from core.security import get_current_user
from services.weather import global_temperature, location_weather, weather_status
from services.weather_cache import WeatherDeferred
from services.infrared import infrared, InfraredDisabled

router = APIRouter(prefix='/api/weather',tags=['Live Earth weather'],dependencies=[Depends(get_current_user)])


def unavailable():
    raise HTTPException(status_code=503,detail='Weather is temporarily unavailable or cooling down. Please retry shortly.',headers={'Retry-After':'30','Cache-Control':'no-store'})


@router.get('/temperature')
def temperature(response: Response, bundle: bool = False):
    response.headers['Cache-Control']='private, no-store'
    try:
        result = global_temperature(require_fields=True) if bundle else global_temperature()
        if not result.get('values_c'):
            response.status_code = 202 if result['state'] in {'preparing','downloading','decoding'} else 503
            response.headers['Retry-After'] = str(result['retry_after_seconds'])
        return result
    except WeatherDeferred: unavailable()


@router.get('/fields')
def fields(response: Response):
    return temperature(response, bundle=True)


@router.get('/location')
def location(response: Response, latitude: float = Query(ge=-90,le=90),longitude: float = Query(ge=-180,le=180)):
    response.headers['Cache-Control']='private, no-store'
    try: return location_weather(latitude,longitude)
    except WeatherDeferred: unavailable()


@router.get('/status')
def status(response: Response):
    response.headers['Cache-Control']='private, no-store'
    return weather_status()


@router.get('/infrared/slots')
def infrared_slots(response: Response):
    response.headers['Cache-Control']='private, no-store'
    try: return infrared.slots()
    except InfraredDisabled:
        raise HTTPException(503,detail='Infrared imagery disabled by server configuration',headers={'Cache-Control':'no-store'})
    except WeatherDeferred: unavailable()


@router.get('/infrared/current')
def infrared_current(response: Response, width: int = Query(1024)):
    response.headers['Cache-Control']='private, no-store'
    try: return infrared.current(width)
    except InfraredDisabled:
        response.status_code=503
        return dict(state='disabled',detail='Infrared imagery disabled by server configuration')
    except ValueError: raise HTTPException(422,detail='Invalid display resolution')
    except WeatherDeferred:
        response.status_code=503
        response.headers['Retry-After']='60'
        return dict(state='unavailable',retry_after_seconds=60,detail='No acceptable recent infrared observation is available')


@router.get('/infrared/frame')
def infrared_frame(request: Request, time: str = Query(max_length=32), width: int = Query(1024), bbox: str | None = Query(None,max_length=80), height: int | None = Query(None,ge=128,le=2048)):
    try:
        bounds=[int(value) for value in bbox.split(',')] if bbox is not None else None
        data,info=infrared.frame(time,width,bounds,height)
        etag=f'"{info["version"]}"'
        headers={'Cache-Control':'private, max-age=600, must-revalidate','ETag':etag,
            'Access-Control-Expose-Headers':'ETag, X-Observation-Time, X-Retrieved-At, X-Imagery-Stale, X-Attribution',
            'X-Observation-Time':info['time'],'X-Retrieved-At':info['retrieved_at'],
            'X-Imagery-Stale':str(info['stale']).lower(),'X-Attribution':'EUMETSAT / NOAA / JMA; CC BY 4.0'}
        if request.headers.get('if-none-match')==etag: return Response(status_code=304,headers=headers)
        return Response(data,media_type='image/jpeg',headers=headers)
    except InfraredDisabled:
        raise HTTPException(503,detail='Infrared imagery disabled by server configuration',headers={'Cache-Control':'no-store'})
    except ValueError:
        raise HTTPException(422,detail='Invalid or unadvertised infrared frame',headers={'Cache-Control':'no-store'})
    except WeatherDeferred:
        delay=max(1,infrared.cache.gate('eumetsat_layer')['retry_after_seconds'])
        raise HTTPException(503,detail='Infrared image is cooling down or unavailable',headers={'Cache-Control':'no-store','Retry-After':str(max(30,delay))})
