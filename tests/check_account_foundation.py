"""Real auth/account integration. Disposable storage ONLY; never reads .env.

Default: temporary SQLite. --postgres: dedicated loopback:55434 test database,
including migration idempotence, storage measurements and concurrent mutations.
--serve leaves this isolated app on loopback:8001 for a bounded UI smoke test.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import secrets
import sys
import tempfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
parser = argparse.ArgumentParser()
parser.add_argument("--postgres", action="store_true")
parser.add_argument("--serve", action="store_true")
args = parser.parse_args()


def run(scratch):
    url = f"sqlite:///{Path(scratch).as_posix()}/account.db"
    if args.postgres:
        import psycopg
        # Fixed disposable local target. No DATABASE_URL from the user's environment.
        with psycopg.connect(host="127.0.0.1", port=55434, user="orbitwatch_test", dbname="postgres", autocommit=True, connect_timeout=5) as admin:
            admin.execute("DROP DATABASE IF EXISTS orbitwatch_account_test WITH (FORCE)")
            admin.execute("CREATE DATABASE orbitwatch_account_test")
        url = "postgresql+psycopg://orbitwatch_test@127.0.0.1:55434/orbitwatch_account_test"
    with patch("dotenv.load_dotenv", return_value=False), patch.dict(os.environ, {
        "DATABASE_URL": url, "JWT_SECRET_KEY": secrets.token_hex(32),
        "ORBITWATCH_INGESTION_ENABLED": "false", "ORBITWATCH_MAX_EVENT_RADIUS_KM": "500",
        "CORS_ALLOWED_ORIGINS": "http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:5174",
    }):
        from sqlalchemy import event, select, text
        from sqlalchemy.exc import IntegrityError
        from core.database import database_engine as engine, DatabaseBase, database_availability, database_session_maker
        from models.user import User
        from models.satellite_orbital_data import SatelliteOrbitalData, SatelliteOrbitalDataHistory
        from models.account import ObservationLocation, NotificationPreferences
        from services.auth import hash_password
        from main import app
        from fastapi.testclient import TestClient

        if not args.postgres:
            @event.listens_for(engine, "connect")
            def foreign_keys(connection, record):
                connection.execute("PRAGMA foreign_keys=ON")
        DatabaseBase.metadata.create_all(engine, tables=[User.__table__, SatelliteOrbitalData.__table__, SatelliteOrbitalDataHistory.__table__])
        checks = 0
        with patch.object(DatabaseBase.metadata, "create_all", side_effect=AssertionError("No startup DDL")), TestClient(app, raise_server_exceptions=False) as client:
            def request(method, path, status=200, account=0, **kw):
                nonlocal checks
                if account:
                    kw["headers"] = {**kw.get("headers", {}), **auth[account]}
                response = client.request(method, path, **kw)
                assert response.status_code == status, (method, path, response.status_code, response.text[:350])
                assert "Traceback" not in response.text and "psycopg" not in response.text and "password_hash" not in response.text
                checks += 1
                return response
            auth = {}
            for n in (1, 2):
                result = request("POST", "/api/auth/register", 201, json={"username": f"account_fixture{n}", "email": f"account{n}@example.invalid", "password": "Disposable-account-2026"}).json()
                auth[n] = {"Authorization": f"Bearer {result['access_token']}"}
            owner_ids = {n: request("GET", "/api/auth/me", account=n).json()["id"] for n in auth}
            location = {"name": "Observation one", "latitude": 12.25, "longitude": 34.5, "timezone": "Asia/Kolkata", "is_default": False}
            for method, path, body in [("GET", "/locations", None), ("POST", "/locations", location), ("GET", "/notification-preferences", None), ("PUT", "/notification-preferences", {"expected_version": 0})]:
                request(method, "/api/account" + path, 401, **({"json": body} if body else {}))
            missing = request("GET", "/api/account/locations", 503, account=1)
            assert missing.json()["code"] == "account_feature_unavailable"
            assert missing.headers["cache-control"] == "no-store"
            request("POST", "/api/account/locations", 503, account=1, json=location)
            request("GET", "/api/account/notification-preferences", 503, account=1)
            request("GET", "/api/auth/me", account=1)
            request("GET", "/health/ready")
            request("GET", "/api/satellites/catalog", account=1)
            assert database_availability.ready
            print("PASS: real auth, unauthenticated rejection, missing schema isolated from auth/Live/readiness, no startup DDL")

            sizes = {}
            def measure(label):
                if args.postgres:
                    with engine.begin() as db:
                        # Local filesystem size scans can be slow under Windows
                        # antivirus/build load. This affects this test probe only.
                        db.execute(text("SET LOCAL statement_timeout=30000"))
                        sizes[label] = dict(database_bytes=db.scalar(text("SELECT pg_database_size(current_database())")),
                            foundation_bytes=int(db.scalar(text("SELECT COALESCE(sum(pg_total_relation_size(oid)),0) FROM pg_class WHERE relname IN ('account_observation_locations','account_notification_preferences')"))))
            measure("before")
            if args.postgres:
                sql = (ROOT / "backend/migrations/002_account_notification_foundation.sql").read_text(encoding="utf-8")
                with psycopg.connect(host="127.0.0.1", port=55434, user="orbitwatch_test", dbname="orbitwatch_account_test", autocommit=True) as db:
                    db.execute(sql, prepare=False); db.execute(sql, prepare=False)
            else:
                # Test schema creation only; PostgreSQL SQL is tested by --postgres.
                ObservationLocation.__table__.create(engine)
                NotificationPreferences.__table__.create(engine)
            measure("empty_migration")
            assert request("GET", "/api/account/locations", account=1).json() == []
            prefs = request("GET", "/api/account/notification-preferences", account=1).json()
            assert not any(prefs[key] for key in ("notifications_enabled", "satellite_alerts", "celestial_alerts", "natural_event_alerts", "delivery_active"))
            assert prefs["version"] == 0 and prefs["created_at"] is None and prefs["resolved_quiet_timezone"] is None
            with database_session_maker() as db:
                assert db.scalar(select(NotificationPreferences)) is None, "reads must not create preferences"

            row = request("POST", "/api/account/locations", 201, account=1, json=location).json()
            assert row["is_default"] and row["created_at"] and row["updated_at"] and row["version"] == 1
            assert request("POST", "/api/account/locations", account=1, json=location).json()["id"] == row["id"]
            assert len(request("GET", "/api/account/locations", account=1).json()) == 1
            request("POST", "/api/account/locations", 409, account=1, json={**location, "name": "Duplicate coordinates"})
            assert request("GET", "/api/account/locations", account=2).json() == []
            body = {**location, "name": "Attempted cross-account update", "is_default": True, "expected_version": row["version"]}
            request("PUT", f"/api/account/locations/{row['id']}", 404, account=2, json=body)
            request("DELETE", f"/api/account/locations/{row['id']}?expected_version=1", 404, account=2)
            request("POST", "/api/account/locations", 422, account=1, json={**location, "owner_id": owner_ids[2]})
            for bad in ({"latitude": 90.1}, {"longitude": -180.1}, {"latitude": "NaN"}, {"latitude": True}, {"longitude": "Infinity"}, {"timezone": "Mars/Olympus"}, {"timezone": ""}, {"name": "x" * 81}, {"name": " "}, {"name": "a\u0000b"}):
                request("POST", "/api/account/locations", 422, account=1, json={**location, **bad})
            # Raw JSON nonfinite literals do not rely on JSON encoder acceptance.
            request("POST", "/api/account/locations", 422, account=1, content=json.dumps(location).replace('12.25', 'NaN'), headers={"Content-Type": "application/json"})
            for i in range(2, 6):
                request("POST", "/api/account/locations", 201, account=1, json={**location, "name": f"Observation {i}", "latitude": i, "longitude": -i, "is_default": i == 3})
            request("POST", "/api/account/locations", 409, account=1, json={**location, "latitude": 6})
            rows = request("GET", "/api/account/locations", account=1).json()
            assert len(rows) == 5 and sum(r["is_default"] for r in rows) == 1
            default = next(r for r in rows if r["is_default"])
            request("PUT", f"/api/account/locations/{default['id']}", 409, account=1, json={**location, "is_default": False, "expected_version": default["version"]})
            editable = next(r for r in rows if not r["is_default"])
            update = {key: editable[key] for key in location}
            edited = request("PUT", f"/api/account/locations/{editable['id']}", account=1, json={**update, "name": "Edited name", "expected_version": editable["version"]}).json()
            assert edited["version"] == editable["version"] + 1
            request("PUT", f"/api/account/locations/{editable['id']}", 409, account=1, json={**update, "expected_version": editable["version"]})
            request("DELETE", f"/api/account/locations/{default['id']}?expected_version={default['version']}", 204, account=1)
            rows = request("GET", "/api/account/locations", account=1).json()
            assert rows[0]["is_default"], "oldest creation/UUID deterministic fallback"
            print("PASS: owner-only CRUD, canonical duplicate retries, finite coordinates/IANA/names, five slots, one default, fallback and stale edits")

            pref_body = {"expected_version": 0, "notifications_enabled": True, "satellite_alerts": True, "celestial_alerts": True, "natural_event_alerts": True,
                         "advance_warning_minutes": 60, "event_radius_km": 500, "quiet_hours_enabled": True, "quiet_start": "22:00", "quiet_end": "07:00", "quiet_timezone_mode": "default_location"}
            for bad in ({"event_radius_km": 501}, {"advance_warning_minutes": 15}, {"quiet_end": "22:00"}, {"quiet_start": "24:00"}, {"quiet_timezone_mode": "explicit", "quiet_timezone": "Not/AZone"}, {"notifications_enabled": "true"}, {"user_id": owner_ids[2]}):
                request("PUT", "/api/account/notification-preferences", 422, account=1, json={**pref_body, **bad})
            saved = request("PUT", "/api/account/notification-preferences", account=1, json=pref_body).json()
            assert saved["version"] == 1 and saved["resolved_quiet_timezone"] == rows[0]["timezone"] and saved["delivery_active"] is False
            assert request("GET", "/api/account/notification-preferences", account=2).json()["notifications_enabled"] is False
            request("PUT", "/api/account/notification-preferences", 409, account=1, json=pref_body)
            # Normal login/new token restores only that account's persistent data.
            login = request("POST", "/api/auth/login", json={"username_or_email": "account_fixture1", "password": "Disposable-account-2026"}).json()
            old_token = auth[1]; auth[1] = {"Authorization": f"Bearer {login['access_token']}"}
            assert request("GET", "/api/account/notification-preferences", account=1).json()["satellite_alerts"]
            assert request("GET", "/api/account/locations", account=2).json() == []
            for item in rows:
                # Default replacement increments versions; reload before each removal.
                fresh = next(r for r in request("GET", "/api/account/locations", account=1).json() if r["id"] == item["id"])
                request("DELETE", f"/api/account/locations/{fresh['id']}?expected_version={fresh['version']}", 204, account=1)
            disabled = request("GET", "/api/account/notification-preferences", account=1).json()
            assert not disabled["quiet_hours_enabled"] and disabled["resolved_quiet_timezone"] is None
            request("PUT", "/api/account/notification-preferences", 422, account=2, json=pref_body)
            explicit = request("PUT", "/api/account/notification-preferences", account=2, json={**pref_body, "quiet_timezone_mode": "explicit", "quiet_timezone": "America/New_York"}).json()
            assert explicit["resolved_quiet_timezone"] == "America/New_York"
            off = request("PUT", "/api/account/notification-preferences", account=1, json={"expected_version": disabled["version"], "quiet_hours_enabled": False, "quiet_timezone_mode": "explicit"}).json()
            assert not off["quiet_hours_enabled"] and off["quiet_timezone"] is None
            print("PASS: safe defaults, preferences validation/persistence/isolation, optimistic versions, quiet-timezone fallback and real login restore")

            if args.postgres:
                def add(i):
                    return client.post("/api/account/locations", headers=auth[2], json={**location, "name": f"Concurrent {i}", "latitude": 30 + i, "longitude": 40 + i}).status_code
                with ThreadPoolExecutor(max_workers=8) as pool:
                    statuses = list(pool.map(add, range(8)))
                assert sorted(statuses) == [201] * 5 + [409] * 3, statuses
                concurrent = request("GET", "/api/account/locations", account=2).json()
                assert len(concurrent) == 5 and sum(r["is_default"] for r in concurrent) == 1
                def choose(row):
                    return client.put(f"/api/account/locations/{row['id']}", headers=auth[2], json={**{key: row[key] for key in location}, "is_default": True, "expected_version": row["version"]}).status_code
                with ThreadPoolExecutor(max_workers=2) as pool:
                    chosen = list(pool.map(choose, [r for r in concurrent if not r["is_default"]][:2]))
                assert all(status in (200, 409) for status in chosen), chosen
                assert sum(r["is_default"] for r in request("GET", "/api/account/locations", account=2).json()) == 1
                body = {**pref_body, "expected_version": explicit["version"], "quiet_timezone_mode": "explicit", "quiet_timezone": "UTC"}
                with ThreadPoolExecutor(max_workers=2) as pool:
                    results = list(pool.map(lambda _: client.put("/api/account/notification-preferences", headers=auth[2], json=body).status_code, range(2)))
                assert sorted(results) == [200, 409], results
                with psycopg.connect(host="127.0.0.1", port=55434, user="orbitwatch_test", dbname="orbitwatch_account_test", autocommit=True) as db:
                    db.execute(sql, prepare=False)
                assert len(request("GET", "/api/account/locations", account=2).json()) == 5
                print("PASS: PostgreSQL migration applied/reapplied with data, concurrent cap/defaults and compare-and-save preferences")

            # Bypass API to prove the database still enforces critical invariants.
            for bad in ({"slot": 6}, {"latitude": 91}, {"name": ""}):
                with engine.connect() as db:
                    transaction = db.begin()
                    try:
                        db.execute(ObservationLocation.__table__.insert().values({**location, "owner_id": owner_ids[1], "slot": 1, **bad}))
                    except IntegrityError:
                        transaction.rollback()
                    else:
                        raise AssertionError("database accepted invalid location")
            with engine.begin() as db:
                db.execute(ObservationLocation.__table__.insert().values(owner_id=owner_ids[1], slot=1, name="Constraint fixture", latitude=0, longitude=0, timezone="UTC", is_default=True))
            for bad in ({"slot": 1, "latitude": 1, "longitude": 1}, {"slot": 2}, {"slot": 2, "latitude": 2, "longitude": 2, "is_default": True}, {"owner_id": 999999, "slot": 2, "latitude": 2, "longitude": 2}):
                with engine.connect() as db:
                    transaction = db.begin()
                    try:
                        db.execute(ObservationLocation.__table__.insert().values({"owner_id": owner_ids[1], "slot": 1, "name": "Constraint fixture", "latitude": 0, "longitude": 0, "timezone": "UTC", "is_default": False, **bad}))
                    except IntegrityError:
                        transaction.rollback()
                    else:
                        raise AssertionError("database accepted duplicate slot/coordinates/default or invalid owner")
            for bad in ({"event_radius_km": 2001}, {"advance_warning_minutes": 15}, {"quiet_hours_enabled": True, "quiet_start": None}):
                with engine.connect() as db:
                    transaction = db.begin()
                    try:
                        db.execute(NotificationPreferences.__table__.update().where(NotificationPreferences.owner_id == owner_ids[1]).values(**bad))
                    except IntegrityError:
                        transaction.rollback()
                    else:
                        raise AssertionError("database accepted invalid preferences")
            with database_session_maker() as db:
                disposable = User(username="cascade_fixture", email="cascade@example.invalid", password_hash="unused-test-hash")
                db.add(disposable);db.flush();cascade_id=disposable.id
                db.add(ObservationLocation(owner_id=cascade_id,slot=1,name="Cascade fixture",latitude=0,longitude=0,timezone="UTC"))
                db.add(NotificationPreferences(owner_id=cascade_id));db.commit()
                db.delete(disposable);db.commit()
                assert not db.scalar(select(ObservationLocation).where(ObservationLocation.owner_id==cascade_id))
                assert not db.get(NotificationPreferences,cascade_id)
            if args.postgres:
                with psycopg.connect(host="127.0.0.1", port=55434, user="orbitwatch_test", dbname="orbitwatch_account_test", autocommit=True) as db:
                    db.execute("DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='account_browser_fixture') THEN CREATE ROLE account_browser_fixture NOLOGIN; END IF; END $$")
                    db.execute("GRANT USAGE ON SCHEMA public TO account_browser_fixture")
                    db.execute("GRANT SELECT ON account_observation_locations,account_notification_preferences TO account_browser_fixture")
                    db.execute("SET ROLE account_browser_fixture")
                    assert db.execute("SELECT count(*) FROM account_observation_locations").fetchone()[0] == 0
                    assert db.execute("SELECT count(*) FROM account_notification_preferences").fetchone()[0] == 0
                    db.execute("RESET ROLE")
                print("PASS: PostgreSQL RLS hides rows from a granted non-owner browser role")
            measure("populated")
            request("OPTIONS", "/api/account/locations", headers={"Origin": "http://127.0.0.1:5173", "Access-Control-Request-Method": "DELETE"})
            cors = request("OPTIONS", "/api/account/notification-preferences", headers={"Origin": "http://127.0.0.1:5173", "Access-Control-Request-Method": "PUT"})
            assert "PUT" in cors.headers["access-control-allow-methods"]
            request("OPTIONS", "/api/account/locations", 400, headers={"Origin": "https://untrusted.invalid", "Access-Control-Request-Method": "PUT"})
            foundation_sources = "\n".join((ROOT / path).read_text(encoding="utf-8") for path in ("backend/routes/account.py", "frontend/src/services/accountSettings.js", "frontend/src/components/AccountNotificationSettings.jsx"))
            assert all(token not in foundation_sources for token in ("requestPermission", "new Notification(", "PushManager", "serviceWorker.register", "send_mail", "smtplib"))
            print("PASS: database constraints, cascades, explicit CORS methods/origins, no foundation delivery/push calls")
            print("HTTP CHECKS", checks, "STORAGE", json.dumps(sizes))
        if args.serve:
            print("DISPOSABLE UI LOGIN: account_fixture1 / Disposable-account-2026", flush=True)
            import uvicorn
            uvicorn.run(app, host="127.0.0.1", port=8001, access_log=False)
        engine.dispose()


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="account-foundation-") as scratch:
        run(scratch)
