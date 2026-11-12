"""Recorded real NOMADS categorical GRIB + clearly synthetic matching core fields.

No HTTP, database, .env, or provider acquisition. Unlike generated-GRIB checks,
this verifies ecCodes aliases/units/levels/times from the actual public product.
"""
from datetime import datetime,timezone
from pathlib import Path
import sys
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT/'backend'),str(ROOT/'tests')]
from check_weather import fixture_bundle
from services.weather_fields import decode_fields
from eccodes import codes_new_from_message,codes_get,codes_get_values,codes_get_array,codes_set,codes_get_message,codes_release

def messages(data):
    while data:
        size=int.from_bytes(data[8:16],'big')
        assert data[:4]==b'GRIB' and 20<=size<=len(data)
        yield data[:size];data=data[size:]

recorded=(ROOT/'tests/fixtures/noaa-gfs-phase.grib2').read_bytes()
flags={};instant=average=0
for message in messages(recorded):
    h=codes_new_from_message(message)
    try:
        get=lambda key:codes_get(h,key)
        assert get('units')=='(Code table 4.222)' and get('typeOfLevel')=='surface' and get('level')==0
        assert get('centre')=='kwbc' and get('discipline')==0 and get('parameterCategory')==1
        name={192:'rain',193:'freezing_rain',194:'ice_pellets',195:'snow'}[get('parameterNumber')]
        assert get('shortName')=={'rain':'crain','snow':'csnow','ice_pellets':'cicep','freezing_rain':'cfrzr'}[name]
        assert get('dataDate')==20261111 and get('dataTime')==600
        assert get('validityDate')==20261111 and get('validityTime')==1500
        values=np.asarray(codes_get_values(h));assert set(np.unique(values))<={0,1}
        if get('stepType')=='avg': average+=1;continue
        assert get('stepType')=='instant';instant+=1
        lat=np.asarray(codes_get_array(h,'latitudes'));lon=np.asarray(codes_get_array(h,'longitudes'))
        output=np.zeros(65160,dtype=np.int8)
        output[np.rint(90-lat).astype(int)*360+np.rint((lon+180)%360).astype(int)]=values.astype(np.int8)
        flags[name]=output
    finally: codes_release(h)
assert instant==average==4 and len(recorded)==29434
core=[]
for message in messages(fixture_bundle(datetime(2026,11,11,6,tzinfo=timezone.utc))):
    h=codes_new_from_message(message)
    try: codes_set(h,'step',9);core.append(codes_get_message(h))
    finally: codes_release(h)
result=decode_fields(b''.join(core)+recorded,'RECORDED-PHASE/SYNTHETIC-CORE',datetime(2026,11,12,tzinfo=timezone.utc))
expected=np.full(65160,'unknown',dtype=object)
count=sum(flags.values())
expected[count>1]='mixed'
for name,values in flags.items(): expected[(count==1)&(values==1)]=name
assert result['precipitation_phase_status']=='available'
assert result['valid_at']=='2026-11-11T15:00:00Z'
assert result['precipitation_phase']['values']==expected.tolist()
assert np.count_nonzero(expected=='snow')>0 and np.count_nonzero(expected=='rain')>0
print('PASS recorded NOMADS GRIB: 4 instantaneous/4 average surface flags, local aliases/units/binary coding, real snow/rain nodes and matching decoder output; HTTP0')
