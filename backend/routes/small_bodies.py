from fastapi import APIRouter,Depends,Response,HTTPException
from core.security import get_current_user
from services.small_bodies import small_bodies,SmallBodiesUnavailable

router=APIRouter(prefix='/api/solar-system',tags=['Live orbital reference'],dependencies=[Depends(get_current_user)])

@router.get('/small-bodies')
def small_body_elements(response:Response):
    response.headers['Cache-Control']='private, no-store'
    try: return small_bodies.response()
    except SmallBodiesUnavailable:
        raise HTTPException(503,detail='Shared small-body orbital records are unavailable; the existing approximation remains available.',headers={'Retry-After':'300','Cache-Control':'no-store'})
