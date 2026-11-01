"""Generated real ecCodes multi-field/units contracts; zero network."""
from datetime import datetime,timezone
from pathlib import Path
import sys
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT/'backend'),str(ROOT/'tests')]
from check_weather import fixture_bundle,fixture_grib
from services.weather_fields import decode_fields
from eccodes import codes_new_from_message,codes_set,codes_set_values,codes_get_message,codes_release,codes_get

now=datetime.now(timezone.utc).replace(minute=0,second=0,microsecond=0)
data=fixture_bundle(now);f=decode_fields(data,'TEST GENERATED MULTI-FIELD',now)
assert set(f['fields'])=={'clouds','precipitation','wind'}
assert f['fields']['clouds']['values'][0]==75
assert abs(f['fields']['precipitation']['values'][0]-3.6)<.001
assert f['fields']['wind']['u'][0]==5 and f['fields']['wind']['v'][0]==-3
assert f['fields']['precipitation']['step_type']=='instant' and f['fields']['precipitation']['units']=='mm/h'
for bad in [b'',b'GRIB',data[:-10],fixture_grib(now),data+fixture_grib(now),data+b'trailing junk']:
 try:decode_fields(bad,'bad',now)
 except ValueError:pass
 else:raise AssertionError('Malformed/incomplete/duplicate bundle accepted')
# An averaged field must never replace the instantaneous counterpart. A valid
# but extra avg message is ignored, while missing instant data is rejected.
size=int.from_bytes(data[8:16],'big');h=codes_new_from_message(data[size:])
try:
 codes_set(h,'stepType','avg');codes_set(h,'startStep',0);codes_set(h,'endStep',3);codes_set_values(h,np.full(65160,99));avg=codes_get_message(h)
finally:codes_release(h)
assert decode_fields(data+avg,'TEST',now)['fields']['clouds']['values'][0]==75
print('PASS grouped ecCodes: matched timestamps/geography, cloud %, precipitation flux to mm/h, signed10m components, instant vs avg, invalid/truncated/duplicate/missing fields; HTTP0')

def optional_message(variable, values=None, overrides=None):
    h=codes_new_from_message(fixture_grib(now))
    try:
        category,param,level_type,level=(1,1,'heightAboveGround',2) if variable=='humidity' else (3,1,'meanSea',0)
        for key,value in {'centre':'kwbc','discipline':0,'parameterCategory':category,'parameterNumber':param,'typeOfLevel':level_type,'level':level,**(overrides or {})}.items():codes_set(h,key,value)
        assert codes_get(h,'shortName')==('2r' if variable=='humidity' else 'prmsl')
        assert codes_get(h,'units')==('%' if variable=='humidity' else 'Pa')
        if values is None:
            values=np.array([(20+y*.2+x*.05) if variable=='humidity' else (90000+y*100+x) for y in range(181) for x in range(360)])
        codes_set_values(h,values)
        return codes_get_message(h)
    finally:codes_release(h)

humidity=optional_message('humidity');pressure=optional_message('pressure')
full=decode_fields(data+humidity+pressure,'TEST OPTIONAL FIELDS',now)
assert full['field_status']=={'humidity':'available','pressure':'available'}
assert full['fields']['humidity']['values'][0]==29 # 90N,180W maps source longitude180
assert full['fields']['humidity']['values'][90*360+180]==38 # Equator,Greenwich
assert abs(full['fields']['pressure']['values'][0]-901.8)<.001
assert full['fields']['pressure']['source_units']=='Pa' and full['fields']['pressure']['units']=='hPa'
assert full['fields']['pressure']['grib_parameter']=='PRMSL'
for optional_data,key in [(optional_message('humidity',np.full(65160,101)),'humidity'),
                          (optional_message('pressure',np.full(65160,70000)),'pressure'),
                          (optional_message('humidity',overrides={'step':3}),'humidity'),
                          (humidity+humidity,'humidity')]:
    result=decode_fields(data+optional_data,'INVALID OPTIONAL',now)
    assert key not in result['fields'] and result['fields']['wind']['u'][0]==5
    assert result['field_status'][key]!='available' and len(result['values_c'])==65160
assert f['field_status']=={'humidity':'not_returned','pressure':'not_returned'}
missing=np.full(65160,50.0);missing[0]=9999
masked=decode_fields(data+optional_message('humidity',missing,{'bitmapPresent':1,'missingValue':9999}),'MISSING OPTIONAL NODE',now)
assert masked['fields']['humidity']['values'][180] is None # Source 0E -> output Greenwich
assert masked['fields']['humidity']['values'][181]==50
print('PASS optional RH/PRMSL identities, source/display units, geography, duplicate/range/time isolation; core fields preserved; HTTP0')

