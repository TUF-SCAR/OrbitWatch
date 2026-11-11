"""Future licensed IR adapter. No HTTP or cache access until BOTH gates are set.

Rendered JPEGs only; this is not calibrated brightness temperature/cloud fraction.
One same-host filesystem lease covers metadata and images. Never use independent
cache volumes on API hosts to multiply these provider budgets.
"""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import os
import time
import xml.etree.ElementTree as ET
import httpx
from services.weather_cache import WeatherCache, WeatherDeferred

SOURCE = 'https://view.eumetsat.int/geoserver/wms'
LAYER = 'mumi:worldcloudmap_ir108'
ATTRIBUTION = 'EUMETSAT / NOAA / JMA · rendered IR 10.8 μm composite'
MAX_IMAGE = 8000000
MAX_FILES = 8
MAX_AGE = 43200


class InfraredDisabled(WeatherDeferred):
    pass


def require_license():
    if not all(os.getenv(key, 'false').lower() == 'true' for key in
               ('ORBITWATCH_INFRARED_ENABLED', 'ORBITWATCH_INFRARED_LICENSE_CONFIRMED')):
        raise InfraredDisabled('Infrared redistribution is disabled pending exact-layer licensing approval')
    if os.getenv('ORBITWATCH_WEATHER_PROVIDER_REQUESTS', 'true').lower() != 'true':
        raise WeatherDeferred()


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


def validate_jpeg(data, width):
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
            if size<8 or data[offset+2]!=8 or int.from_bytes(data[offset+3:offset+5],'big')!=width//2 or int.from_bytes(data[offset+5:offset+7],'big')!=width or data[offset+7] not in {1,3}:
                raise ValueError('Unexpected infrared dimensions')
            return
        offset+=size
    raise ValueError('Missing JPEG frame')


class InfraredCache(WeatherCache):
    def policy(self, provider):
        return (900,4,96) if provider=='eumetsat_metadata' else (2,24,160)


class InfraredService:
    def __init__(self, root=None, clock=time.time, client=httpx.Client):
        self.cache=InfraredCache(root or os.getenv('ORBITWATCH_INFRARED_CACHE_DIR') or Path(__file__).resolve().parents[1]/'.runtime'/'infrared', clock)
        self.clock=clock; self.client=client

    def retrieve(self, params, limit, mime):
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

    def slots(self):
        require_license()
        cached=self.cache.get('capabilities'); now=self.clock()
        if cached and now-cached['checked_at']<900:
            return self.describe(cached)
        try:
            with self.cache.lease('infrared') as owned:
                if not owned: raise WeatherDeferred()
                latest=self.cache.get('capabilities')
                if latest and now-latest['checked_at']<900: return self.describe(latest)
                self.cache.reserve('eumetsat_metadata')
                try:
                    xml=self.retrieve(dict(service='WMS',version='1.3.0',request='GetCapabilities'),1000000,{'text/xml','application/xml'})
                    value=dict(times=advertised(xml,now),checked_at=now)
                    self.cache.put('capabilities','infrared_metadata',value);self.cache.succeeded('eumetsat_metadata')
                    return self.describe(value)
                except Exception as error:
                    self.cache.failed('eumetsat_metadata',error);raise WeatherDeferred() from None
        except WeatherDeferred:
            if cached and now-cached['checked_at']<=MAX_AGE: return self.describe(cached,True)
            raise

    def describe(self, value, stale=False):
        times=[t for t in value['times'] if 0<=self.clock()-timestamp(t)<=MAX_AGE]
        if not times: raise WeatherDeferred()
        return dict(times=times, retrieved_at=iso(value['checked_at']), stale=stale or self.clock()-value['checked_at']>=900,
                    attribution=ATTRIBUTION, layer=LAYER, widths=[1024,2048], source_kind='infrared_observation')

    def frame(self, observation, width=1024):
        require_license()
        if width not in (1024,2048): raise ValueError('Allowed IR widths: 1024, 2048')
        stamp=timestamp(observation); observation=iso(stamp)
        if not 0<=self.clock()-stamp<=MAX_AGE: raise ValueError('Observation outside allowed window')
        key=hashlib.sha256(f'{LAYER}:{observation}:{width}'.encode()).hexdigest()
        path=self.cache.root/f'{key}.jpg'
        # Immutable source times: repeated visitors do not trigger revalidation.
        def cached():
            info=self.cache.get(key)
            if info and path.is_file() and path.stat().st_size<=MAX_IMAGE:
                data=path.read_bytes();validate_jpeg(data,width)
                return data,{**info,'stale':self.clock()-stamp>21600}
        try:
            value=cached()
            if value: return value
        except (ValueError,OSError): pass
        times=self.slots()['times']
        if observation not in times: raise ValueError('IR time not advertised')
        with self.cache.lease('infrared') as owned:
            if not owned: raise WeatherDeferred()
            try:
                value=cached()
                if value: return value
            except (ValueError,OSError): pass
            self.cache.reserve('eumetsat_images')
            try:
                data=self.retrieve(dict(service='WMS',version='1.1.1',request='GetMap',layers=LAYER,styles='',
                    format='image/jpeg',bgcolor='0x000000',srs='EPSG:4326',bbox='-180,-90,180,90',
                    width=str(width),height=str(width//2),time=observation),MAX_IMAGE,{'image/jpeg'})
                validate_jpeg(data,width)
                # Fixed generated filenames only; prune before atomic publication.
                for orphan in self.cache.root.glob('[0-9a-f]'*64+'.part'): orphan.unlink(missing_ok=True)
                files=sorted(self.cache.root.glob('[0-9a-f]'*64+'.jpg'),key=lambda p:p.stat().st_mtime)
                while len(files)>=MAX_FILES:
                    oldest=files.pop(0);oldest.unlink(missing_ok=True)
                    with self.cache.db() as db: db.execute('DELETE FROM data WHERE key=?',(oldest.stem,))
                temp=path.with_suffix('.part')
                try: temp.write_bytes(data);os.replace(temp,path)
                finally: temp.unlink(missing_ok=True)
                info=dict(time=observation,retrieved_at=iso(self.clock()),attribution=ATTRIBUTION,width=width,height=width//2)
                self.cache.put(key,'infrared_frame',info);self.cache.succeeded('eumetsat_images')
                return data,{**info,'stale':self.clock()-stamp>21600}
            except Exception as error:
                self.cache.failed('eumetsat_images',error);raise WeatherDeferred() from None


infrared=InfraredService()
