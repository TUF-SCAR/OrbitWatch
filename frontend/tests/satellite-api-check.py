"""Read-only smoke check of the live test bridge's real backend samples."""
import argparse
import json
import math
from datetime import datetime
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
catalog = json.loads((ROOT / "backend/data/space_object_catalog.json").read_text(encoding="utf-8"))
ids = [item["noradId"] for item in catalog]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--record-load-fixture", action="store_true", help="Save 44 real paths/overlapping trajectories for the native GPU load probe")
args = parser.parse_args()

def request(path, body=None):
    req = Request("http://127.0.0.1:8001/api/satellites/" + path,
                  data=json.dumps(body).encode() if body else None,
                  headers={"Content-Type":"application/json"})
    with urlopen(req, timeout=30) as response:
        return json.load(response)

def validate(samples):
    previous = None
    for sample in samples:
        stamp = datetime.fromisoformat(sample["timestamp"].replace("Z", "+00:00"))
        assert stamp.tzinfo is not None and (previous is None or stamp > previous)
        assert all(math.isfinite(sample[k]) for k in ["latitude", "longitude", "altitude_km"])
        previous = stamp

results = {"source":"live unchanged backend/Skyfield/database via loopback test bridge", "trajectoryBatches":[], "orbits":[]}
for count in [1,6,12,24,44]:
    batch = request("trajectories", {"norad_ids":ids[:count], "step_seconds":5, "duration_seconds":300})
    assert not batch["errors"] and len(batch["objects"]) == count
    for item in batch["objects"]:
        validate(item["positions"])
        assert len(item["positions"]) == 61
    results["trajectoryBatches"].append({"count":count,"errors":0,"positionsPerObject":61})
last_batch = {item["norad_id"]:item for item in batch["objects"]}
recorded = []
for norad_id in ids[:44]:
    period = last_batch[norad_id]["orbital_period_minutes"] * 60
    count = 2000 if period > 18*3600 else 960 if period > 3*3600 else 480
    orbit = request(f"{norad_id}/orbit?samples={count}")
    validate(orbit["positions"])
    assert len(orbit["positions"]) == count
    results["orbits"].append({"noradId":norad_id,"samples":count,"periodSeconds":period})
    if args.record_load_fixture:
        recorded.append({"orbit":orbit,"trajectory":last_batch[norad_id]})

if args.record_load_fixture:
    next_batch = request("trajectories", {"norad_ids":ids[:44], "step_seconds":5, "duration_seconds":300})
    assert not next_batch["errors"] and len(next_batch["objects"]) == 44
    refresh = {item["norad_id"]:item for item in next_batch["objects"]}
    for item in recorded:
        item["refresh"] = refresh[item["orbit"]["norad_id"]]
    fixture = ROOT / "frontend/tests/fixtures/satellite-load-sgp4.json"
    fixture.write_text(json.dumps({"source":"Recorded unchanged live Skyfield/SGP4 backend; read-only existing database; 44 actual catalog IDs", "objects":recorded},separators=(",", ":")), encoding="utf-8")
target = ROOT / ".orbitwatch-backups/satellite-overhaul-live-api.json"
target.write_text(json.dumps(results,indent=2),encoding="utf-8")
print("Real live API checks passed: 1/6/12/24/44 trajectories and 44 full propagated orbits;", target)
