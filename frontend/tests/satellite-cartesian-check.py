"""Read-only real-element recording; no lifespan, ingestion or account writes."""
import json, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'backend'))
from services.satellite_tracker import get_satellite_propagator, propagate_samples, scientific_metadata, timescale
from sgp4.api import jday
import numpy as np
rows=[]
for ident in [25544,20580,39084,26407,58990,25867,25989]:
 sat=get_satellite_propagator(ident)
 start=datetime.now(timezone.utc)
 period=2*np.pi/sat.model.no_kozai*60
 count=2000 if period>18*3600 else 960 if period>3*3600 else 480
 dates=[start+timedelta(seconds=period*i/(count-1)) for i in range(count)]
 samples=propagate_samples(sat,dates)
 def payload(ds):
  ps=propagate_samples(sat,ds)
  return {'norad_id':ident,'positions':ps,'orbital_period_minutes':period/60,**scientific_metadata(sat,ds,ps)}
 orbit={'norad_id':ident,'positions':samples,'orbital_period_minutes':period/60,**scientific_metadata(sat,dates,samples)}
 track_dates=[start+timedelta(seconds=i*5) for i in range(61)]
 truth_dates=[start+timedelta(seconds=2.5+i*5) for i in range(60)]
 errors=[]
 for d,sample in zip(dates[::max(1,count//24)],samples[::max(1,count//24)]):
  jd,frac=jday(d.year,d.month,d.day,d.hour,d.minute,d.second+d.microsecond/1e6)
  error,r,v=sat.model.sgp4(jd,frac)
  assert not error
  errors.append(float(np.linalg.norm(np.array(r)-sample['teme_position_km']))*1000)
  assert np.allclose(v,sample['teme_velocity_km_s'],atol=1e-9,rtol=0)
 assert max(errors)<.001, (ident,max(errors))
 rows.append({'orbit':orbit,'trajectory':payload(track_dates),'truth':payload(truth_dates),'refresh':payload(track_dates[24:]),'raw_sgp4_max_error_m':max(errors)})
 print(ident,'verified raw SGP4 TEME; max round-trip error m',max(errors))
file=ROOT/'frontend/tests/fixtures/satellite-cartesian.json'
file.write_text(json.dumps({'source':'Read-only existing orbital records; production Skyfield/SGP4 TEME/ITRS +independent raw SGP4 comparison; no live provider requests','objects':rows},separators=(',',':')),encoding='utf-8')
