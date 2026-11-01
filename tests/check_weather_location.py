"""Pure location contracts, optional-pressure isolation and legacy speed units; HTTP0."""
import sys
from pathlib import Path
from datetime import datetime, timezone
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from services.weather import parse_location, annotate

now=datetime.now(timezone.utc)
raw={'latitude':0,'longitude':0,'current':{'time':now.timestamp(),'interval':900,'temperature_2m':26,'wind_speed_10m':10,'relative_humidity_2m':70,'pressure_msl':1013.25},
     'current_units':{'temperature_2m':'°C','wind_speed_10m':'m/s','relative_humidity_2m':'%','pressure_msl':'hPa'}}
point=parse_location(raw,0,0,now)
assert point['values']['pressure_msl']==1013.25 and point['units']['pressure_msl']=='hPa'
assert point['values']['relative_humidity_2m']==70
assert point['values']['wind_speed_10m']==36 and point['units']['wind_speed_10m']=='km/h'
assert point['source_units']['wind_speed_10m']=='m/s'
assert annotate(point,'location')['values']['wind_speed_10m']==36
for changes in [{'pressure_msl':None},{'pressure_msl':float('nan')},{'pressure_msl':700},{'relative_humidity_2m':101}]:
    result=parse_location({**raw,'current':{**raw['current'],**changes}},0,0,now)
    assert result['values']['temperature_2m']==26
    for key in changes:assert result['values'][key] is None
assert parse_location({**raw,'current_units':{**raw['current_units'],'pressure_msl':'Pa'}},0,0,now)['values']['pressure_msl'] is None
legacy={**point,'units':{**point['units'],'wind_speed_10m':'m/s'},'values':{**point['values'],'wind_speed_10m':10}}
assert annotate(legacy,'location')['values']['wind_speed_10m']==36
assert legacy['values']['wind_speed_10m']==10
print('PASS location mean sea-level pressure/humidity units, optional failure isolation, m/s to km/h and legacy cache conversion; HTTP0')
