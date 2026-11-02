"""Private immutable Supabase Storage objects. Credentials remain server-side."""
import os
import re
from hashlib import sha256
from urllib.parse import urlsplit
import httpx
from services.historical_weather_codec import MAX_BLOB

BUCKET='historical-weather'
KEY=re.compile(r'era5/v1/[0-9]{8}T[0-9]{6}Z/[a-f0-9]{64}\.owwx\Z')


class WeatherStorageUnavailable(RuntimeError): pass


class SnapshotStorage:
    def __init__(self):
        self.url=os.getenv('SUPABASE_URL','').rstrip('/')
        self.key=os.getenv('SUPABASE_SERVICE_ROLE_KEY','') or os.getenv('SUPABASE_SECRET_KEY','')
        parsed=urlsplit(self.url)
        if not self.key or parsed.scheme!='https' or not parsed.hostname or not parsed.hostname.endswith('.supabase.co') or parsed.path or parsed.query or parsed.username:
            raise WeatherStorageUnavailable('Backend Supabase Storage URL and service credential required')
        from sqlalchemy.engine import make_url
        from core.config import required
        database=make_url(required('DATABASE_URL'))
        project=(database.username or '').removeprefix('postgres.') if (database.username or '').startswith('postgres.') else (database.host or '').removeprefix('db.').removesuffix('.supabase.co')
        if parsed.hostname!=project+'.supabase.co': raise WeatherStorageUnavailable('Storage project must match the configured OrbitWatch database')

    def request(self, method, path, **kwargs):
        try:
            with httpx.Client(timeout=20, follow_redirects=False, headers={'Authorization':'Bearer '+self.key,'apikey':self.key}) as client:
                with client.stream(method, self.url+'/storage/v1/'+path, **kwargs) as response:
                    if not response.is_success: raise WeatherStorageUnavailable('Private object storage unavailable')
                    data=bytearray()
                    for chunk in response.iter_bytes():
                        data.extend(chunk)
                        if len(data)>MAX_BLOB: raise WeatherStorageUnavailable('Storage response exceeds bound')
                    return bytes(data)
        except httpx.HTTPError: raise WeatherStorageUnavailable('Private object storage unavailable') from None

    def ensure_bucket(self):
        # A private bucket has no client policies. Only trusted backend service access.
        import json
        try:
            bucket=json.loads(self.request('GET','bucket/'+BUCKET))
        except WeatherStorageUnavailable:
            self.request('POST','bucket',json={'id':BUCKET,'name':BUCKET,'public':False,
                'file_size_limit':MAX_BLOB,'allowed_mime_types':['application/octet-stream']})
            bucket=json.loads(self.request('GET','bucket/'+BUCKET))
        if bucket.get('public') or int(bucket.get('file_size_limit') or 0)>MAX_BLOB or int(bucket.get('file_size_limit') or 0)<=0:
            raise WeatherStorageUnavailable('Bucket policy requires review')

    def get(self,key):
        if not KEY.fullmatch(key): raise ValueError('Invalid object key')
        return self.request('GET','object/authenticated/'+BUCKET+'/'+key)

    def put_verified(self,key,blob):
        if not KEY.fullmatch(key) or not 0<len(blob)<=MAX_BLOB or sha256(blob).hexdigest()!=key.split('/')[-1].split('.')[0]: raise ValueError('Invalid immutable object')
        # A previous completed upload may exist after interruption before DB publish.
        try: existing=self.get(key)
        except WeatherStorageUnavailable: existing=None
        if existing is None:
            self.request('POST','object/'+BUCKET+'/'+key,content=blob,
                headers={'Content-Type':'application/octet-stream','x-upsert':'false','cache-control':'31536000'})
            existing=self.get(key)
        if existing!=blob: raise ValueError('Uploaded object integrity failed')
