"""Explicit same-host operational setup; credentials never leave this process.

No rotation: partial/mismatched existing credentials require recovery/review.
Default prints readiness only. --configure requires the reviewed DB fingerprint.
"""
import argparse,base64,json,os,socket,stat,tempfile
from hashlib import sha256
from pathlib import Path
from dotenv import dotenv_values
from sqlalchemy import create_engine,text
from sqlalchemy.engine import make_url
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
from core.config import required

KEYS=('ORBITWATCH_VAPID_PRIVATE_KEY','ORBITWATCH_VAPID_PUBLIC_KEY','ORBITWATCH_VAPID_SUBJECT','ORBITWATCH_PUSH_ENCRYPTION_KEY')

def run(configure=False,expected=None):
    env=Path(__file__).resolve().parent/'.env'
    values=dotenv_values(env);url=make_url(required('DATABASE_URL'))
    fingerprint=sha256(f'{url.host}|{url.username}|{url.database}'.encode()).hexdigest()[:16]
    if not url.host or not url.host.endswith(('.supabase.com','.supabase.co')):raise RuntimeError('Existing Supabase target required')
    if configure and expected!=fingerprint:raise RuntimeError('Reviewed database target required')
    engine=create_engine(url,hide_parameters=True,connect_args={'connect_timeout':5,'options':'-c default_transaction_read_only=on -c statement_timeout=8000'})
    try:
        with engine.connect() as db:
            devices=db.scalar(text('SELECT count(*) FROM account_push_devices'))
            database_bytes=db.scalar(text('SELECT pg_database_size(current_database())'))
    finally:engine.dispose()
    if database_bytes>=299000000:raise RuntimeError('Storage reserve at risk')
    from services.browser_push import configuration
    missing=[key for key in KEYS if not os.getenv(key)]
    changed={}
    if configure:
        if missing:
            if len(missing)!=len(KEYS) or devices:raise RuntimeError('Existing keys/device data require recovery; refusing automatic rotation')
            key=ec.generate_private_key(ec.SECP256R1())
            def encoded(value):return base64.urlsafe_b64encode(value).decode().rstrip('=')
            changed={KEYS[0]:encoded(key.private_bytes(serialization.Encoding.DER,serialization.PrivateFormat.PKCS8,serialization.NoEncryption())),
                     KEYS[1]:encoded(key.public_key().public_bytes(serialization.Encoding.X962,serialization.PublicFormat.UncompressedPoint)),
                     KEYS[2]:'https://github.com/TUF-SCAR/OrbitWatch',KEYS[3]:Fernet.generate_key().decode()}
        elif not configuration():raise RuntimeError('Existing VAPID/encryption configuration invalid; refusing rotation')
        cache=Path(values.get('ORBITWATCH_WEATHER_CACHE_DIR') or Path(__file__).resolve().parent/'.runtime/weather').resolve()
        from services.weather_cache import WeatherCache
        with WeatherCache(cache).db():pass # Shared host cache schema only, no provider calls.
        changed.update(ORBITWATCH_NOTIFICATION_PROVIDER_REQUESTS='true',ORBITWATCH_NOTIFICATION_HOST_ID=sha256((socket.gethostname()+'|'+str(cache)).encode()).hexdigest()[:16])
        changed={key:value for key,value in changed.items() if values.get(key)!=value}
        if changed:
            mode=stat.S_IMODE(env.stat().st_mode)
            if mode&0o077:raise RuntimeError('Environment must be private before installing credentials')
            # Keep every unrelated setting verbatim. Replace only this service's keys.
            content=env.read_text();lines=[line for line in content.splitlines() if line.partition('=')[0].strip() not in changed]
            lines.extend(f'{key}={value}' for key,value in changed.items())
            fd,path=tempfile.mkstemp(prefix='.notifications-',dir=env.parent)
            try:
                os.fchmod(fd,0o600)
                with os.fdopen(fd,'w') as file:file.write('\n'.join(lines)+'\n');file.flush();os.fsync(file.fileno())
                os.replace(path,env)
            finally:
                if os.path.exists(path):os.unlink(path)
            os.environ.update(changed)
    return {'target_fingerprint':fingerprint,'configured':bool(configuration()),'keys_generated':configure and bool(missing),'existing_devices':devices,'database_bytes':database_bytes,'changed_setting_names':list(changed)}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--configure',action='store_true');parser.add_argument('--expected-target');args=parser.parse_args()
    try:print(json.dumps(run(args.configure,args.expected_target)))
    except Exception as error:print(json.dumps({'state':'failed','reason':str(error) if isinstance(error,RuntimeError) else type(error).__name__}));raise SystemExit(1)
