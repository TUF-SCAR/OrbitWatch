"""Validate CDS GRIB messages; never used by ordinary API requests."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import numpy as np
from services.historical_weather_codec import DATASET, GRID, check_seasonal, convert, relative_humidity

PARAMS = {167:('temperature','K', 'heightAboveGround',2), 168:('dewpoint','K','heightAboveGround',2),
          164:('clouds','(0 - 1)','surface',0), 228:('precipitation','m','surface',0),
          151:('pressure','Pa','meanSea',0),165:('u','m s**-1','heightAboveGround',10),166:('v','m s**-1','heightAboveGround',10)}
VARIABLES = ['2m_temperature','2m_dewpoint_temperature','total_cloud_cover','total_precipitation',
             'mean_sea_level_pressure','10m_u_component_of_wind','10m_v_component_of_wind']
MAX_SOURCE = 64*1024*1024


def request_for_year(year, now=None):
    from datetime import timedelta
    # Final ERA5, not preliminary ERA5T. Three-month lag is deliberately conservative.
    now = now or datetime.now(timezone.utc)
    if year not in range(1945,2027): raise ValueError('Year outside planned archive')
    dates = [check_seasonal(f'{year}-{month:02}-15T12:00:00Z') for month in (1,4,7,10)
             if datetime(year,month,15,12,tzinfo=timezone.utc) < now-timedelta(days=95)]
    if not dates: raise ValueError('No final seasonal dates available in that year')
    return dict(product_type=['reanalysis'], variable=VARIABLES, year=[str(year)],
                month=[f'{d.month:02}' for d in dates], day=['15'], time=['12:00'],
                grid=[1,1], data_format='grib', download_format='unarchived')


def canonical_grid(latitudes, longitudes, values):
    """Accept regular global 0.25° or 1° point grids, normalize wrap and ordering.

    Integer point decimation of 0.25° preserves source node values; it is not a
    cell average, smooth field, or claim of enhanced resolution.
    """
    lat, lon, a = [np.asarray(v).reshape(-1) for v in (latitudes,longitudes,values)]
    if not lat.size == lon.size == a.size or lat.size not in (65160,1038240): raise ValueError('Not a supported global grid')
    if not np.isfinite(lat).all() or not np.isfinite(lon).all(): raise ValueError('Invalid coordinates')
    spacing = .25 if lat.size == 1038240 else 1
    x = np.mod(lon+180,360)/spacing; y=(90-lat)/spacing
    if np.any(np.abs(x-np.rint(x)) > 1e-5) or np.any(np.abs(y-np.rint(y)) > 1e-5) or np.any(y < 0) or np.any(y > 180/spacing): raise ValueError('Irregular grid')
    index=np.rint(y).astype(int)*round(360/spacing)+np.rint(x).astype(int)
    if np.unique(index).size != lat.size: raise ValueError('Duplicate or incomplete grid nodes')
    ordered=np.empty(lat.size);ordered[index]=a
    stride=round(1/spacing)
    return ordered.reshape(round(180/spacing)+1, round(360/spacing))[::stride,::stride].reshape(-1)


def read_grib(path, manifest):
    import eccodes as ec
    path=Path(path)
    if not 0 < path.stat().st_size <= MAX_SOURCE: raise ValueError('Source file exceeds bound')
    checksum=sha256(path.read_bytes()).hexdigest()
    if manifest.get('dataset') != DATASET or manifest.get('state') != 'downloaded' or manifest.get('source_sha256') != checksum or not manifest.get('job_id'):
        raise ValueError('CDS download manifest/integrity required')
    request=manifest.get('request', {})
    year=int(request['year'][0]); expected={check_seasonal(f'{year}-{m}-15T12:00:00Z') for m in request['month']}
    if request.get('product_type') != ['reanalysis'] or request.get('time') != ['12:00'] or request.get('day') != ['15'] or set(request.get('variable',[]))!=set(VARIABLES): raise ValueError('Unexpected CDS product')
    results={date:dict(fields={}, failures={}) for date in expected}
    seen=set()
    with path.open('rb') as stream:
        count=0
        while (handle:=ec.codes_grib_new_from_file(stream)) is not None:
            try:
                count+=1
                if count > 28: raise ValueError('Unexpected message count')
                param=int(ec.codes_get(handle,'paramId'))
                if param not in PARAMS: raise ValueError('Unexpected variable')
                name,unit,level_type,level=PARAMS[param]
                valid=datetime.strptime(str(ec.codes_get(handle,'validityDate'))+f'{int(ec.codes_get(handle,"validityTime")):04}', '%Y%m%d%H%M').replace(tzinfo=timezone.utc)
                if valid not in expected or (valid,name) in seen: raise ValueError('Mismatched/duplicate validity time')
                seen.add((valid,name))
                if str(ec.codes_get(handle,'centre')) != 'ecmf' or str(ec.codes_get(handle,'marsClass')) != 'ea' or str(ec.codes_get(handle,'marsStream')) != 'oper' or int(ec.codes_get(handle,'experimentVersionNumber')) != 1:
                    raise ValueError('Not final ERA5 ECMWF reanalysis')
                # Reject failed variable metadata independently; preserve valid siblings.
                try:
                    actual_level=(str(ec.codes_get(handle,'typeOfLevel')),int(ec.codes_get(handle,'level')))
                    # ERA5 GRIB1 encodes these ECMWF local parameters at surface/0;
                    # their paramId carries the 2m/10m/MSL semantics. GRIB2 can use
                    # explicit heightAboveGround/meanSea. Never accept other levels.
                    permitted={(level_type,level)}
                    if int(ec.codes_get(handle,'edition'))==1: permitted.add(('surface',0))
                    if str(ec.codes_get(handle,'units')) != unit or actual_level not in permitted or ec.codes_get(handle,'gridType') != 'regular_ll': raise ValueError('Variable metadata mismatch')
                    step_type=ec.codes_get(handle,'stepType'); data_type=ec.codes_get(handle,'dataType')
                    if name=='precipitation':
                        if step_type!='accum' or data_type!='fc' or int(ec.codes_get(handle,'stepUnits')) != 1 or float(ec.codes_get(handle,'endStep'))-float(ec.codes_get(handle,'startStep')) != 1: raise ValueError('Precipitation must be one preceding hour, not cumulative forecast')
                    elif step_type!='instant' or data_type!='an': raise ValueError('Expected ERA5 instantaneous analysis')
                    raw=np.asarray(ec.codes_get_values(handle),dtype=float)
                    if int(ec.codes_get(handle,'bitmapPresent')):
                        raw[np.asarray(ec.codes_get_array(handle,'bitmap'))==0]=np.nan
                    raw[raw==ec.codes_get(handle,'missingValue')]=np.nan
                    a=canonical_grid(ec.codes_get_array(handle,'latitudes'),ec.codes_get_array(handle,'longitudes'),raw)
                    converted=convert(name,a)
                    from services.historical_weather_codec import SPECS
                    _,_,lo,hi=SPECS[name]
                    if not np.isfinite(converted).any() or np.any(np.isinf(converted)) or np.any(converted<lo-1e-6) or np.any(converted>hi+1e-6): raise ValueError('Physical limits failed')
                    results[valid]['fields'][name]=converted
                except (ValueError,ec.CodesInternalError):
                    results[valid]['failures'][name]='Source variable validation failed'
            finally: ec.codes_release(handle)
    for date,result in results.items():
        f=result['fields']
        if 'temperature' in f and 'dewpoint' in f:
            f['humidity']=relative_humidity(f['temperature']+273.15,f['dewpoint']+273.15)
        if not f: raise ValueError('Snapshot has no valid variables')
        result['provenance']=dict(dataset=DATASET, product='reanalysis', source_sha256=checksum,
            job_id=manifest['job_id'], source_url='https://cds.climate.copernicus.eu/datasets/'+DATASET,
            licence='CC-BY; Copernicus Climate Change Service / ECMWF',
            grid_method='CDS MIR 1-degree regridding or integer point decimation of regular 0.25-degree nodes; no temporal interpolation',
            humidity_method='ECMWF Tetens over liquid water; bounded 0–100%; es=611.21 exp(17.502*(T-273.16)/(T-32.19))',
            failures=result['failures'], source_grid_resolution=request.get('grid', [.25,.25]))
    return results
