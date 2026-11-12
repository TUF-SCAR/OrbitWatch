"""One database-coordinated SBDB acquisition owner; fixed approved catalogue.

12 active SBDB objects, not the unused legacy 18-object list. An old Pluto SBDB
epoch is retained but never propagated beyond the explicit validity guard.
All API workers/hosts must use the SAME PostgreSQL database. No startup DDL.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone
from email.utils import parsedate_to_datetime
from threading import Lock
import json
import math
import os
import re
import time
import uuid
import httpx
from sqlalchemy import select,update
from sqlalchemy.exc import SQLAlchemyError
from core.config import enabled
from core.database import database_session_maker
from models.small_bodies import SmallBodyOrbit,SmallBodyRefresh

CATALOG={'ceres':'1','pluto':'134340','eris':'136199','haumea':'136108','makemake':'136472','vesta':'4','pallas':'2',
         'hygiea':'10','eros':'433','bennu':'101955','apophis':'99942','psyche':'16'}
SOURCE='https://ssd-api.jpl.nasa.gov/sbdb.api'
USER_AGENT='OrbitWatch/10.0 (+https://github.com/TUF-SCAR/OrbitWatch/issues)'
DAY=86400
NEOS={'eros','bennu','apophis'}
APOPHIS_CUTOFF=datetime(2029,4,1,tzinfo=timezone.utc).timestamp()/DAY+2440587.5


class SmallBodiesUnavailable(RuntimeError): pass


def parse_orbit(body_id,data,retrieved_at):
    if body_id not in CATALOG: raise ValueError('Unsupported object')
    if data.get('signature')!={'source':'NASA/JPL Small-Body Database (SBDB) API','version':'1.3'}:
        raise ValueError('Unsupported SBDB signature/version')
    obj,orbit=data.get('object',{}),data.get('orbit',{})
    if obj.get('des')!=CATALOG[body_id] or not re.fullmatch(r'\d{7,10}',str(obj.get('spkid',''))) or orbit.get('source')!='JPL' or orbit.get('equinox')!='J2000':
        raise ValueError('Unexpected identity/reference frame')
    solution=str(orbit.get('orbit_id') or '')
    if not solution or len(solution)>80 or obj.get('orbit_id') is not None and str(obj['orbit_id'])!=solution:
        raise ValueError('Inconsistent orbital solution')
    rows=orbit.get('elements',[])
    if not isinstance(rows,list) or len(rows)>32 or len({r['name'] for r in rows})!=len(rows): raise ValueError('Ambiguous elements')
    rows={row['name']:row for row in rows}
    def number(value):
        if value is None or isinstance(value,bool): raise ValueError('Missing numeric field')
        value=float(value)
        if not math.isfinite(value): raise ValueError('Nonfinite element')
        return value
    values={}
    for key,unit in [('a','au'),('e',None),('i','deg'),('om','deg'),('w','deg'),('ma','deg'),('n','deg/d')]:
        if key not in rows or rows[key].get('units')!=unit: raise ValueError('Unexpected element units')
        values[key]=number(rows[key].get('value'))
    epoch=number(orbit.get('epoch'));a,e=values['a'],values['e']
    if not 2300000<epoch<2600000 or not .1<a<200 or not 0<=e<1 or not 0<=values['i']<=180 or not 0<values['n']<100:
        raise ValueError('Unsupported/unbound orbit')
    if not .99<values['n']/(.985607668601/a**1.5)<1.01: raise ValueError('Mean motion inconsistent with AU/day units')
    for key in ('om','w','ma'):
        if not -360<=values[key]<=360: raise ValueError('Invalid angular element')
        values[key]%=360
    if 'q' in rows and (rows['q'].get('units')!='au' or abs(number(rows['q']['value'])-a*(1-e))>max(1e-7,a*1e-6)):
        raise ValueError('Inconsistent perihelion')
    # Engineering propagation guards, NOT an accuracy/covariance guarantee.
    span=180 if body_id in NEOS else 365
    first,last=epoch-span,epoch+span
    for key in ('not_valid_before','not_valid_after'):
        if orbit.get(key) is not None:
            bound=number(orbit[key])
            if key=='not_valid_before': first=max(first,bound)
            else: last=min(last,bound)
    if body_id=='apophis':
        if epoch>=APOPHIS_CUTOFF: raise ValueError('Apophis encounter requires reviewed post-encounter solution')
        last=min(last,APOPHIS_CUTOFF)
    if first>=last: raise ValueError('No safe propagation window')
    solution_date=orbit.get('soln_date')
    if solution_date is not None:
        if not isinstance(solution_date,str) or len(solution_date)>32: raise ValueError('Invalid solution date')
        datetime.fromisoformat(solution_date) # Preserve provider string; never label it retrieval time.
    values.update(epoch_tdb=epoch,valid_from_tdb=first,valid_until_tdb=last,time_scale='TDB',
        frame='IAU76/80 ecliptic J2000',equinox='J2000',source='NASA/JPL SBDB',api_version='1.3',
        solution_date=solution_date,method='Heliocentric osculating two-body; no close-encounter precision guarantee')
    values['sbdb_checked_at']=retrieved_at
    values['sbdb_solution_id']=solution
    now_jd=retrieved_at/DAY+2440587.5
    values['needs_current_epoch']=not first<=now_jd<=last
    if len(json.dumps(values))>3000: raise ValueError('Oversized compact orbit')
    return dict(body_id=body_id,designation=CATALOG[body_id],spk_id=str(obj['spkid']),solution_id=solution,
                elements=values,retrieved_at=retrieved_at,checked_at=retrieved_at)


def parse_horizons(body_id,data,identity,retrieved_at,epoch):
    signature=data.get('signature',{});result=data.get('result','')
    if signature.get('source')!='NASA/JPL Horizons API' or signature.get('version') not in {'1.2','1.3'} or len(result)>100000:
        raise ValueError('Unsupported Horizons schema')
    target=re.search(r'Target body name:\s*(.+?)\s*\{source:\s*([^}]+)\}',result)
    if not target or body_id not in target[1].lower() or 'Center body name: Sun (10)' not in result or 'Output units    : AU-D, deg' not in result or 'Reference frame : Ecliptic of J2000.0' not in result or 'GEOMETRIC osculating elements' not in result:
        raise ValueError('Unexpected Horizons target/units/frame')
    header=next((line for line in result.splitlines() if 'JDTDB,' in line and ' EC,' in line),None)
    if not header or result.count('$$SOE')!=1 or result.count('$$EOE')!=1: raise ValueError('Missing elements table')
    rows=result.split('$$SOE')[1].split('$$EOE')[0].strip().splitlines()
    if len(rows)!=1: raise ValueError('Expected one current-epoch element set')
    cells=dict(zip([cell.strip() for cell in header.split(',')],[cell.strip() for cell in rows[0].split(',')]))
    values={key:float(cells[name]) for key,name in [('a','A'),('e','EC'),('i','IN'),('om','OM'),('w','W'),('ma','MA'),('n','N')]}
    jd=float(cells['JDTDB'])
    if any(not math.isfinite(value) for value in [jd,*values.values()]) or abs(jd-epoch)>1e-7 or not .1<values['a']<200 or not 0<=values['e']<1 or not 0<=values['i']<=180 or not .99<values['n']/(.985607668601/values['a']**1.5)<1.01:
        raise ValueError('Invalid current-epoch elements')
    for key in ('om','w','ma'):
        if not -360<=values[key]<=360: raise ValueError('Invalid current angle')
        values[key]%=360
    if abs(float(cells['QR'])-values['a']*(1-values['e']))>1e-6: raise ValueError('Inconsistent perihelion')
    old=identity['elements']
    last=jd+7
    if body_id=='apophis':
        if jd>=APOPHIS_CUTOFF: raise ValueError('Apophis close encounter needs reviewed vector solution')
        last=min(last,APOPHIS_CUTOFF)
    values.update(epoch_tdb=jd,valid_from_tdb=jd-3,valid_until_tdb=last,time_scale='TDB',frame='IAU76/80 ecliptic J2000',
        equinox='J2000',source='NASA/JPL Horizons',api_version=signature['version'],solution_date=None,
        sbdb_checked_at=old.get('sbdb_checked_at',identity['checked_at']),sbdb_solution_id=old.get('sbdb_solution_id',identity['solution_id']),
        needs_current_epoch=False,horizons_target=target[1].strip(),
        method='Current-epoch heliocentric osculating two-body; no precision/close-encounter guarantee')
    return {**identity,'solution_id':f'{target[2].strip()}@{jd}'[:80],'elements':values,'retrieved_at':retrieved_at,'checked_at':retrieved_at}


class SmallBodyService:
    def __init__(self,sessions=database_session_maker,clock=time.time,client=httpx.Client,sleep=time.sleep):
        self.sessions=sessions;self.clock=clock;self.client=client;self.sleep=sleep
        self.executor=ThreadPoolExecutor(max_workers=1,thread_name_prefix='small-bodies')
        self.lock=Lock();self.pending=None

    def records(self):
        try:
            with self.sessions() as db:
                rows=db.scalars(select(SmallBodyOrbit)).all()
                gate=db.get(SmallBodyRefresh,1)
                if gate is None: raise SmallBodiesUnavailable('Small-body migration required')
                now=self.clock();jd=now/DAY+2440587.5
                errors={key:value for key,value in (gate.object_errors or {}).items() if key in CATALOG and value['until']>now}
                items=[]
                for row in rows:
                    if row.body_id not in CATALOG: continue
                    state='fresh' if now-row.retrieved_at<60 else 'cached' if now-row.checked_at<DAY else 'stale'
                    if row.body_id in errors: state='stale'
                    if not row.elements['valid_from_tdb']<=jd<=row.elements['valid_until_tdb']: state='unavailable'
                    items.append(dict(body_id=row.body_id,designation=row.designation,spk_id=row.spk_id,
                        solution_id=row.solution_id,**row.elements,retrieved_at=row.retrieved_at,checked_at=row.checked_at,state=state))
                due=bool(set(CATALOG)-{r.body_id for r in rows}-set(errors)) or any((now-r.checked_at>=DAY or r.elements.get('needs_current_epoch',False)) and r.body_id not in errors for r in rows)
                next_at=max(gate.next_at,gate.lease_until)
                if gate.day_calls>=24: next_at=max(next_at,gate.day_start+DAY)
                return dict(items=items,refresh_due=due,retry_after_seconds=max(2,math.ceil(next_at-now)),
                            state='available' if items else 'preparing',source='NASA/JPL SBDB / Horizons',catalogue_count=len(CATALOG),
                            object_status={key:{'state':'invalid','retry_at':value['until']} for key,value in errors.items()})
        except SQLAlchemyError: raise SmallBodiesUnavailable('Small-body schema/database unavailable') from None

    def claim(self):
        now=self.clock();token=str(uuid.uuid4())
        with self.sessions() as db:
            gate=db.get(SmallBodyRefresh,1)
            if gate is None: raise SmallBodiesUnavailable('Small-body migration required')
            if now-gate.day_start>=DAY:
                # Compare-and-swap day reset; concurrent hosts cannot reset an already new window.
                db.execute(update(SmallBodyRefresh).where(SmallBodyRefresh.id==1,SmallBodyRefresh.day_start<=now-DAY).values(day_start=now,day_calls=0))
            result=db.execute(update(SmallBodyRefresh).where(SmallBodyRefresh.id==1,SmallBodyRefresh.lease_until<=now,
                SmallBodyRefresh.next_at<=now,SmallBodyRefresh.day_calls<24).values(lease_token=token,lease_until=now+90,
                next_at=now+2,day_calls=SmallBodyRefresh.day_calls+1))
            db.commit();return token if result.rowcount==1 else None

    def retrieve(self,body_id):
        started=time.monotonic();parts=[];size=0
        user_agent=os.getenv('ORBITWATCH_JPL_USER_AGENT') or USER_AGENT
        with self.client(timeout=httpx.Timeout(15,connect=5),follow_redirects=False,headers={'User-Agent':user_agent}) as client:
            with client.stream('GET',SOURCE,params={'des':CATALOG[body_id],'full-prec':'true','nv-fmt':'jd'}) as response:
                response.raise_for_status()
                if response.status_code!=200 or not response.headers.get('Content-Type','').startswith('application/json'): raise ValueError('Unexpected SBDB response')
                for chunk in response.iter_bytes(16384):
                    size+=len(chunk)
                    if size>100000 or time.monotonic()-started>25: raise ValueError('SBDB transfer limit')
                    parts.append(chunk)
        return parse_orbit(body_id,json.loads(b''.join(parts)),self.clock())

    def retrieve_current(self,body_id,identity):
        epoch=math.floor(self.clock()/DAY+2440587.5)+.5
        command='999' if body_id=='pluto' else CATALOG[body_id]+';'
        params=dict(format='json',COMMAND=f"'{command}'",EPHEM_TYPE="'ELEMENTS'",CENTER="'500@10'",REF_PLANE="'ECLIPTIC'",
                    REF_SYSTEM="'ICRF'",OUT_UNITS="'AU-D'",CSV_FORMAT="'YES'",TLIST=f"'{epoch}'",TIME_TYPE="'TDB'",OBJ_DATA="'YES'")
        started=time.monotonic();parts=[];size=0
        with self.client(timeout=httpx.Timeout(15,connect=5),follow_redirects=False,headers={'User-Agent':os.getenv('ORBITWATCH_JPL_USER_AGENT') or USER_AGENT}) as client:
            with client.stream('GET','https://ssd.jpl.nasa.gov/api/horizons.api',params=params) as response:
                response.raise_for_status()
                if response.status_code!=200 or not response.headers.get('Content-Type','').startswith('application/json'): raise ValueError('Unexpected Horizons response')
                for chunk in response.iter_bytes(16384):
                    size+=len(chunk)
                    if size>100000 or time.monotonic()-started>25: raise ValueError('Horizons transfer limit')
                    parts.append(chunk)
        return parse_horizons(body_id,json.loads(b''.join(parts)),identity,self.clock(),epoch)

    def refresh(self):
        if not enabled('ORBITWATCH_SMALL_BODY_PROVIDER_REQUESTS',True): return
        for body_id in CATALOG:
            # At most two separately budgeted serial requests: SBDB identity,
            # then a current Horizons epoch only when SBDB is scientifically old.
            for stage in range(2):
                with self.sessions() as db:
                    gate=db.get(SmallBodyRefresh,1)
                    blocked=(gate.object_errors or {}).get(body_id) if gate else None
                    if blocked and blocked['until']>self.clock(): break
                    row=db.get(SmallBodyOrbit,body_id)
                    needs=row and row.elements.get('needs_current_epoch',False)
                    if row and self.clock()-row.checked_at<DAY and not needs: break
                    current_epoch=bool(row and (needs or row.elements.get('source')=='NASA/JPL Horizons' and self.clock()-row.elements.get('sbdb_checked_at',0)<7*DAY))
                    identity={key:getattr(row,key) for key in ('body_id','designation','spk_id','solution_id','elements','retrieved_at','checked_at')} if row else None
                token=self.claim()
                if not token: return
                error=None;record=None
                try: record=self.retrieve_current(body_id,identity) if current_epoch else self.retrieve(body_id)
                except Exception as e: error=e
                with self.sessions() as db:
                    owned=db.execute(update(SmallBodyRefresh).where(SmallBodyRefresh.id==1,SmallBodyRefresh.lease_token==token).values(lease_token=None,lease_until=0)).rowcount==1
                    if not owned: db.rollback();return
                    gate=db.get(SmallBodyRefresh,1)
                    invalid=isinstance(error,(ValueError,TypeError,KeyError,AttributeError))
                    if record:
                        current=db.get(SmallBodyOrbit,body_id)
                        if current:
                            # Keep a usable Horizons plane while checking SBDB's
                            # old solution again; a temporary outage must not jump
                            # the renderer back to the unrelated catalog phase.
                            if record['elements'].get('needs_current_epoch') and current.elements.get('source')=='NASA/JPL Horizons':
                                current.elements={**current.elements,'needs_current_epoch':True,'sbdb_checked_at':self.clock(),'sbdb_solution_id':record['solution_id']}
                                current.checked_at=self.clock()
                            elif {k:v for k,v in current.elements.items() if k!='sbdb_checked_at'}!={k:v for k,v in record['elements'].items() if k!='sbdb_checked_at'} or current.solution_id!=record['solution_id']:
                                for key,value in record.items(): setattr(current,key,value)
                            else:
                                current.elements={**current.elements,'sbdb_checked_at':record['elements'].get('sbdb_checked_at',self.clock())}
                                current.checked_at=self.clock()
                        else: db.add(SmallBodyOrbit(**record))
                        gate.failures=0;gate.next_at=self.clock()+2
                        gate.object_errors={key:value for key,value in (gate.object_errors or {}).items() if key!=body_id and value['until']>self.clock()}
                    elif invalid:
                        gate.object_errors={**{key:value for key,value in (gate.object_errors or {}).items() if value['until']>self.clock()},body_id:{'until':self.clock()+DAY}}
                        gate.next_at=self.clock()+2
                    else:
                        gate.failures=min(gate.failures+1,8);delay=min(DAY,60*2**(gate.failures-1))
                        response=getattr(error,'response',None)
                        if response is not None:
                            value=response.headers.get('Retry-After','')
                            try: delay=max(delay,float(value))
                            except ValueError:
                                try: delay=max(delay,parsedate_to_datetime(value).timestamp()-self.clock())
                                except (ValueError,TypeError,OverflowError): pass
                        if not math.isfinite(delay): delay=DAY
                        gate.next_at=self.clock()+max(60,min(7*DAY,delay))
                    db.commit()
                if error and not invalid: return
                self.sleep(2.05)
                if invalid: break

    def response(self):
        result=self.records()
        if result['refresh_due'] and result['retry_after_seconds']<=2 and enabled('ORBITWATCH_SMALL_BODY_PROVIDER_REQUESTS',True):
            with self.lock:
                if self.pending is None or self.pending.done():
                    self.pending=self.executor.submit(self.refresh)
                    self.pending.add_done_callback(lambda future:future.exception())
        return result

    def shutdown(self): self.executor.shutdown(wait=True,cancel_futures=True)


small_bodies=SmallBodyService()
