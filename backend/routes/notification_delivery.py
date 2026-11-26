from datetime import datetime,timedelta,timezone
from uuid import UUID, uuid4
from types import SimpleNamespace
from fastapi import APIRouter,Depends,HTTPException,Response
from pydantic import BaseModel,ConfigDict,Field
from sqlalchemy import delete,func,select
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from core.database import get_database_session
from core.security import get_current_user
from models.user import User
from models.notification_delivery import PushDevice,NotificationRun,NotificationDelivery
from routes.account import account_storage,lock_owner
from services.account_inbox import utc
from services.browser_push import configuration,validate_subscription,endpoint_hash,encrypt_subscription,device_limit,send_push
from services.auth_state import consume_attempt

router=APIRouter(prefix='/api/account',tags=['Notification delivery'])


class PushInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    consent:bool
    endpoint:str=Field(min_length=1,max_length=2048)
    keys:dict[str,str]
    expirationTime:int|None=None
    replace_id:UUID|None=None


@router.get('/notification-delivery')
def status(response:Response,user:User=Depends(get_current_user),database:Session=Depends(get_database_session)):
    response.headers['Cache-Control']='no-store'
    with account_storage(database):
        row=database.get(NotificationRun,1);now=datetime.now(timezone.utc)
        config=configuration();last=utc(row.last_success_at) if row else None
        recent=bool(last and now-timedelta(seconds=120 if row.mode=='loop' else 720)<=last<=now+timedelta(minutes=1))
        devices=list(database.scalars(select(PushDevice).where(PushDevice.owner_id==user.id).order_by(PushDevice.created_at)))
        counts=dict(database.execute(select(NotificationDelivery.state,func.count()).where(NotificationDelivery.owner_id==user.id).group_by(NotificationDelivery.state)).all())
        return {'scheduler_state':'recent_success' if recent else 'stale' if last else 'not_operational',
                'scheduler_mode':row.mode if row else None,'last_success_at':last,'last_started_at':utc(row.started_at) if row else None,'last_error':row.last_error if row else None,
                'push_configured':bool(config),'vapid_public_key':config['ORBITWATCH_VAPID_PUBLIC_KEY'] if config else None,
                'devices':[{'id':device.id,'created_at':device.created_at} for device in devices],
                'device_limit':device_limit(),'outcomes':counts,'disclaimer':'Provider acceptance does not prove device display. OrbitWatch does not replace emergency alert systems.'}


@router.post('/push-subscriptions',status_code=201)
def subscribe(body:PushInput,response:Response,user:User=Depends(get_current_user),database:Session=Depends(get_database_session)):
    response.headers['Cache-Control']='no-store'
    if not body.consent:raise HTTPException(422,'Explicit browser notification consent is required')
    if body.expirationTime is not None and body.expirationTime<=datetime.now(timezone.utc).timestamp()*1000:raise HTTPException(422,'Push subscription has expired')
    if not configuration():raise HTTPException(503,'Browser push not configured')
    try:value=validate_subscription(body.model_dump(exclude={'consent','expirationTime','replace_id'}))
    except (ValueError,TypeError):raise HTTPException(422,'Invalid or unsupported push subscription') from None
    with account_storage(database):
        lock_owner(database,user.id)
        digest=endpoint_hash(value)
        existing=database.scalar(select(PushDevice).where(PushDevice.endpoint_hash==digest).with_for_update())
        if existing:
            if existing.owner_id!=user.id:raise HTTPException(409,'This browser is associated with another account; disable it there first')
            existing.encrypted_subscription=encrypt_subscription(value);database.commit();response.status_code=200
            return {'id':existing.id,'state':'subscribed'}
        devices=list(database.scalars(select(PushDevice).where(PushDevice.owner_id==user.id)))
        replaced = next((device for device in devices if device.id == str(body.replace_id)), None)
        if replaced:
            database.delete(replaced)
            database.flush()
            devices.remove(replaced)
        if len(devices)>=device_limit():raise HTTPException(409,'Browser device limit reached; remove an existing device first')
        row=PushDevice(owner_id=user.id,slot=next(i for i in range(1,6) if all(device.slot!=i for device in devices)),endpoint_hash=digest,encrypted_subscription=encrypt_subscription(value))
        database.add(row)
        try:database.commit()
        except IntegrityError:
            database.rollback();raise HTTPException(409,'Device association changed; refresh and try again') from None
        database.refresh(row)
        return {'id':row.id,'state':'subscribed'}


@router.delete('/push-subscriptions/{identity}',status_code=204)
def revoke(identity:UUID,response:Response,user:User=Depends(get_current_user),database:Session=Depends(get_database_session)):
    with account_storage(database):
        lock_owner(database,user.id)
        database.execute(delete(PushDevice).where(PushDevice.id==str(identity),PushDevice.owner_id==user.id));database.commit()
    return Response(status_code=204,headers={'Cache-Control':'no-store'})


@router.post('/push-subscriptions/{identity}/test')
def test_push(identity:UUID,response:Response,user:User=Depends(get_current_user),database:Session=Depends(get_database_session)):
    """Deliver a private, explicitly requested device check without creating an alert."""
    response.headers['Cache-Control']='no-store'
    if not configuration():
        raise HTTPException(503,'Browser push not configured')
    with account_storage(database):
        owner_id=user.id
        device=database.scalar(select(PushDevice).where(PushDevice.id==str(identity),PushDevice.owner_id==owner_id))
        if device is None:
            raise HTTPException(404,'Browser device unavailable')
        target=SimpleNamespace(id=device.id,encrypted_subscription=device.encrypted_subscription)
        consume_attempt(database,'push-test',owner_id,3,300)
    payload={'id':str(uuid4()),'title':'OrbitWatch delivery test',
             'body':'This browser received a test notification.',
             'device_id':target.id,'expires_at':(datetime.now(timezone.utc)+timedelta(minutes=2)).isoformat()}
    try:
        send_push(target,payload,120)
    except Exception as error:
        status_code=getattr(getattr(error,'response',None),'status_code',None)
        if status_code in (404,410):
            with account_storage(database):
                database.execute(delete(PushDevice).where(
                    PushDevice.id==target.id, PushDevice.owner_id==owner_id,
                    PushDevice.encrypted_subscription==target.encrypted_subscription))
                database.commit()
            raise HTTPException(410,'Browser subscription expired. Enable it again.') from None
        raise HTTPException(503,'The push provider did not accept this test. Try again shortly.') from None
    return {'state':'accepted'}
