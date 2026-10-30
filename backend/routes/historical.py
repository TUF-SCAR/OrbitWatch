from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import AwareDatetime
from core.security import get_current_user
from repositories.historical_elements import HistoricalArchiveUnavailable, historical_coverage
from routes.satellites import convert_satellite_error
from schemas.historical import HistoricalRequest, check_timestamp
from services.historical_catalog import HISTORICAL_IDS, check_historical_ids
from services.historical_tracker import historical_batch

router = APIRouter(prefix='/api/historical', tags=['Historical satellites'], dependencies=[Depends(get_current_user)])


def run_history(request):
    try:
        return historical_batch(request.norad_ids, request.timestamp, request.step_seconds, request.duration_seconds, request.orbit_samples)
    except HistoricalArchiveUnavailable:
        raise HTTPException(status_code=503, detail='Historical archive is not deployed. Live Mode remains available.', headers={'Retry-After':'60'}) from None
    except Exception as error:
        convert_satellite_error(error)


@router.get('/coverage')
def coverage():
    try:
        return {'norad_ids':HISTORICAL_IDS, 'objects':historical_coverage()}
    except HistoricalArchiveUnavailable:
        raise HTTPException(status_code=503, detail='Historical archive is not deployed. Live Mode remains available.') from None
    except Exception as error:
        convert_satellite_error(error)


@router.post('/trajectories')
def trajectories(request: HistoricalRequest):
    return run_history(request)


def single_request(norad_id, timestamp, samples=480):
    try:
        check_historical_ids([norad_id]); check_timestamp(timestamp)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from None
    return HistoricalRequest(norad_ids=[norad_id], timestamp=timestamp, orbit_samples=samples)


@router.get('/{norad_id}/position')
def position(norad_id: int, timestamp: AwareDatetime):
    result = run_history(single_request(norad_id, timestamp))
    if not result['objects']:
        raise HTTPException(status_code=404, detail=result['errors'][0]['message'])
    return {'norad_id':norad_id, **result['objects'][0]['position']}


@router.get('/{norad_id}/orbit')
def orbit(norad_id: int, timestamp: AwareDatetime, samples: int = Query(default=480, ge=32, le=960)):
    result = run_history(single_request(norad_id, timestamp, samples))
    if not result['objects']:
        raise HTTPException(status_code=404, detail=result['errors'][0]['message'])
    return result['objects'][0]['orbit']
