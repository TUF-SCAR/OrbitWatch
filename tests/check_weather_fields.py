"""Generated real ecCodes multi-field/units contracts; zero network."""
from datetime import datetime,timezone
from pathlib import Path
import sys
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT/'backend'),str(ROOT/'tests')]
from check_weather import fixture_bundle,fixture_grib
from services.weather_fields import decode_fields
from eccodes import codes_new_from_message,codes_set,codes_set_values,codes_get_message,codes_release

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

