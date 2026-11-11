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
    offset = 0; count = 0; decoded = 0; fields = {}; temperature = None; times = set(); field_times = {}
    optional = {('2r','heightAboveGround',2):('humidity','%',0,100),
                ('prmsl','meanSea',0):('pressure','Pa',80000,120000)}
    phases = {'crain':('rain',33,192), 'cfrzr':('freezing_rain',34,193),
              'cicep':('ice_pellets',35,194), 'csnow':('snow',36,195)}
    optional.update({(name,'surface',0):(spec[0],'(Code table 4.222)',0,1) for name,spec in phases.items()})
    optional_errors = {}
    while offset < len(data):
        if len(data)-offset<16 or data[offset:offset+4] != b'GRIB' or data[offset+7] != 2:
            raise ValueError('Expected GRIB2 message boundary')
        size = int.from_bytes(data[offset+8:offset+16], 'big')
        # The four flags have instant AND average records in this product.
        # Bound framing at 32; at most 16 instantaneous records are decoded.
        if size < 20 or offset+size > len(data) or count >= 32:
            raise ValueError('Invalid GRIB bundle')
        message = data[offset:offset+size]; offset += size; count += 1
        h = codes_new_from_message(message)
        if h is None: raise ValueError('Missing GRIB field')
        signature = None
        try:
            get = lambda key: codes_get(h, key)
            signature = (get('shortName'), get('typeOfLevel'), get('level'))
            if get('stepType') != 'instant': continue
            if decoded>=16: raise ValueError('Too many instantaneous model fields')
            decoded+=1
            if signature == ('2t', 'heightAboveGround', 2):
                if temperature is not None: raise ValueError('Duplicate temperature')
                temperature = decode_temperature(message, source_file, retrieved_at)
                times.add((temperature['model_initialized_at'], temperature['valid_at']))
                continue
            names = {('tcc','atmosphere',0):('clouds','%',0,100),
                     ('tcc','entireAtmosphere',0):('clouds','%',0,100),
                     ('prate','surface',0):('precipitation','kg m**-2 s**-1',0,1),
                     ('10u','heightAboveGround',10):('u','m s**-1',-150,150),
                     ('10v','heightAboveGround',10):('v','m s**-1',-150,150), **optional}
            spec = names.get(signature)
            if not spec: continue
            key, units, low, high = spec
            if key in fields or get('units') != units: raise ValueError('Duplicate field or unexpected units')
            if get('shortName') in phases:
                _, standard, local = phases[get('shortName')]
                if get('discipline')!=0 or get('parameterCategory')!=1 or not (get('parameterNumber')==standard or get('parameterNumber')==local and get('centre')=='kwbc'):
                    raise ValueError('Unexpected categorical parameter identity')
            if (get('gridType'),get('Ni'),get('Nj'),get('iDirectionIncrementInDegrees'),get('jDirectionIncrementInDegrees')) != ('regular_ll',360,181,1,1):
                raise ValueError('Expected global one-degree nodes')
            values = np.asarray(codes_get_values(h),dtype=float)
            lats = np.asarray(codes_get_array(h,'latitudes')); lons = np.asarray(codes_get_array(h,'longitudes'))
            y = np.rint(90-lats).astype(int); x = np.rint((lons+180)%360).astype(int)
            if len(values)!=65160 or np.any(y<0) or np.any(y>180) or np.any(x<0) or np.any(x>359) or len(np.unique(y*360+x))!=65160 or not np.allclose(lats,90-y,atol=1e-6) or not np.allclose((lons+180)%360,x,atol=1e-6):
                raise ValueError('Invalid global node geography')
            valid = np.isfinite(values)&(values!=get('missingValue'))
            if valid.mean()<.95 or np.any(values[valid]<low) or np.any(values[valid]>high): raise ValueError('Implausible model field')
            if get('shortName') in phases and np.any((values[valid]!=0)&(values[valid]!=1)):
                raise ValueError('Categorical flags must be zero or one')
            output = np.full((181,360),np.nan); output[y[valid],x[valid]] = values[valid]
            if key=='precipitation': output *= 3600 # 1 kg m^-2 liquid water = 1 mm
            if key=='pressure': output /= 100 # Source Pa; display mean sea-level pressure in hPa.
            stamp = lambda d,t: iso(datetime.strptime(f'{int(d):08d}{int(t):04d}','%Y%m%d%H%M').replace(tzinfo=timezone.utc))
            field_times[key] = (stamp(get('dataDate'),get('dataTime')),stamp(get('validityDate'),get('validityTime')))
            if signature not in optional: times.add(field_times[key])
            if get('shortName') in phases:
                # Flags need one byte per node, not four additional Python
                # float lists. -1 stays unknown; it is never converted to zero.
                fields[key] = np.where(np.isfinite(output),output,-1).astype(np.int8).ravel()
            else:
                fields[key] = [None if not np.isfinite(v) else round(float(v),3) for v in output.ravel()]
        except Exception:
            if signature not in optional: raise
            # Optional fields cannot invalidate the existing core bundle. Never
            # retain one side of an ambiguous duplicate or malformed optional.
            key = optional[signature][0]
            fields.pop(key, None); optional_errors[key] = 'invalid_optional_field'
        finally: codes_release(h)
    if temperature is None or not {'clouds','precipitation','u','v'}.issubset(fields) or len(times)!=1:
        raise ValueError('Missing or inconsistent instantaneous model fields')
    temperature['fields'] = {
        'clouds':{'variable':'Total cloud coverage (model)','units':'%','source_units':'%','step_type':'instant','values':fields['clouds']},
        'precipitation':{'variable':'Precipitation rate (liquid equivalent)','units':'mm/h','source_units':'kg m^-2 s^-1','step_type':'instant','values':fields['precipitation']},
        'wind':{'variable':'10-metre wind','units':'m/s','source_units':'m s^-1','step_type':'instant','u':fields['u'],'v':fields['v'],
                'components':'Eastward u / northward v; arrows point toward, not meteorological wind-from'}}
    temperature['bundle_version'] = 2
    temperature['phase_version'] = 1
    phase_keys = [spec[0] for spec in phases.values()]
    complete = all(key in fields and key not in optional_errors and field_times[key] in times for key in phase_keys)
    temperature['precipitation_phase_status'] = 'available' if complete else 'unavailable'
    if complete:
        flags = np.vstack([fields[key] for key in phase_keys])
        known = np.all(flags>=0,axis=0); present = np.sum(flags==1,axis=0)
        phase_values = np.full(65160,'unknown',dtype=object)
        phase_values[known & (present>1)] = 'mixed'
        for index,key in enumerate(phase_keys): phase_values[known & (present==1) & (flags[index]==1)] = key
        phase_values = phase_values.tolist()
        temperature['precipitation_phase'] = dict(values=phase_values, units='category', level='surface',
            step_type='instant', valid_at=temperature['valid_at'], source='NOAA GFS CRAIN/CFRZR/CICEP/CSNOW',
            interpretation='Nearest grid node; simultaneous positive flags are mixed; missing/all-zero flags are unknown. Rate remains liquid equivalent.')
    temperature['field_status'] = {}
    for key, variable, units, source_units, level, identity in [
        ('humidity','2 m relative humidity (model)','%','%','2 m above ground','RH'),
        ('pressure','Mean Sea-Level Pressure (model)','hPa','Pa','mean sea level','PRMSL')]:
        if key in fields and key not in optional_errors and field_times[key] in times:
            temperature['fields'][key] = dict(variable=variable, units=units, source_units=source_units,
                level=level, grib_parameter=identity, step_type='instant', values=fields[key])
            temperature['field_status'][key] = 'available'
        else:
            temperature['field_status'][key] = optional_errors.get(key, 'inconsistent_time' if key in fields else 'not_returned')
    return temperature
