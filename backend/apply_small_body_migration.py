"""Explicit, read-only by default. Never imported by API startup.

Apply only after reviewing the target fingerprint and the 200 MB headroom check.
This task does not run this command against any production database.
"""
import argparse
from hashlib import sha256
from pathlib import Path
import json
from sqlalchemy import create_engine,text
from sqlalchemy.engine import make_url
from core.config import required

def run(apply=False,expected=None):
    url=make_url(required('DATABASE_URL'))
    if url.get_backend_name()!='postgresql': raise RuntimeError('PostgreSQL required')
    fingerprint=sha256(f'{url.host}|{url.username}|{url.database}'.encode()).hexdigest()[:16]
    if apply and expected!=fingerprint: raise RuntimeError('Reviewed target fingerprint required')
    engine=create_engine(url,hide_parameters=True,connect_args={'connect_timeout':5,'options':'-c statement_timeout=30000 -c lock_timeout=5000'})
    try:
        with engine.connect() as db:
            db.execute(text('SET TRANSACTION READ ONLY'))
            size=db.scalar(text('SELECT pg_database_size(current_database())'))
            if size>299000000: raise RuntimeError('200 MB nominal free-tier headroom would be at risk')
            result=dict(target_fingerprint=fingerprint,database_bytes=size,remaining_nominal_bytes=500000000-size,applied=False)
        if apply:
            sql=(Path(__file__).parent/'migrations/007_live_small_bodies.sql').read_text()
            with engine.connect().execution_options(isolation_level='AUTOCOMMIT') as db: db.exec_driver_sql(sql)
            result['applied']=True
        return result
    finally: engine.dispose()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');p.add_argument('--expected-target');a=p.parse_args()
    print(json.dumps(run(a.apply,a.expected_target),indent=2))
