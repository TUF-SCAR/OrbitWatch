from fastapi import APIRouter,Depends,Response,HTTPException,Path
from core.security import get_current_user
from services.natural_events import current_events

router=APIRouter(prefix='/api/events',tags=['Live Earth natural events'],dependencies=[Depends(get_current_user)])


@router.get('')
def events(response:Response):
    response.headers['Cache-Control']='private, no-store'
    value=current_events()
    if value['state'] in {'preparing','unavailable'}:
        response.status_code=202 if value['state']=='preparing' else 503
    response.headers['Retry-After']=str(min(p['retry_after_seconds'] for p in value['providers'].values()))
    return value


@router.get('/{event_id}')
def detail(response:Response,event_id:str=Path(min_length=3,max_length=180,pattern=r'^[A-Za-z0-9_:-]+$')):
    response.headers['Cache-Control']='private, no-store'
    # Deliberately cache-only: a click cannot fan out to providers or fetch URLs
    # supplied by untrusted reports. List already contains supported details.
    value=current_events(schedule=False)
    event=next((e for e in value['events'] if e['id']==event_id),None)
    if not event:raise HTTPException(404,'This report is not in the usable recent-event cache.')
    return {'event':event,'provider_status':value['providers'][event['provider']],'disclaimer':value['disclaimer']}
