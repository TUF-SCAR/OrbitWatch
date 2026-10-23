"""Real app/auth/repositories with isolated storage and injected disconnects.

Never loads .env, contacts production storage or starts real provider ingestion.
Also probes an intentionally unavailable loopback PostgreSQL port in a child.
"""
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
from tempfile import TemporaryDirectory
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))


def run():
    with TemporaryDirectory(dir=ROOT / ".orbitwatch-backups", prefix="reliability-") as tmp, \
         patch("dotenv.load_dotenv", return_value=False), \
         patch.dict(os.environ, {"DATABASE_URL": f"sqlite:///{Path(tmp).as_posix()}/test.db",
                                 "JWT_SECRET_KEY": secrets.token_hex(32), "ORBITWATCH_INGESTION_ENABLED": "false"}):
        from sqlalchemy import event
        from sqlalchemy.exc import OperationalError
        from core.database import database_engine as engine, DatabaseBase, database_availability as gate, database_session_maker
        from core.availability import DatabaseUnavailable
        from main import app
        from models.user import User
        from services.auth import hash_password, create_access_token
        from services import satellite_tracker as tracker, orbital_data_service as ingestion
        from fastapi.testclient import TestClient
        import jwt

        DatabaseBase.metadata.create_all(engine)  # temporary SQLite ONLY
        state = {"down": False, "queries": 0}
        @event.listens_for(engine, "before_cursor_execute")
        def disconnect(connection, cursor, statement, parameters, context, executemany):
            state["queries"] += 1
            if state["down"]:
                raise OperationalError("SECRET_SQL", {}, RuntimeError("postgresql://SECRET_PASSWORD@SECRET_HOST/SECRET_DATABASE"))
        with database_session_maker() as session:
            user = User(username="reliability", email="reliability@example.invalid", password_hash=hash_password("isolated-test-password"))
            session.add(user); session.commit(); user_id = user.id
        token = create_access_token(user_id)
        auth = {"Authorization": f"Bearer {token}"}
        checks = 0
        def request(client, method, path, status=200, **kwargs):
            nonlocal checks
            response = client.request(method, path, **kwargs)
            assert response.status_code == status, (path, response.status_code, response.text[:200])
            assert "SECRET_" not in response.text and "Traceback" not in response.text
            checks += 1
            return response

        state["down"] = True; gate.next_probe = 0; gate.ready = False
        with patch.object(DatabaseBase.metadata, "create_all", side_effect=AssertionError("API must not perform DDL")), \
             patch.object(ingestion.spacetrack, "get_latest_gp") as st, patch.object(ingestion.celestrak, "get_latest_gp") as ct, \
             TestClient(app, raise_server_exceptions=False) as client:
            request(client, "GET", "/health/live")
            request(client, "GET", "/health/ready", 503)
            request(client, "GET", "/api/auth/me", 503, headers=auth)
            request(client, "GET", "/api/auth/me", 401, headers={"Authorization": "Bearer invalid"})
            request(client, "GET", "/api/satellites/catalog", 401)
            request(client, "POST", "/api/auth/login", 503, json={"username_or_email": "reliability", "password": "isolated-test-password"})
            request(client, "POST", "/api/auth/register", 503, json={"username": "new_test", "email": "new@example.invalid", "password": "test-password"})
            for suffix in ["position", "orbit", "trajectory"]:
                request(client, "GET", f"/api/satellites/25544/{suffix}", 503, headers=auth)
            request(client, "POST", "/api/satellites/trajectories", 503, headers=auth, json={"norad_ids": [25544], "duration_seconds": 180, "step_seconds": 5})
            before = state["queries"]
            with ThreadPoolExecutor(max_workers=12) as pool:
                statuses = list(pool.map(lambda _: client.get("/api/auth/me", headers=auth).status_code, range(40)))
            assert statuses == [503] * 40 and state["queries"] == before, "open outage gate must not fan out DB probes"
            try: ingestion.refresh_orbital_data()
            except DatabaseUnavailable: pass
            else: raise AssertionError("ingestion must stop before providers when DB is unavailable")
            assert not st.called and not ct.called

            state["down"] = False; gate.next_probe = 0  # simulate elapsed backoff
            request(client, "GET", "/health/ready")
            request(client, "GET", "/api/auth/me", headers=auth)
            request(client, "POST", "/api/auth/login", json={"username_or_email": "reliability", "password": "isolated-test-password"})
            request(client, "POST", "/api/auth/register", 201, json={"username": "new_test", "email": "new@example.invalid", "password": "test-password"})
            request(client, "GET", "/api/satellites/catalog", headers=auth)
            # In-memory SGP4 cache never bypasses user validation during outage.
            cache_sentinel = {"propagator": object(), "cached_at": __import__('time').monotonic()}
            tracker.satellite_cache[25544] = cache_sentinel
            state["down"] = True
            request(client, "GET", "/api/satellites/25544/position", 503, headers=auth)
            assert tracker.satellite_cache[25544] is cache_sentinel
            state["down"] = False; gate.next_probe = 0
            request(client, "GET", "/api/auth/me", headers=auth)
            tracker.satellite_cache.clear()
            with patch.object(tracker, "get_satellite_trajectory", side_effect=DatabaseUnavailable()):
                request(client, "POST", "/api/satellites/trajectories", 503, headers=auth, json={"norad_ids": [25544], "step_seconds": 5, "duration_seconds": 180})
            with patch("routes.satellites.get_satellite_position", side_effect=OperationalError("SECRET_SQL", {}, RuntimeError("SECRET_PASSWORD"))):
                request(client, "GET", "/api/satellites/25544/position", 503, headers=auth)
            gate.next_probe = 0
            with patch("routes.satellites.get_satellite_catalog", side_effect=RuntimeError("SECRET_PATH")):
                request(client, "GET", "/api/satellites/catalog", 500, headers=auth)
            request(client, "GET", "/api/satellites/999999/position", 404, headers=auth)
            with patch("routes.auth.verify_password", side_effect=RuntimeError("SECRET_UNEXPECTED_EXCEPTION")):
                # Even raise_server_exceptions=True must not leak the original
                # exception to the ASGI server after emitting a safe response.
                strict_client = TestClient(app)
                failed = request(strict_client, "POST", "/api/auth/login", 500,
                                 headers={"Origin": "http://localhost:5173"},
                                 json={"username_or_email":"reliability", "password":"isolated-test-password"})
                assert failed.headers.get("access-control-allow-origin") == "http://localhost:5173"
                strict_client.close()
            malformed = jwt.encode({"sub": "not-an-integer", "exp": 9999999999}, os.environ["JWT_SECRET_KEY"], algorithm="HS256")
            request(client, "GET", "/api/auth/me", 401, headers={"Authorization": f"Bearer {malformed}"})
            missing_exp = jwt.encode({"sub": str(user_id)}, os.environ["JWT_SECRET_KEY"], algorithm="HS256")
            request(client, "GET", "/api/auth/me", 401, headers={"Authorization": f"Bearer {missing_exp}"})
            bad = request(client, "POST", "/api/auth/login", 422, json={"username_or_email": {}, "password": {"value": "DO_NOT_ECHO"}})
            assert "DO_NOT_ECHO" not in bad.text
            assert not st.called and not ct.called
        engine.dispose()
        print(f"PASS: {checks} isolated real API checks +40 simultaneous outage requests; recovery, auth, cache and sanitized errors; external provider requests0")

    # Real PostgreSQL driver against a closed local port, never the configured DB.
    child = '''import sys,time,json
sys.path.insert(0,'backend')
from unittest.mock import patch
with patch('dotenv.load_dotenv',return_value=False):
 from main import app
 from fastapi.testclient import TestClient
 start=time.monotonic()
 with TestClient(app) as client:
  assert client.get('/health/live').status_code==200
  startup=time.monotonic()-start
  response=client.get('/health/ready')
  assert response.status_code==503 and response.json()['code']=='database_unavailable'
  assert 'password' not in response.text.lower()
  print(json.dumps({'liveStartupSeconds':startup,'totalSeconds':time.monotonic()-start,'readiness':503}))
'''
    env = dict(os.environ, DATABASE_URL="postgresql+psycopg://isolated:fake@127.0.0.1:1/isolated?sslmode=disable",
               JWT_SECRET_KEY=secrets.token_hex(32), ORBITWATCH_INGESTION_ENABLED="false")
    result = subprocess.run([sys.executable, "-c", child], cwd=ROOT, env=env, text=True, capture_output=True, timeout=20)
    assert result.returncode == 0, "isolated PostgreSQL outage child failed (see sanitized diagnostics)"
    print("PASS: real closed-port PostgreSQL startup", result.stdout.strip())


if __name__ == "__main__":
    run()
