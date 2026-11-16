"""Offline WGS84 polygon lookup. No coordinates leave OrbitWatch."""
from functools import lru_cache
from datetime import datetime,timezone
from zoneinfo import ZoneInfo

@lru_cache(maxsize=1)
def finder():
    from timezonefinder import TimezoneFinder
    return TimezoneFinder(in_memory=False)

def resolve(latitude,longitude):
    name=finder().timezone_at(lat=latitude,lng=longitude)
    if not name: return {'state':'unavailable'}
    now=datetime.now(timezone.utc).astimezone(ZoneInfo(name))
    minutes=int(now.utcoffset().total_seconds()/60)
    offset=f"UTC{'+' if minutes>=0 else '-'}{abs(minutes)//60:02d}:{abs(minutes)%60:02d}"
    return {'state':'available','timezone':name,'label':f"{name.replace('_',' ')} · {now.tzname()} · {offset}",'offset_minutes':minutes}
