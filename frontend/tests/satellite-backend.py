"""Local diagnostic bridge to UNMODIFIED Skyfield/backend calculations.

Synthetic UI identity only; satellite positions are read from the existing
database and propagated by backend/services/satellite_tracker.py. Loopback
8001, test-only, no database/auth writes. Not imported by the production app.
"""
import json
import sys
from datetime import datetime
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from services.satellite_tracker import (
    get_satellite_position, get_satellite_trajectory, get_satellite_trajectories,
    get_satellite_orbit, prefetch_satellite_propagators,
    get_satellite_propagator, timescale, wgs84,
)
from services.satellite_catalog import get_satellite_catalog, is_supported_norad_id
from fastapi import HTTPException
from pydantic import BaseModel

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["http://127.0.0.1:5174"], allow_methods=["GET", "POST"], allow_headers=["*"])

def check(norad_id):
    if not is_supported_norad_id(norad_id):
        raise HTTPException(404, "Unknown catalog ID")

class Batch(BaseModel):
    norad_ids: list[int]
    step_seconds: int = 5
    duration_seconds: int = 300

@app.post("/api/satellites/trajectories")
def batch(body: Batch):
    if not 1 <= len(body.norad_ids) <= 200 or not 1 <= body.step_seconds <= 300 or not 1 <= body.duration_seconds <= 86400:
        raise HTTPException(400, "Invalid sampling bounds")
    for norad_id in body.norad_ids:
        check(norad_id)
    return get_satellite_trajectories(body.norad_ids, body.step_seconds, body.duration_seconds)

@app.get("/api/satellites/{norad_id}/orbit")
def orbit(norad_id: int, samples: int = 480):
    check(norad_id)
    if not 2 <= samples <= 2000:
        raise HTTPException(400, "Invalid orbit sample count")
    return get_satellite_orbit(norad_id, samples)

@app.get("/api/satellites/{norad_id}/position")
def position(norad_id: int):
    check(norad_id)
    return get_satellite_position(norad_id)

if __name__ == "__main__":
    ids = [25544, 20580, 39084, 26407, 58990, 25867]
    prefetch_satellite_propagators(ids)
    recorded = []
    for n in ids:
        shape = get_satellite_orbit(n, 480)
        period = shape["orbital_period_minutes"] * 60
        count = 2000 if period > 18 * 3600 else 960 if period > 3 * 3600 else 480
        if count != 480:
            shape = get_satellite_orbit(n, count)
        # Independent real SGP4 truth between the displayed vertices, including
        # eccentric perigee, not just round-tripping a renderer's own samples.
        dates = [datetime.fromisoformat(p["timestamp"]) for p in shape["positions"]]
        mid_dates = [a + (b-a)/2 for a,b in zip(dates,dates[1:])]
        locations = wgs84.geographic_position_of(get_satellite_propagator(n).at(timescale.from_datetimes(mid_dates)))
        truth = [{"timestamp":d.isoformat(),"latitude":round(float(locations.latitude.degrees[i]),4),
                  "longitude":round(float(locations.longitude.degrees[i]),4),"altitude_km":round(float(locations.elevation.km[i]),2)} for i,d in enumerate(mid_dates)]
        recorded.append({"orbit":shape,"trajectory":get_satellite_trajectory(n,5,300),"midpoints":{"positions":truth}})
    target = ROOT / "frontend/tests/fixtures/satellite-sgp4.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({"source":"Recorded unchanged OrbitWatch Skyfield/SGP4 backend; WGS84 geographic samples", "objects":recorded}, separators=(",", ":")), encoding="utf-8")
    print("Recorded", len(recorded), "real propagated satellites to", target)
