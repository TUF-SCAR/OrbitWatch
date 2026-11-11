"""Real ecCodes flags; generated local fields, no HTTP or database access."""
from datetime import datetime,timezone
from pathlib import Path
import sys
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT/'backend'),str(ROOT/'tests')]
from check_weather import fixture_bundle,fixture_grib
from services.weather_fields import decode_fields
from eccodes import codes_new_from_message,codes_set,codes_set_values,codes_get_message,codes_release

now=datetime(2026,11,11,0,tzinfo=timezone.utc)
base=fixture_bundle(now)

def flag(param,values,**overrides):
    h=codes_new_from_message(fixture_grib(now))
    try:
        for key,value in {'centre':'kwbc','discipline':0,'parameterCategory':1,'parameterNumber':param,
                          'typeOfLevel':'surface','level':0,**overrides}.items(): codes_set(h,key,value)
        codes_set_values(h,np.full(65160,values) if np.isscalar(values) else values)
        return codes_get_message(h)
    finally: codes_release(h)

for params in [(33,34,35,36),(192,193,194,195)]:
    for i,expected in enumerate(['rain','freezing_rain','ice_pellets','snow']):
        result=decode_fields(base+b''.join(flag(param,int(j==i)) for j,param in enumerate(params)),'LOCAL',now)
        assert set(result['precipitation_phase']['values'])=={expected}
        assert result['precipitation_phase']['valid_at']==result['valid_at']
    mixed=decode_fields(base+b''.join(flag(p,int(j in (0,3))) for j,p in enumerate(params)),'LOCAL',now)
    assert set(mixed['precipitation_phase']['values'])=={'mixed'}
    unknown=decode_fields(base+b''.join(flag(p,0) for p in params),'LOCAL',now)
    assert set(unknown['precipitation_phase']['values'])=={'unknown'}
assert decode_fields(base,'LOCAL',now)['precipitation_phase_status']=='unavailable'
good=b''.join(flag(p,int(p==36)) for p in (33,34,35,36))
for extra in [flag(36,1),flag(36,.5),flag(36,1,step=3)]:
    result=decode_fields(base+good+extra,'LOCAL',now)
    assert result['precipitation_phase_status']=='unavailable' and 'precipitation_phase' not in result
# Average categorical flags are not instantaneous probabilities or phases.
average=flag(36,1,stepType='avg',startStep=0,endStep=3)
assert decode_fields(base+average,'LOCAL',now)['precipitation_phase_status']=='unavailable'
missing=np.ones(65160);missing[0]=9999
masked=decode_fields(base+b''.join(flag(p,0) for p in (33,34,35))+flag(36,missing,bitmapPresent=1,missingValue=9999),'LOCAL',now)
assert masked['precipitation_phase']['values'][180]=='unknown' and masked['precipitation_phase']['values'][181]=='snow'
print('PASS NOAA standard/local flag identities, four phases, mixed/unknown, duplicate/fraction/time/average isolation; HTTP0')
