"""Licensed adapter contracts: fake WMS/JPEG, disposable shared filesystem only."""
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import os
import sys
import subprocess
import httpx
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'backend'))
from services.infrared import InfraredService,InfraredDisabled,advertised,validate_jpeg,iso,LAYER,MAX_FILES
from services.weather_cache import WeatherCache,WeatherDeferred

# Local structurally framed JPEG fixture; no image decompression is performed.
def jpeg(width):
    return b'\xff\xd8\xff\xc0\x00\x0b\x08'+(width//2).to_bytes(2,'big')+width.to_bytes(2,'big')+b'\x01\x01\x11\x00\xff\xda\x00\x08\x01\x01\x00\x00\x3f\x00\x01\xff\xd9'

now=[1794355200.0]; calls=[]; fail=[False]
xml=f'<WMS_Capabilities><Layer><Name>{LAYER}</Name><Dimension name="time">{iso(now[0]-10800)}/{iso(now[0])}/PT3H</Dimension></Layer></WMS_Capabilities>'.encode()
def handler(request):
    assert str(request.url).startswith('https://view.eumetsat.int/geoserver/wms?')
    calls.append(request)
    if fail[0]: return httpx.Response(429,headers={'Retry-After':'600'})
    if request.url.params['request']=='GetCapabilities': return httpx.Response(200,headers={'Content-Type':'text/xml'},content=xml)
    assert request.url.params['layers']==LAYER and request.url.params['bbox']=='-180,-90,180,90'
    width=int(request.url.params['width'])
    return httpx.Response(200,headers={'Content-Type':'image/jpeg'},content=jpeg(width))

with TemporaryDirectory(dir=ROOT/'.setup-cache') as tmp:
    root=Path(tmp)/'ir'
    service=InfraredService(root,lambda:now[0],lambda **kwargs:httpx.Client(transport=httpx.MockTransport(handler),**kwargs))
    with patch.dict(os.environ,{'ORBITWATCH_INFRARED_ENABLED':'false','ORBITWATCH_INFRARED_LICENSE_CONFIRMED':'false'}):
        for action in [service.slots,lambda:service.frame(iso(now[0]))]:
            try: action()
            except InfraredDisabled: pass
            else: raise AssertionError('Unlicensed retrieval allowed')
        assert not root.exists() and not calls
    with patch.dict(os.environ,{'ORBITWATCH_INFRARED_ENABLED':'true','ORBITWATCH_INFRARED_LICENSE_CONFIRMED':'true','ORBITWATCH_WEATHER_PROVIDER_REQUESTS':'true'}):
        slots=service.slots();assert len(slots['times'])==2 and len(calls)==1
        observation=slots['times'][-1]
        now[0]+=61 # shared per-layer minute gate includes capabilities and maps
        data,info=service.frame(observation);validate_jpeg(data,1024)
        assert not info['stale'] and info['time']==observation and len(calls)==2
        restarted=InfraredService(root,lambda:now[0],client=lambda **_: (_ for _ in ()).throw(AssertionError('cache must not download')))
        assert restarted.frame(observation)[0]==data
        # Simulate existing full storage plus a crash-left partial write. The
        # next distinct frame must stay under the file cap and clear the orphan.
        for i in range(8):
            old=root/f'{i:064x}.jpg';old.write_bytes(jpeg(1024));os.utime(old,(1,1))
        (root/('f'*64+'.part')).write_bytes(b'partial')
        now[0]+=61;service.frame(observation,2048)
        assert len(list(root.glob('*.jpg')))<=MAX_FILES and not list(root.glob('*.part'))
        with WeatherCache(root).lease('infrared') as first:
            with WeatherCache(root).lease('infrared') as second: assert first and not second
            child="import sys;sys.path.insert(0,sys.argv[1]);from services.weather_cache import WeatherCache\nwith WeatherCache(sys.argv[2]).lease('infrared') as owned: assert not owned"
            subprocess.run([sys.executable,'-c',child,str(ROOT/'backend'),str(root)],check=True,timeout=30,capture_output=True)
            assert restarted.frame(observation)[0]==data # reads do not wait for writer
        for invalid,width in [('https://evil.invalid',1024),(observation,4096),(iso(now[0]+10800),1024)]:
            try: service.frame(invalid,width)
            except ValueError: pass
            else: raise AssertionError('Unallowlisted frame accepted')
        now[0]+=901;fail[0]=True
        failed_count=len(calls)+1
        assert service.slots()['stale'] and len(calls)==failed_count
        assert service.slots()['stale'] and len(calls)==failed_count # persistent Retry-After
        assert restarted.frame(observation)[0]==data
        now[0]+=43201
        try: service.slots()
        except WeatherDeferred: pass
        else: raise AssertionError('Hard expired slots accepted')
        assert len(list(root.glob('*.jpg')))<=MAX_FILES
    with WeatherCache(root).lease('noaa') as noaa:
        with WeatherCache(root).lease('open_meteo') as local: assert noaa and local
for bad in [b'<xml/>',b'<!DOCTYPE x><xml/>']:
    try: advertised(bad,now[0])
    except ValueError: pass
    else: raise AssertionError('Invalid metadata accepted')
for bad in [b'',b'not an image',jpeg(2048),jpeg(1024)[:-2]]:
    try: validate_jpeg(bad,1024)
    except ValueError: pass
    else: raise AssertionError('Invalid JPEG accepted')
print('PASS disabled license gates/no filesystem or HTTP, allowlist, timestamps, JPEG, persistent cache/locks, stale/hard-expiry, Retry-After, independent provider leases; mocked HTTP only')
