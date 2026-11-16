"""Licensed EUMHD-19074 exact-layer IR adapter. No HTTP or cache access until BOTH gates are set.

Rendered JPEGs only; this is not calibrated brightness temperature/cloud fraction.
One same-host filesystem lease covers metadata and images. Never use independent
cache volumes on API hosts to multiply these provider budgets.
"""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import math
import os
import time
import xml.etree.ElementTree as ET
import httpx
from services.weather_cache import WeatherCache, WeatherDeferred

SOURCE = 'https://view.eumetsat.int/geoserver/wms'
LAYER = 'mumi:worldcloudmap_ir108'
ATTRIBUTION = 'This service is based on EUMETSAT EUMETView infrared cloud imagery. EUMETSAT / NOAA / JMA. Licensed under CC BY 4.0.'
LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/'
INFORMATION = 'https://view.eumetsat.int/productviewer/productDetails/mumi%3Aworldcloudmap_ir108'
MAX_IMAGE = 8000000
MAX_FILES = 8
MAX_AGE = 43200


class InfraredDisabled(WeatherDeferred):
    pass


def require_license():
    if not all(os.getenv(key, 'false').lower() == 'true' for key in
               ('ORBITWATCH_INFRARED_ENABLED', 'ORBITWATCH_INFRARED_LICENSE_CONFIRMED')):
        raise InfraredDisabled('Infrared redistribution is disabled by server configuration')


def timestamp(value):
    if not isinstance(value, str) or len(value)>32: raise ValueError('Invalid observation time')
    stamp = datetime.fromisoformat(value.replace('Z','+00:00'))
    if stamp.tzinfo is None: raise ValueError('UTC observation time required')
    return stamp.timestamp()


def iso(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat().replace('+00:00','Z')


def advertised(xml, now):
    if len(xml)>1000000 or b'\x00' in xml or b'<!DOCTYPE' in xml.upper() or b'<!ENTITY' in xml.upper():
        raise ValueError('Invalid infrared capabilities')
    root = ET.fromstring(xml.decode('utf-8-sig'))
    local = lambda tag: tag.rsplit('}',1)[-1]
    layer = next((node for node in root.iter() if local(node.tag)=='Layer' and
                  any(local(child.tag)=='Name' and child.text==LAYER for child in node)), None)
    if layer is None: raise ValueError('Allowed IR layer unavailable')
    dimension = next((child for child in layer if local(child.tag) in {'Dimension','Extent'} and child.get('name')=='time'), None)
    slots = set()
    for item in (dimension.text or '').split(',') if dimension is not None else []:
        parts = item.strip().split('/')
        try:
            first = timestamp(parts[0])
            if len(parts)==1: candidates = [first]
            elif len(parts)==3 and parts[2]=='PT3H':
                last = min(timestamp(parts[1]),now)
                top = first + int((last-first)//10800)*10800
                candidates = [top-i*10800 for i in range(4) if top-i*10800>=first]
            else: continue
            slots.update(t for t in candidates if now-MAX_AGE<=t<=now)
        except (ValueError, OverflowError): continue
    if not slots: raise ValueError('No recent advertised IR observations')
    return [iso(t) for t in sorted(slots)[-4:]]


def validate_jpeg(data, width, height=None):
    height = height or width//2
    # Validate framing/dimensions without allocating a decompressed image on EC2.
    if not 4<len(data)<=MAX_IMAGE or data[:2]!=b'\xff\xd8' or data[-2:]!=b'\xff\xd9':
        raise ValueError('Invalid infrared JPEG')
    offset = 2
    while offset+4<=len(data):
        if data[offset]!=255: raise ValueError('Invalid JPEG marker')
        while offset<len(data) and data[offset]==255: offset+=1
        if offset>=len(data): break
        marker=data[offset];offset+=1
        if marker in {0xd9,0xda}: break
        size=int.from_bytes(data[offset:offset+2],'big')
        if size<2 or offset+size>len(data): raise ValueError('Invalid JPEG segment')
        if marker in {0xc0,0xc1,0xc2}:
            if size<8 or data[offset+2]!=8 or int.from_bytes(data[offset+3:offset+5],'big')!=height or int.from_bytes(data[offset+5:offset+7],'big')!=width or data[offset+7] not in {1,3}:
                raise ValueError('Unexpected infrared dimensions')
            return
        offset+=size
    raise ValueError('Missing JPEG frame')


class InfraredCache(WeatherCache):
    def policy(self, provider):
        # Helpdesk guidance: one shared per-layer request/minute across BOTH
        # GetCapabilities and GetMap, not separate burstable provider buckets.
        return (60,24,160)


class InfraredService:
    def __init__(self, root=None, clock=time.time, client=httpx.Client):
        self.cache=InfraredCache(root or os.getenv('ORBITWATCH_INFRARED_CACHE_DIR') or Path(__file__).resolve().parents[1]/'.runtime'/'infrared', clock)
        self.clock=clock; self.client=client

    def retrieve(self, params, limit, mime):
        if os.getenv('ORBITWATCH_WEATHER_PROVIDER_REQUESTS', 'true').lower() != 'true':
            raise WeatherDeferred()
        started=time.monotonic(); chunks=[]; size=0
        with self.client(timeout=httpx.Timeout(20,connect=5),follow_redirects=False) as client:
            with client.stream('GET',SOURCE,params=params) as response:
                response.raise_for_status()
                if not response.headers.get('Content-Type','').split(';')[0].strip().lower() in mime:
                    raise ValueError('Unexpected infrared content type')
                if int(response.headers.get('Content-Length','0'))>limit: raise ValueError('Infrared response too large')
                for chunk in response.iter_bytes(65536):
                    size+=len(chunk)
                    if size>limit or time.monotonic()-started>30: raise ValueError('Infrared transfer limit exceeded')
                    chunks.append(chunk)
        return b''.join(chunks)

    def _source_slots(self, force=False):
        require_license()
        cached=self.cache.get('capabilities'); now=self.clock()
        if os.getenv('ORBITWATCH_WEATHER_PROVIDER_REQUESTS','true').lower()!='true':
            if cached: return self.describe(cached,now-cached['checked_at']>=3600)
            raise WeatherDeferred()
        if cached and not force and now-cached['checked_at']<3600:
            return self.describe(cached)
        try:
            with self.cache.lease('infrared') as owned:
                if not owned: raise WeatherDeferred()
                latest=self.cache.get('capabilities')
                if latest and not force and now-latest['checked_at']<3600: return self.describe(latest)
                self.cache.reserve('eumetsat_layer')
                try:
                    xml=self.retrieve(dict(service='WMS',version='1.3.0',request='GetCapabilities'),1000000,{'text/xml','application/xml'})
                    value=dict(times=advertised(xml,now),checked_at=now)
                    self.cache.put('capabilities','infrared_metadata',value);self.cache.succeeded('eumetsat_layer')
                    return self.describe(value)
                except Exception as error:
                    self.cache.failed('eumetsat_layer',error);raise WeatherDeferred() from None
        except WeatherDeferred:
            if cached and now-cached['checked_at']<=MAX_AGE: return self.describe(cached,True)
            raise

    def describe(self, value, stale=False):
        times=[t for t in value['times'] if 0<=self.clock()-timestamp(t)<=MAX_AGE]
        if not times: raise WeatherDeferred()
        return dict(times=times, retrieved_at=iso(value['checked_at']), stale=stale or self.clock()-value['checked_at']>=3600,
                    attribution=ATTRIBUTION, layer=LAYER, widths=[1024,2048], source_kind='infrared_observation')

    def geometry(self, width, bounds=None, height=None):
        if width not in (1024,2048): raise ValueError('Allowed IR widths: 1024, 2048')
        if bounds is None: return None, width//2
        if len(bounds)!=4 or any(not isinstance(v,(int,float)) or not math.isfinite(v) for v in bounds): raise ValueError('Invalid bounds')
        w,s,e,n=bounds
        # Quantized regional cells only, no antimeridian/polar extrapolation.
        if not (-180<=w<e<=180 and -80<=s<n<=80 and e-w<=130 and n-s<=110 and all(v%2==0 for v in bounds)): raise ValueError('Invalid regional bounds')
        expected=max(128,min(2048,round(width*(n-s)/(e-w))))
        if height is not None and height!=expected: raise ValueError('Invalid regional height')
        return bounds,expected

    def key(self, observation, width, bounds=None):
        return hashlib.sha256(f'{LAYER}:{observation}:{width}:{bounds or "global"}'.encode()).hexdigest()

    def slots(self):
        require_license()
        pair = self.cache.get('ready_pair')
        if not pair or not 0 <= self.clock()-timestamp(pair['time']) <= MAX_AGE:
            raise WeatherDeferred()
        result=self.describe(dict(times=[pair['time']], checked_at=pair['checked_at']))
        result['stale']=self.clock()-timestamp(pair['time'])>21600
        return result

    def current(self, width=1024):
        require_license()
        self.geometry(width)
        source=self.slots();observation=source['times'][-1]
        pair=self.cache.get('ready_pair')
        key=pair['variants'][str(width)];info=self.cache.get(key)
        cached=bool(info and (self.cache.root/f'{key}.png').is_file())
        if not cached: raise WeatherDeferred()
        gate=self.cache.gate('eumetsat_layer')
        return dict(state='stale' if source['stale'] or self.clock()-timestamp(observation)>21600 else 'available',
            source='EUMETSAT EUMETView',layer=LAYER,source_kind='infrared_observation',
            observation_time=observation,retrieved_at=info['retrieved_at'] if cached else None,
            version=key,etag=f'"{key}"',width=width,height=width//2,image_cached=cached,
            image_url=f'/api/weather/infrared/frame?time={observation}&width={width}',
            coverage='Geostationary composite; polar gaps, seams and cold-surface ambiguity',
            attribution=ATTRIBUTION,license_url=LICENSE_URL,source_url=INFORMATION,
            attribution_year=datetime.fromtimestamp(timestamp(observation),timezone.utc).year,
            transformation='IR brightness-to-opacity cold-cloud emphasis; not cloud fraction or temperature',
            stale=source['stale'] or self.clock()-timestamp(observation)>21600,
            expires_at=iso(timestamp(observation)+MAX_AGE),retry_after_seconds=max(300,gate['retry_after_seconds']))

    def frame(self, observation, width=1024, bounds=None, height=None):
        # Public readers never reserve provider budget or initiate conversion.
        require_license()
        self.geometry(width,bounds,height)
        if bounds is not None: raise WeatherDeferred()
        stamp=timestamp(observation)
        if not 0<=self.clock()-stamp<=MAX_AGE: raise WeatherDeferred()
        key=hashlib.sha256(('prepared-v1:'+self.key(iso(stamp),width)).encode()).hexdigest()
        pair=self.cache.get('ready_pair')
        published=self.cache.get('published:'+iso(stamp))
        if not (pair and pair['time']==iso(stamp) or published): raise WeatherDeferred()
        info=self.cache.get(key);path=self.cache.root/f'{key}.png'
        if not info or not path.is_file(): raise WeatherDeferred()
        data=path.read_bytes()
        if len(data)>MAX_IMAGE or data[:8]!=b'\x89PNG\r\n\x1a\n' or hashlib.sha256(data).hexdigest()!=info.get('content_sha256'): raise WeatherDeferred()
        return data,{**info,'stale':self.clock()-stamp>21600}

    def refresh_pair(self):
        """Scheduler-only publication: keep the old manifest until BOTH decode."""
        require_license()
        if os.getenv('ORBITWATCH_WEATHER_PROVIDER_REQUESTS','true').lower()!='true': return
        now=self.clock()
        with self.cache.lease('download') as owned:
            if not owned: return
            schedule=self.cache.get('pair_schedule') or {}
            if schedule.get('next_at',0)>now:
                ready=self.cache.get('ready_pair')
                if not ready or not 0<=now-timestamp(ready['time'])<=MAX_AGE:return
                try:
                    for width in (1024,2048):self.frame(ready['time'],width)
                except (WeatherDeferred,OSError):pass
                else:return
            slot=int((now-1200)//10800)*10800
            attempts=schedule.get('attempts',0) if schedule.get('slot')==slot else 0
            # Late slots get twelve bounded checks, then wait for the next window.
            next_at=slot+10800+1200 if attempts>=11 else now+300
            self.cache.put('pair_schedule','infrared_schedule',dict(slot=slot,attempts=attempts+1,next_at=next_at))
            previous=self.cache.get('ready_pair')
            advertised_cache=self.cache.get('capabilities')
            pending=advertised_cache and (not previous or advertised_cache['times'][-1]>previous['time'])
            source=self._source_slots(force=not pending);observation=source['times'][-1]
            if previous and previous['time']==observation:
                try:
                    for width in (1024,2048): self.frame(observation,width)
                except (WeatherDeferred,OSError): pass
                else:
                    if timestamp(observation)>=slot:
                        self.cache.put('pair_schedule','infrared_schedule',dict(slot=slot,attempts=0,next_at=slot+10800+1200))
                    return
            data,info=self._acquire_frame(observation,2048)
            from PIL import Image
            from io import BytesIO
            try:
                with Image.open(BytesIO(data)) as source:
                    source.load()
                    if source.size!=(2048,1024): raise ValueError('Invalid source dimensions')
            except (OSError,ValueError):
                (self.cache.root/f'{info["version"]}.jpg').unlink(missing_ok=True)
                with self.cache.db() as db:db.execute('DELETE FROM data WHERE key=?',(info['version'],))
                raise WeatherDeferred() from None
            import numpy as np
            variants={}
            with Image.open(BytesIO(data)) as image:
                image.load()
                if image.size!=(2048,1024): raise ValueError('Invalid source dimensions')
                for width in (1024,2048):
                    rgb=np.asarray(image.convert('RGB').resize((width,width//2),Image.Resampling.LANCZOS),dtype=np.float64)
                    t=np.clip((rgb.mean(axis=2)-85)/170,0,1)
                    rgba=np.empty((width//2,width,4),dtype=np.uint8)
                    rgba[:,:,:3]=np.floor(210+45*t[:,:,None]+.5).astype(np.uint8)
                    rgba[:,:,3]=np.floor(255*np.power(t,1.05)+.5).astype(np.uint8)
                    output=BytesIO();Image.fromarray(rgba).save(output,format='PNG')
                    prepared=output.getvalue()
                    if len(prepared)>MAX_IMAGE: raise ValueError('Prepared frame too large')
                    with Image.open(BytesIO(prepared)) as check:
                        check.load()
                        if check.size!=(width,width//2) or check.mode!='RGBA': raise ValueError('Invalid prepared frame')
                    key=hashlib.sha256(('prepared-v1:'+self.key(observation,width)).encode()).hexdigest()
                    path=self.cache.root/f'{key}.png';temp=path.with_suffix('.part')
                    try: temp.write_bytes(prepared);os.replace(temp,path)
                    finally: temp.unlink(missing_ok=True)
                    self.cache.put(key,'infrared_prepared',{**info,'width':width,'height':width//2,'version':key,'content_sha256':hashlib.sha256(prepared).hexdigest()})
                    variants[str(width)]=key
            # The manifest is a single SQLite transaction; file names immutable.
            if previous:
                self.cache.put('published:'+previous['time'],'infrared_published',previous)
            self.cache.put('ready_pair','infrared_pair',dict(time=observation,checked_at=now,variants=variants))
            for path in self.cache.root.glob('*.png'):
                old=self.cache.get(path.stem)
                if path.stem not in variants.values() and (not old or now-timestamp(old['time'])>MAX_AGE): path.unlink(missing_ok=True)
            if timestamp(observation)>=slot:
                self.cache.put('pair_schedule','infrared_schedule',dict(slot=slot,attempts=0,next_at=slot+10800+1200))

    def _acquire_frame(self, observation, width=1024, bounds=None, height=None):
        require_license()
        bounds,height=self.geometry(width,bounds,height)
        stamp=timestamp(observation); observation=iso(stamp)
        if not 0<=self.clock()-stamp<=MAX_AGE: raise ValueError('Observation outside allowed window')
        key=self.key(observation,width,bounds)
        path=self.cache.root/f'{key}.jpg'
        # Immutable source times: repeated visitors do not trigger revalidation.
        def cached():
            info=self.cache.get(key)
            if info and path.is_file() and path.stat().st_size<=MAX_IMAGE:
                data=path.read_bytes();validate_jpeg(data,width,height)
                return data,{**info,'stale':self.clock()-stamp>21600}
        try:
            value=cached()
            if value: return value
        except (ValueError,OSError): pass
        if os.getenv('ORBITWATCH_WEATHER_PROVIDER_REQUESTS','true').lower()!='true': raise WeatherDeferred()
        times=self._source_slots()['times']
        if observation!=times[-1]: raise ValueError('Only the current IR observation may be acquired')
        with self.cache.lease('infrared') as owned:
            if not owned: raise WeatherDeferred()
            try:
                value=cached()
                if value: return value
            except (ValueError,OSError): pass
            self.cache.reserve('eumetsat_layer')
            try:
                data=self.retrieve(dict(service='WMS',version='1.1.1',request='GetMap',layers=LAYER,styles='',
                    format='image/jpeg',bgcolor='0x000000',srs='EPSG:4326',bbox=','.join(str(v) for v in bounds) if bounds else '-180,-90,180,90',
                    width=str(width),height=str(height),time=observation),MAX_IMAGE,{'image/jpeg'})
                validate_jpeg(data,width,height)
                # Fixed generated filenames only; prune before atomic publication.
                for orphan in self.cache.root.glob('[0-9a-f]'*64+'.part'): orphan.unlink(missing_ok=True)
                files=sorted(self.cache.root.glob('[0-9a-f]'*64+'.jpg'),key=lambda p:p.stat().st_mtime)
                while len(files)>=MAX_FILES:
                    oldest=files.pop(0);oldest.unlink(missing_ok=True)
                    with self.cache.db() as db: db.execute('DELETE FROM data WHERE key=?',(oldest.stem,))
                temp=path.with_suffix('.part')
                try: temp.write_bytes(data);os.replace(temp,path)
                finally: temp.unlink(missing_ok=True)
                info=dict(time=observation,retrieved_at=iso(self.clock()),attribution=ATTRIBUTION,width=width,height=height,bounds=bounds,version=key)
                self.cache.put(key,'infrared_frame',info);self.cache.succeeded('eumetsat_layer')
                return data,{**info,'stale':self.clock()-stamp>21600}
            except Exception as error:
                self.cache.failed('eumetsat_layer',error);raise WeatherDeferred() from None


infrared=InfraredService()
