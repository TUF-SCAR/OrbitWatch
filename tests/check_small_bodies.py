"""Shared provider acquisition, real public schema fixtures, isolated SQLite API."""
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
import copy,json,os,sys
import httpx
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'backend'))
with patch('dotenv.load_dotenv',return_value=False),patch.dict(os.environ,{'DATABASE_URL':'sqlite:///:memory:','JWT_SECRET_KEY':'isolated-small-body-reference-test-key','ORBITWATCH_SMALL_BODY_PROVIDER_REQUESTS':'true'}):
    from sqlalchemy import create_engine,select,update
    from sqlalchemy.orm import sessionmaker
    from models.small_bodies import SmallBodyOrbit,SmallBodyRefresh
    from services import small_bodies as module
    from services.small_bodies import SmallBodyService,parse_orbit,CATALOG
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from routes import small_bodies as route
    from core.security import get_current_user
    raw={id:json.loads((ROOT/'tests/fixtures'/f'jpl-sbdb-{des}.json').read_text()) for id,des in [('ceres','1'),('eros','433'),('pluto','134340')]}
    clock=[1794400000.];calls=[];fail=[False];malformed=[False]
    for id in raw: assert parse_orbit(id,raw[id],clock[0])['body_id']==id
    for mutate in [lambda x:x['object'].update(des='999'),lambda x:x['orbit'].update(equinox='B1950'),lambda x:x['signature'].update(version='unexpected'),lambda x:x['orbit']['elements'][0].update(value='NaN'),lambda x:x['orbit']['elements'][0].update(value='1.1'),lambda x:x['orbit']['elements'][1].update(units='km')]:
        data=copy.deepcopy(raw['ceres']);mutate(data)
        try: parse_orbit('ceres',data,clock[0])
        except ValueError: pass
        else: raise AssertionError('Invalid orbit admitted')
    def handler(request):
        assert request.url.host in {'ssd-api.jpl.nasa.gov','ssd.jpl.nasa.gov'}
        assert 'OrbitWatch' in request.headers['User-Agent']
        calls.append(request)
        if fail[0]: return httpx.Response(429,headers={'Retry-After':'600'})
        if request.url.host=='ssd.jpl.nasa.gov': return httpx.Response(200,json=json.loads((ROOT/'tests/fixtures/horizons-pluto-elements.json').read_text()))
        id=next(id for id,des in CATALOG.items() if des==request.url.params['des'])
        if malformed[0] and id=='ceres': return httpx.Response(200,json={'signature':{'version':'unsupported'}})
        return httpx.Response(200,json=raw[id])
    with TemporaryDirectory(dir=ROOT/'.setup-cache') as tmp:
        engine=create_engine('sqlite:///'+(Path(tmp)/'orbits.sqlite').as_posix(),connect_args={'check_same_thread':False})
        for model in (SmallBodyOrbit,SmallBodyRefresh): model.__table__.create(engine)
        sessions=sessionmaker(engine,expire_on_commit=False)
        with sessions() as db: db.add(SmallBodyRefresh(id=1));db.commit()
        service=SmallBodyService(sessions,lambda:clock[0],lambda **kwargs:httpx.Client(transport=httpx.MockTransport(handler),**kwargs),lambda seconds:clock.__setitem__(0,clock[0]+seconds))
        with patch.dict(module.CATALOG,{'ceres':'1','eros':'433'},clear=True):
            service.refresh();assert len(calls)==2
            data=service.records();assert len(data['items'])==2
            assert all(row['state']=='fresh' for row in data['items'])
            service.refresh();assert len(calls)==2
            second=SmallBodyService(sessions,lambda:clock[0],client=lambda **_: (_ for _ in ()).throw(AssertionError('fresh cache must not fetch')))
            assert len(second.records()['items'])==2;second.refresh();second.shutdown()
            old_retrieved=data['items'][0]['retrieved_at'];clock[0]+=86402;service.refresh()
            assert len(calls)==4 and service.records()['items'][0]['retrieved_at']==old_retrieved
            clock[0]+=86402;fail[0]=True;service.refresh()
            with sessions() as db:
                gate=db.get(SmallBodyRefresh,1);assert gate.failures==1 and gate.next_at>=clock[0]+600
            after=len(calls);service.refresh();assert len(calls)==after
            assert len(service.records()['items'])==2 # last usable rows survive outage
            # Concurrent independent service instances share a single database lease.
            clock[0]+=1000
            with ThreadPoolExecutor(max_workers=8) as pool: tokens=list(pool.map(lambda _:service.claim(),range(16)))
            assert sum(token is not None for token in tokens)==1
            app=FastAPI();app.include_router(route.router)
            with patch.object(route,'small_bodies',service),patch.dict(os.environ,{'ORBITWATCH_SMALL_BODY_PROVIDER_REQUESTS':'false'}),TestClient(app) as client:
                assert client.get('/api/solar-system/small-bodies').status_code==401
                app.dependency_overrides[get_current_user]=lambda:object()
                response=client.get('/api/solar-system/small-bodies');assert response.status_code==200 and len(response.json()['items'])==2
                assert response.headers['cache-control']=='private, no-store'
                with patch.object(service,'response',side_effect=module.SmallBodiesUnavailable()): assert client.get('/api/solar-system/small-bodies').status_code==503
        service.shutdown()
        clock[0]=(2461356.5-2440587.5)*86400;fail[0]=False
        with sessions() as db:
            db.execute(update(SmallBodyRefresh).values(lease_token=None,lease_until=0,next_at=0,day_start=clock[0],day_calls=0,failures=0));db.commit()
        fallback=SmallBodyService(sessions,lambda:clock[0],lambda **kwargs:httpx.Client(transport=httpx.MockTransport(handler),**kwargs),lambda seconds:clock.__setitem__(0,clock[0]+seconds))
        with patch.dict(module.CATALOG,{'pluto':'134340'},clear=True):
            before=len(calls);fallback.refresh();assert len(calls)==before+2
            item=fallback.records()['items'][0]
            assert item['source']=='NASA/JPL Horizons' and item['epoch_tdb']==2461356.5 and item['state']=='fresh'
            assert item['sbdb_solution_id'] and not item['needs_current_epoch']
            fallback.refresh();assert len(calls)==before+2
        fallback.shutdown();engine.dispose()
    # One malformed optional object must not starve the rest of the catalogue.
    engine=create_engine('sqlite:///:memory:')
    for model in (SmallBodyOrbit,SmallBodyRefresh): model.__table__.create(engine)
    sessions=sessionmaker(engine,expire_on_commit=False)
    with sessions() as db: db.add(SmallBodyRefresh(id=1));db.commit()
    clock[0]=1794400000.;malformed[0]=True
    service=SmallBodyService(sessions,lambda:clock[0],lambda **kwargs:httpx.Client(transport=httpx.MockTransport(handler),**kwargs),lambda seconds:clock.__setitem__(0,clock[0]+seconds))
    with patch.dict(module.CATALOG,{'ceres':'1','eros':'433'},clear=True):
        before=len(calls);service.refresh();data=service.records()
        assert len(calls)==before+2 and [row['body_id'] for row in data['items']]==['eros']
        assert data['object_status']['ceres']['state']=='invalid' and not data['refresh_due']
        service.refresh();assert len(calls)==before+2
        clock[0]+=86402;malformed[0]=False;service.refresh();data=service.records()
        assert len(data['items'])==2 and not data['object_status']
    # The persisted daily quota cannot be bypassed by a second service/process.
    with sessions() as db:
        db.execute(update(SmallBodyRefresh).values(day_calls=24,next_at=0,lease_until=0));db.commit()
    assert service.claim() is None and service.records()['retry_after_seconds']>80000
    service.shutdown();engine.dispose()
print('PASS real SBDB v1.3 fixtures/identity/units/epoch/frame validation; persistent compact cache, unchanged solution retention, single shared lease, backoff, auth API; external HTTP0')
