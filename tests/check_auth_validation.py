"""Validation and password regression checks; isolated in-memory SQLite only."""
import os
from pathlib import Path
import secrets
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
with patch('dotenv.load_dotenv', return_value=False), patch.dict(os.environ, {
    'DATABASE_URL': 'sqlite:///:memory:', 'JWT_SECRET_KEY': secrets.token_hex(32),
}):
    from core.security import check_email, check_username_char
    from routes.auth import router
    from schemas.auth import RegisterRequest, LoginRequest
    from models.user import User
    from core.database import get_database_session

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool


class ValidationTests(unittest.TestCase):
    def test_usernames(self):
        for value in ['abc', 'User.Name', 'user_123', '_user_', '用户名', 'x' * 50]:
            with self.subTest(value=value): self.assertTrue(check_username_char(value))
        for value in [None, '', 'ab', 'x' * 51, 'user name', 'user-name', '.user', 'user.', 'a..b', 'user@x', 'user\n', 'a²b']:
            with self.subTest(value=value): self.assertFalse(check_username_char(value))

    def test_emails(self):
        for value in ['a@example.com', 'ab@example.co.uk', 'first.last+tag@sub-domain.example.org', "o'brien@example.com", 'x' * 64 + '@example.com']:
            with self.subTest(value=value): self.assertTrue(check_email(value))
        for value in [None, '', 'a@@example.com', '@example.com', 'x' * 65 + '@example.com', '.abc@example.com', 'abc.@example.com', 'a..b@example.com', 'ab c@example.com', 'abc@example', 'abc@-example.com', 'abc@example-.com', 'abc@exam_ple.com', 'abc@example..com', 'abc@example.c', 'abc@example.123', 'abc@' + 'a' * 64 + '.com', 'abc@example.com\n', 'ü@example.com']:
            with self.subTest(value=value): self.assertFalse(check_email(value))

    def test_schemas_preserve_password_contents(self):
        self.assertEqual(RegisterRequest(username='user', email='u@example.com', password=' secret  ').password, ' secret  ')
        self.assertEqual(LoginRequest(username_or_email='user', password=' secret  ').password, ' secret  ')

    def test_register_login_errors_and_exact_password_roundtrip(self):
        engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        User.__table__.create(engine)
        app = FastAPI()
        app.include_router(router)
        def session():
            with Session(engine) as database: yield database
        app.dependency_overrides[get_database_session] = session
        try:
            with TestClient(app) as client:
                base = {'username': 'valid_user', 'email': 'valid@example.com', 'password': ' pass word '}
                for change in [{'username': 'bad name'}, {'username': 'a..b'}, {'email': 'bad@@example.com'}, {'password': '        '}]:
                    self.assertEqual(client.post('/api/auth/register', json={**base, **change}).status_code, 400)
                self.assertEqual(client.post('/api/auth/register', json=base).status_code, 201)
                for identity in ['valid_user', 'valid@example.com', ' valid_user ']:
                    self.assertEqual(client.post('/api/auth/login', json={'username_or_email': identity, 'password': base['password']}).status_code, 200)
                self.assertEqual(client.post('/api/auth/login', json={'username_or_email': 'valid_user', 'password': base['password'].strip()}).status_code, 401)
                for identity in ['bad name', 'bad@@example.com', '.bad']:
                    self.assertEqual(client.post('/api/auth/login', json={'username_or_email': identity, 'password': base['password']}).status_code, 400)
        finally:
            engine.dispose()


if __name__ == '__main__':
    unittest.main()
