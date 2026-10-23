"""Conservative same-host provider budgets. Never store credentials/content.

All API workers share this SQLite reservation store and OS job lock. Deploy only
one ingestion host; multiple independent hosts need a shared distributed lease.
"""
import os, sqlite3, time, random
from pathlib import Path
from email.utils import parsedate_to_datetime
from contextlib import contextmanager
ROOT=Path(__file__).resolve().parents[2]/'.runtime'

class ProviderDeferred(RuntimeError):
    pass

class ProviderAuthorizationError(RuntimeError):
    authorization_failed=True

def error_summary(error):
    code=getattr(getattr(error,'response',None),'status_code',None)
    return f'HTTP {code}' if code else type(error).__name__

class ProviderBudget:
    def __init__(self,path=None,clock=time.time,jitter=lambda:random.uniform(30,180)):
        self.path=Path(path or ROOT/'provider-budget.sqlite3');self.clock=clock;self.jitter=jitter
    @contextmanager
    def connect(self):
        self.path.parent.mkdir(parents=True,exist_ok=True)
        db=sqlite3.connect(self.path,timeout=5)
        try:
            with db:
                db.execute('CREATE TABLE IF NOT EXISTS budgets(name TEXT PRIMARY KEY,next_at REAL,failures INTEGER,blocked INTEGER,last_at REAL)')
                db.execute('CREATE TABLE IF NOT EXISTS requests(stamp REAL,cost INTEGER)')
                yield db
        finally:
            db.close()
    def reserve(self,name,interval,cost):
        now=self.clock()
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT next_at,blocked FROM budgets WHERE name=?',(name,)).fetchone()
            if row and (row[1] or row[0]>now): raise ProviderDeferred(f'{name} refresh budget/circuit is closed')
            if name=='spacetrack':
                minute=db.execute('SELECT COALESCE(SUM(cost),0) FROM requests WHERE stamp>?',(now-60,)).fetchone()[0]
                hour=db.execute('SELECT COALESCE(SUM(cost),0) FROM requests WHERE stamp>?',(now-3600,)).fetchone()[0]
                if minute+cost>=30 or hour+cost>=300: raise ProviderDeferred('Space-Track request ceiling')
                db.execute('DELETE FROM requests WHERE stamp<?',(now-3600,))
                db.execute('INSERT INTO requests VALUES(?,?)',(now,cost))
            db.execute('INSERT INTO budgets VALUES(?,?,0,0,?) ON CONFLICT(name) DO UPDATE SET next_at=excluded.next_at,last_at=excluded.last_at',(name,now+interval+self.jitter(),now))
    def finish(self,name,interval,error=None):
        now=self.clock()
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT failures,next_at FROM budgets WHERE name=?',(name,)).fetchone()
            failures=(row[0] if row else 0)+1 if error else 0
            until=row[1] if row else now+interval
            blocked=0
            if error:
                response=getattr(error,'response',None);code=getattr(response,'status_code',None)
                # CelesTrak's policy requires human investigation after ANY
                # non-200, including redirects; never repeatedly probe it.
                blocked=int(name=='celestrak' and code is not None or code in (401,403) or getattr(error,'authorization_failed',False))
                retry=0
                value=response.headers.get('Retry-After','') if response is not None else ''
                try: retry=max(0,float(value))
                except ValueError:
                    try: retry=max(0,parsedate_to_datetime(value).timestamp()-now)
                    except (ValueError,TypeError,OverflowError): pass
                until=max(until,now+max(retry,min(43200,interval*2**min(failures-1,4)))+self.jitter())
            db.execute('UPDATE budgets SET failures=?,blocked=?,next_at=? WHERE name=?',(failures,blocked,until,name))
    @contextmanager
    def attempt(self,name,interval,cost):
        self.reserve(name,interval,cost)
        try: yield
        except Exception as error:
            self.finish(name,interval,error);raise
        else: self.finish(name,interval)

budget=ProviderBudget()

@contextmanager
def refresh_owner(name='refresh-owner.lock'):
    ROOT.mkdir(parents=True,exist_ok=True)
    handle=open(ROOT/name,'a+b');owned=False
    try:
        handle.seek(0,2)
        if handle.tell()==0: handle.write(b'0');handle.flush()
        handle.seek(0)
        try:
            if os.name=='nt':
                import msvcrt
                msvcrt.locking(handle.fileno(),msvcrt.LK_NBLCK,1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
            owned=True
        except (OSError,BlockingIOError): pass
        yield owned
    finally:
        if owned:
            if os.name=='nt':
                import msvcrt
                handle.seek(0);msvcrt.locking(handle.fileno(),msvcrt.LK_UNLCK,1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(),fcntl.LOCK_UN)
        handle.close()
