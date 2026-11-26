"""Disposable authentication and session-policy checks."""
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
import jwt
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
os.environ['DATABASE_URL'] = 'sqlite://'
os.environ['JWT_SECRET_KEY'] = 'isolated-auth-check-test-only-32-bytes'

from core.database import DatabaseBase, get_database_session
from models.auth_state import AuthAttempt, RevokedSession
from models.user import User
from routes.auth import router
from services.auth import JWT_SECRET_KEY
from services.location_timezone import resolve


class Authentication(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        engine = create_engine(f"sqlite:///{Path(scratch.name).as_posix()}/auth.db")
        self.addCleanup(engine.dispose)
        DatabaseBase.metadata.create_all(engine, tables=[
            User.__table__, AuthAttempt.__table__, RevokedSession.__table__,
        ])
        self.engine = engine
        app = FastAPI()
        app.include_router(router)

        def session():
            with Session(engine) as db:
                yield db

        app.dependency_overrides[get_database_session] = session
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def register(self, username='OrbitUser', email='Name+tag@EXAMPLE.INVALID', password='Local-Fixture-Only-2026'):
        return self.client.post('/api/auth/register', json={
            'username': username, 'email': email, 'password': password,
        })

    def login(self, identifier, password='Local-Fixture-Only-2026'):
        return self.client.post('/api/auth/login', json={'username_or_email': identifier, 'password': password})

    def me(self, token):
        return self.client.get('/api/auth/me', headers={'Authorization': f'Bearer {token}'})

    def test_session_is_unique_and_logout_revokes_only_that_session(self):
        first = self.register()
        self.assertEqual(first.status_code, 201)
        self.assertEqual(first.headers['cache-control'], 'no-store')
        token = first.json()['access_token']
        other = self.login('Name+tag@example.INVALID').json()['access_token']
        self.assertNotEqual(token, other)
        self.assertEqual(self.me(token).json()['email'], 'Name+tag@example.invalid')
        response = self.client.post('/api/auth/logout', json={}, headers={'Authorization': f'Bearer {token}'})
        self.assertEqual(response.status_code, 204)
        self.assertEqual(self.me(token).status_code, 401)
        self.assertEqual(self.me(other).status_code, 200)
        with Session(self.engine) as db:
            stored = db.scalar(select(User))
            self.assertTrue(stored.password_hash.startswith('$argon2id$'))
            self.assertNotIn('Local-Fixture', stored.password_hash)

    def test_duplicate_normalization_preserves_distinct_local_parts(self):
        self.assertEqual(self.register('Cafe\u0301').status_code, 201)
        self.assertEqual(self.register('Café', 'different@example.invalid').status_code, 409)
        self.assertEqual(self.register('Another', 'Name+tag@example.invalid').status_code, 409)
        self.assertEqual(self.register('Another', 'name+tag@example.invalid').status_code, 201)
        self.assertEqual(self.register('Third', 'Name@example.invalid').status_code, 201)
        self.assertEqual(self.login('Café').status_code, 200)
        self.assertEqual(self.login('Name+tag@example.invalid', 'incorrect password').status_code, 401)

    def test_new_password_minimum_preserves_legacy_and_exact_passwords(self):
        self.assertEqual(self.register(password='too-short').status_code, 400)
        password = '  Local password phrase  '
        self.assertEqual(self.register(password=password).status_code, 201)
        self.assertEqual(self.login('OrbitUser', password).status_code, 200)
        self.assertEqual(self.login('OrbitUser', password.strip()).status_code, 401)
        from services.auth import hash_password
        with Session(self.engine) as db:
            db.add(User(username='Legacy', email='legacy@example.invalid', password_hash=hash_password('old-pass')))
            db.commit()
        self.assertEqual(self.login('Legacy', 'old-pass').status_code, 200)

    def test_expired_wrong_signature_and_missing_sessions_are_rejected(self):
        self.assertEqual(self.register().status_code, 201)
        now = datetime.now(timezone.utc)
        expired = jwt.encode({'sub':'1','exp':now-timedelta(minutes=1)}, JWT_SECRET_KEY, algorithm='HS256')
        wrong_key = jwt.encode({'sub':'1','exp':now+timedelta(minutes=1)}, 'different-fixture-signing-key-local-only', algorithm='HS256')
        for token in (expired, wrong_key):
            self.assertEqual(self.me(token).status_code, 401)
        self.assertEqual(self.client.get('/api/auth/me').status_code, 401)

    def test_login_and_registration_limits_report_retry_after(self):
        from services.auth_state import consume_attempt
        with Session(self.engine) as db, patch('services.auth_state.time.time', return_value=9001):
            for _ in range(20):
                consume_attempt(db, 'login', 'testclient', 20, 300)
            for _ in range(10):
                consume_attempt(db, 'register', 'testclient', 10, 3600)
            for response in (self.login('OrbitUser'), self.register()):
                self.assertEqual(response.status_code, 429)
                self.assertGreater(int(response.headers['retry-after']), 0)

    def test_geographic_timezones_across_a_border(self):
        self.assertEqual(resolve(40.7128, -74.006)['timezone'], 'America/New_York')
        self.assertEqual(resolve(28.6139, 77.209)['timezone'], 'Asia/Kolkata')
        arizona = resolve(36.995, -112.0)
        utah = resolve(37.005, -112.0)
        self.assertEqual(arizona['timezone'], 'America/Phoenix')
        self.assertEqual(utah['timezone'], 'America/Denver')


if __name__ == '__main__':
    unittest.main()
