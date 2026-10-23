"""Bounded multi-message NOAA GRIB decoding. Only instantaneous fields are used.

PRATE is liquid-water-equivalent mass flux, not an accumulated rainfall total.
The provider filter also returns averages/other levels; never silently mix them.
"""
from datetime import datetime, timezone
import numpy as np
from services.weather_grid import decode_temperature, iso


def decode_fields(data, source_file, retrieved_at):
    from eccodes import codes_new_from_message, codes_get, codes_get_values, codes_get_array, codes_release
    if len(data) > 16000000: raise ValueError('Global field bundle exceeds limit')
    offset = 0; count = 0; fields = {}; temperature = None; times = set()
    while offset < len(data):
        if len(data)-offset<16 or data[offset:offset+4] != b'GRIB' or data[offset+7] != 2:
            raise ValueError('Expected GRIB2 message boundary')
        size = int.from_bytes(data[offset+8:offset+16], 'big')
        if size < 20 or offset+size > len(data) or count >= 16:
            raise ValueError('Invalid GRIB bundle')
        message = data[offset:offset+size]; offset += size; count += 1
        h = codes_new_from_message(message)
        if h is None: raise ValueError('Missing GRIB field')
        try:
            get = lambda key: codes_get(h, key)
            signature = (get('shortName'), get('typeOfLevel'), get('level'))
            if get('stepType') != 'instant': continue
            if signature == ('2t', 'heightAboveGround', 2):
                if temperature is not None: raise ValueError('Duplicate temperature')
                temperature = decode_temperature(message, source_file, retrieved_at)
                times.add((temperature['model_initialized_at'], temperature['valid_at']))
                continue
            names = {('tcc','atmosphere',0):('clouds','%',0,100),
                     ('tcc','entireAtmosphere',0):('clouds','%',0,100),
                     ('prate','surface',0):('precipitation','kg m**-2 s**-1',0,1),
                     ('10u','heightAboveGround',10):('u','m s**-1',-150,150),
                     ('10v','heightAboveGround',10):('v','m s**-1',-150,150)}
            spec = names.get(signature)
            if not spec: continue
            key, units, low, high = spec
            if key in fields or get('units') != units: raise ValueError('Duplicate field or unexpected units')
            if (get('gridType'),get('Ni'),get('Nj'),get('iDirectionIncrementInDegrees'),get('jDirectionIncrementInDegrees')) != ('regular_ll',360,181,1,1):
                raise ValueError('Expected global one-degree nodes')
            values = np.asarray(codes_get_values(h),dtype=float)
            lats = np.asarray(codes_get_array(h,'latitudes')); lons = np.asarray(codes_get_array(h,'longitudes'))
            y = np.rint(90-lats).astype(int); x = np.rint((lons+180)%360).astype(int)
            if len(values)!=65160 or np.any(y<0) or np.any(y>180) or np.any(x<0) or np.any(x>359) or len(np.unique(y*360+x))!=65160 or not np.allclose(lats,90-y,atol=1e-6) or not np.allclose((lons+180)%360,x,atol=1e-6):
                raise ValueError('Invalid global node geography')
            valid = np.isfinite(values)&(values!=get('missingValue'))
            if valid.mean()<.95 or np.any(values[valid]<low) or np.any(values[valid]>high): raise ValueError('Implausible model field')
            output = np.full((181,360),np.nan); output[y[valid],x[valid]] = values[valid]
            if key=='precipitation': output *= 3600 # 1 kg m^-2 liquid water = 1 mm
            stamp = lambda d,t: iso(datetime.strptime(f'{int(d):08d}{int(t):04d}','%Y%m%d%H%M').replace(tzinfo=timezone.utc))
            times.add((stamp(get('dataDate'),get('dataTime')),stamp(get('validityDate'),get('validityTime'))))
            fields[key] = [None if not np.isfinite(v) else round(float(v),3) for v in output.ravel()]
        finally: codes_release(h)
    if temperature is None or set(fields)!={'clouds','precipitation','u','v'} or len(times)!=1:
        raise ValueError('Missing or inconsistent instantaneous model fields')
    temperature['fields'] = {
        'clouds':{'variable':'Total cloud coverage (model)','units':'%','source_units':'%','step_type':'instant','values':fields['clouds']},
        'precipitation':{'variable':'Precipitation rate (liquid equivalent)','units':'mm/h','source_units':'kg m^-2 s^-1','step_type':'instant','values':fields['precipitation']},
        'wind':{'variable':'10-metre wind','units':'m/s','source_units':'m s^-1','step_type':'instant','u':fields['u'],'v':fields['v'],
                'components':'Eastward u / northward v; arrows point toward, not meteorological wind-from'}}
    return temperature
