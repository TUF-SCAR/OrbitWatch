from fastapi import APIRouter, Depends, HTTPException, Query, Response
from core.security import get_current_user
from services.weather import global_temperature, location_weather, weather_status
from services.weather_cache import WeatherDeferred

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
