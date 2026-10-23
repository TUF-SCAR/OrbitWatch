"""Bounded recovery and refresh ownership checks; no real DB/provider requests."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import sys
import tempfile
import threading
from unittest.mock import patch
from sqlalchemy.exc import OperationalError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from core.availability import DatabaseAvailability, DatabaseUnavailable

clock = [0.0]
started, release = threading.Event(), threading.Event()
calls = [0]
def probe():
    calls[0] += 1; started.set(); release.wait(2)
    raise OperationalError("hidden", {}, RuntimeError("hidden"))
gate = DatabaseAvailability(probe, clock=lambda: clock[0], jitter=lambda: .5)
def ensure(_):
    try: gate.ensure(); return True
    except DatabaseUnavailable: return False
with ThreadPoolExecutor(max_workers=12) as pool:
    first = pool.submit(ensure, 0); assert started.wait(1)
    others = list(pool.map(ensure, range(40))); release.set()
    assert not first.result() and not any(others) and calls[0] == 1
assert gate.next_probe == 5.5
for expected in [10.5, 20.5, 40.5, 60.5, 60.5]:
    clock[0] = gate.next_probe; before = clock[0]; assert not ensure(0)
    assert gate.next_probe - before == expected
gate.probe = lambda: None; clock[0] = gate.next_probe; gate.ensure()
assert gate.ready and gate.failures == 0
print("PASS: single-flight40 concurrent probes, bounded5-60sec backoff+jitter, recovery reset")

with tempfile.TemporaryDirectory(dir=ROOT / ".orbitwatch-backups") as tmp, \
     patch("dotenv.load_dotenv", return_value=False), \
     patch.dict(os.environ, {"DATABASE_URL": "sqlite://", "JWT_SECRET_KEY": "isolated-availability-fixture-secret", "ORBITWATCH_INGESTION_ENABLED": "true"}):
    from services.providers import budget as budget_module
    from services import orbital_data_service as service
    import workers.satellite_refresh as worker
    import main
    async def verify():
        refreshes, waits = [], []
        def fail(): refreshes.append(1); raise DatabaseUnavailable()
        async def sleep(delay):
            waits.append(delay)
            if len(waits) == 5: raise asyncio.CancelledError()
        with patch.object(worker, "refresh_orbital_data", side_effect=fail), patch.object(worker.asyncio, "sleep", side_effect=sleep), patch.object(worker.random, "uniform", return_value=0):
            try: await worker.run_satellite_refresh_worker()
            except asyncio.CancelledError: pass
        assert waits == [120, 240, 480, 900, 900] and len(refreshes) == 5
        starts = []
        async def held_worker():
            starts.append(1)
            await asyncio.Event().wait()
        with patch.object(budget_module, "ROOT", Path(tmp)), patch.object(main, "run_satellite_refresh_worker", held_worker):
            async with main.lifespan(main.app):
                await asyncio.sleep(0)
                async with main.lifespan(main.app):
                    await asyncio.sleep(0)
                    assert len(starts) == 1
            async with main.lifespan(main.app):
                await asyncio.sleep(0)
                assert len(starts) == 2, "lease must release on shutdown"
        local = budget_module.ProviderBudget(Path(tmp) / 'budgets.sqlite3', clock=lambda:10000, jitter=lambda:0)
        local.reserve('spacetrack',3600,2)
        snapshot=(Path(tmp)/'budgets.sqlite3').read_bytes()
        with patch.object(service, "delete_old_orbital_history", side_effect=DatabaseUnavailable()), patch.object(service.spacetrack, "get_latest_gp") as st, patch.object(service.celestrak, "get_latest_gp") as ct, patch.object(budget_module, "ROOT", Path(tmp)):
            for _ in range(8):
                try: service.refresh_orbital_data(force=True)
                except DatabaseUnavailable: pass
            assert not st.called and not ct.called
        assert snapshot == (Path(tmp)/'budgets.sqlite3').read_bytes()
        # DB loss after a successful provider response must retain reservations.
        external = []
        def reserved_download(ids):
            with local.attempt('celestrak',7200,1):
                external.append(1)
                return [{'NORAD_CAT_ID':'25544'}]
        with patch.object(service, 'delete_old_orbital_history', return_value=0), patch.object(service, 'orbital_data_is_stale', return_value=True), patch.object(service, 'orbital_data_is_missing', return_value=True), patch.object(service.spacetrack, 'get_latest_gp', side_effect=budget_module.ProviderDeferred()), patch.object(service.celestrak, 'get_latest_gp', side_effect=reserved_download), patch.object(service, 'archive_current_orbital_records', side_effect=DatabaseUnavailable()), patch.object(service, 'last_provider_attempt_at', None):
            try: service._refresh_orbital_data(force=True)
            except DatabaseUnavailable: pass
            assert external == [1]
            for _ in range(5): service._refresh_orbital_data(force=True)
            assert external == [1], 'failed DB save/recovery must not bypass persisted provider cooldown'
    asyncio.run(verify())
print("PASS: worker bounded backoff/cancellation, one scheduler/lease recovery, DB failures do not spend/reset provider budgets")
