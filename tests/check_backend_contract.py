"""Exercise unmodified backend routes against an isolated temporary database.

No .env contents, provider calls, startup refreshes or persistent user data are
used. --serve exposes the same fixture on loopback:8001 for frontend checks.
All orbital elements in this harness are synthetic test data.
"""
import math
import os
from pathlib import Path
import secrets
import sys
from tempfile import TemporaryDirectory
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))


def run():
    from sqlalchemy import create_engine
    backup_root = ROOT / ".orbitwatch-backups"
    backup_root.mkdir(exist_ok=True)
    # Separate pooled connections are essential: simultaneous browser requests
    # must not share one SQLite transaction (StaticPool can roll each other back).
    with TemporaryDirectory(prefix="api-check-", dir=backup_root) as scratch:
        assert Path(scratch).resolve().parent == backup_root.resolve()
        engine = create_engine(f"sqlite:///{Path(scratch).as_posix()}/fixture.db", connect_args={"check_same_thread": False})
        try:
            check_contract(engine)
        finally:
            engine.dispose()


def check_contract(engine):
    secret = secrets.token_hex(32)

    def isolated_engine(*args, **kwargs):
        assert kwargs.get("url", args[0] if args else None) == "sqlite://"
        return engine

    def env_exists(path):
        return True if path == ROOT / "backend" / ".env" else original_is_file(path)

    original_is_file = Path.is_file
    with patch.dict(os.environ, {"DATABASE_URL": "sqlite://", "JWT_SECRET_KEY": secret}), \
         patch("dotenv.load_dotenv", return_value=False), \
         patch("sqlalchemy.create_engine", side_effect=isolated_engine), \
         patch.object(Path, "is_file", env_exists):
        from core.database import DatabaseBase, database_session_maker
        from models.satellite_orbital_data import SatelliteOrbitalData
        from models.user import User
        from services.auth import hash_password
        from main import app
        from fastapi.testclient import TestClient
        import jwt

        DatabaseBase.metadata.create_all(engine)
        now = datetime.now(timezone.utc)
        epoch = now.strftime("%y") + f"{int(now.strftime('%j')) + (now.hour * 3600 + now.minute * 60 + now.second) / 86400:012.8f}"
        ids = [25544, 20580, 48274, 39084, 58990, 26407]
        with database_session_maker() as session:
            session.add(User(username="integration_test", email="integration@example.invalid", password_hash=hash_password("OrbitWatch-test-2026")))
            for index, norad_id in enumerate(ids):
                session.add(SatelliteOrbitalData(norad_id=norad_id, object_name=f"TEST FIXTURE {norad_id}", epoch=now,
                    tle_line1=f"1 {norad_id:05d}U 98067A   {epoch}  .00000000  00000-0  00000-0 0  9990",
                    tle_line2=f"2 {norad_id:05d}  51.6400 {index * 50:8.4f} 0005000  40.0000  80.0000 15.50000000123450",
                    source="SYNTHETIC INTEGRATION FIXTURE", fetched_at=now))
            session.commit()

        # Not entering TestClient's context intentionally skips main.lifespan,
        # which otherwise starts provider refreshes. Real routes/dependencies run.
        client = TestClient(app)
        checks = 0

        def expect(method, path, status=200, **kwargs):
            nonlocal checks
            response = client.request(method, path, **kwargs)
            assert response.status_code == status, (path, response.status_code, response.text[:250])
            checks += 1
            return response.json()

        expect("GET", "/api/satellites/catalog", 401)
        expect("GET", "/api/auth/me", 401, headers={"Authorization": "Bearer invalid-token"})
        expect("POST", "/api/auth/login", 401, json={"username_or_email": "integration_test", "password": "incorrect"})
        token = expect("POST", "/api/auth/login", json={"username_or_email": " integration_test ", "password": "OrbitWatch-test-2026"})["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        profile = expect("GET", "/api/auth/me", headers=headers)
        assert profile["username"] == "integration_test" and "password_hash" not in profile
        expect("POST", "/api/auth/login", json={"username_or_email": "integration@example.invalid", "password": "OrbitWatch-test-2026"})
        registered = expect("POST", "/api/auth/register", 201, json={"username": "new_test_user", "email": "new@example.invalid", "password": "another-test-password"})
        expect("GET", "/api/auth/me", headers={"Authorization": f"Bearer {registered['access_token']}"})
        expect("POST", "/api/auth/register", 409, json={"username": "new_test_user", "email": "another@example.invalid", "password": "another-test-password"})
        expired = jwt.encode({"sub": str(profile["id"]), "exp": now - timedelta(seconds=1)}, secret, algorithm="HS256")
        expect("GET", "/api/auth/me", 401, headers={"Authorization": f"Bearer {expired}"})
        catalog = expect("GET", "/api/satellites/catalog", headers=headers)
        assert catalog["count"] == len(catalog["objects"]) == 143
        assert all(any(obj["noradId"] == key for obj in catalog["objects"]) for key in ids)
        status = expect("GET", "/api/satellites/data-status", headers=headers)
        assert status["current_records"] == 6 and status["missing_supported_objects"] is True
        position = expect("GET", "/api/satellites/25544/position", headers=headers)
        assert abs(position["latitude"]) <= 90 and abs(position["longitude"]) <= 180 and math.isfinite(position["altitude_km"])
        trajectory = expect("POST", "/api/satellites/trajectories", headers=headers,
                            json={"norad_ids": [25544, 43013], "step_seconds": 5, "duration_seconds": 300})
        assert len(trajectory["objects"]) == 1 and len(trajectory["objects"][0]["positions"]) == 61
        assert trajectory["errors"][0]["norad_id"] == 43013
        orbit = expect("GET", "/api/satellites/25544/orbit?samples=480", headers=headers)
        assert len(orbit["positions"]) == 480 and 80 < orbit["orbital_period_minutes"] < 110
        expect("GET", "/api/satellites/999999/position", 404, headers=headers)
        expect("GET", "/api/satellites/43013/position", 503, headers=headers)
        expect("POST", "/api/satellites/trajectories", 422, headers=headers, json={"norad_ids": [], "step_seconds": 0})
        expect("GET", "/api/satellites/25544/orbit?samples=1", 422, headers=headers)
        # Reproduce registration while old view requests are still finishing.
        # Every request must own its transaction and each new user must persist.
        with ThreadPoolExecutor(max_workers=4) as workers:
            jobs = []
            for index in range(4):
                jobs.append(workers.submit(expect, "POST", "/api/auth/register", 201, json={
                    "username": f"concurrent_{index}", "email": f"concurrent{index}@example.invalid", "password": "concurrent-test-password"}))
                for _ in range(3):
                    jobs.append(workers.submit(expect, "GET", "/api/satellites/catalog", headers=headers))
            results = [job.result() for job in jobs]
        for result in results:
            if "access_token" in result:
                expect("GET", "/api/auth/me", headers={"Authorization": f"Bearer {result['access_token']}"})
        client.close()
        print(f"PASS: {checks} real API requests; isolated auth/JWT/catalog/SGP4/error contracts.")

        if "--serve" in sys.argv:
            from fastapi.middleware.cors import CORSMiddleware
            import uvicorn
            # Additional origin belongs only to this test process.
            wrapped = CORSMiddleware(app, allow_origins=["http://127.0.0.1:5175"], allow_methods=["GET", "POST"], allow_headers=["*"])
            print("Synthetic integration API at http://127.0.0.1:8001; integration_test / OrbitWatch-test-2026")
            uvicorn.run(wrapped, host="127.0.0.1", port=8001, lifespan="off")


if __name__ == "__main__":
    run()
