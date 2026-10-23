"""Bounded shared weather cache and persistent provider gates (not Supabase).

All same-host API workers share this store/lease. Independent hosts must use a
single weather API host/shared volume, rather than multiply public quotas.
"""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import random
import sqlite3
import time
from email.utils import parsedate_to_datetime


class WeatherDeferred(RuntimeError):
    pass


class WeatherCache:
    def __init__(self, root=None, clock=time.time):
        self.root = Path(root or os.getenv("ORBITWATCH_WEATHER_CACHE_DIR") or Path(__file__).resolve().parents[1] / ".runtime" / "weather")
        self.clock = clock

    @contextmanager
    def db(self):
        self.root.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.root / "cache.sqlite3", timeout=3)
        try:
            with connection:
                connection.execute("CREATE TABLE IF NOT EXISTS data(key TEXT PRIMARY KEY,kind TEXT,payload TEXT,retrieved REAL)")
                connection.execute("CREATE TABLE IF NOT EXISTS gates(provider TEXT PRIMARY KEY,next_at REAL,failures INTEGER)")
                connection.execute("CREATE TABLE IF NOT EXISTS calls(provider TEXT,stamp REAL)")
                yield connection
        finally:
            connection.close()

    def get(self, key):
        with self.db() as db:
            row = db.execute("SELECT payload FROM data WHERE key=?", (key,)).fetchone()
            return json.loads(row[0]) if row else None

    def latest_global(self):
        with self.db() as db:
            row = db.execute("SELECT payload FROM data WHERE kind='global' ORDER BY retrieved DESC LIMIT 1").fetchone()
            return json.loads(row[0]) if row else None

    def put(self, key, kind, value):
        with self.db() as db:
            db.execute("INSERT OR REPLACE INTO data VALUES(?,?,?,?)", (key, kind, json.dumps(value, allow_nan=False, separators=(',', ':')), self.clock()))
            limit = 2 if kind == 'global' else 256
            db.execute("DELETE FROM data WHERE kind=? AND key NOT IN (SELECT key FROM data WHERE kind=? ORDER BY retrieved DESC LIMIT ?)", (kind, kind, limit))

    @contextmanager
    def lease(self):
        self.root.mkdir(parents=True, exist_ok=True)
        file = open(self.root / 'download.lock', 'a+b'); owned = False
        try:
            file.seek(0, 2)
            if file.tell() == 0: file.write(b'0'); file.flush()
            file.seek(0)
            try:
                if os.name == 'nt':
                    import msvcrt
                    msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                owned = True
            except (OSError, BlockingIOError): pass
            yield owned
        finally:
            if owned:
                if os.name == 'nt': file.seek(0); msvcrt.locking(file.fileno(), msvcrt.LK_UNLCK, 1)
                else: fcntl.flock(file.fileno(), fcntl.LOCK_UN)
            file.close()

    def reserve(self, provider):
        now = self.clock()
        interval, hourly, daily = (1800, 4, 32) if provider == 'noaa' else (2, 60, 500)
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT next_at FROM gates WHERE provider=?', (provider,)).fetchone()
            if row and row[0] > now: raise WeatherDeferred()
            db.execute('DELETE FROM calls WHERE stamp<?', (now-86400,))
            hour = db.execute('SELECT COUNT(*) FROM calls WHERE provider=? AND stamp>?', (provider, now-3600)).fetchone()[0]
            day = db.execute('SELECT COUNT(*) FROM calls WHERE provider=?', (provider,)).fetchone()[0]
            if hour >= hourly or day >= daily: raise WeatherDeferred()
            db.execute('INSERT INTO calls VALUES(?,?)', (provider, now))
            db.execute('INSERT INTO gates VALUES(?,?,0) ON CONFLICT(provider) DO UPDATE SET next_at=excluded.next_at', (provider, now+interval+random.uniform(.1, 1)))

    def failed(self, provider, error):
        now = self.clock(); retry = 0
        response = getattr(error, 'response', None)
        if response is not None:
            value = response.headers.get('Retry-After', '')
            try: retry = float(value)
            except ValueError:
                try: retry = parsedate_to_datetime(value).timestamp()-now
                except (ValueError, TypeError, OverflowError): pass
        with self.db() as db:
            row = db.execute('SELECT failures,next_at FROM gates WHERE provider=?', (provider,)).fetchone()
            failures = min((row[0] if row else 0)+1, 7)
            delay = min(21600, (1800 if provider == 'noaa' else 60)*2**(failures-1))
            db.execute('UPDATE gates SET failures=?,next_at=? WHERE provider=?', (failures, max(row[1] if row else now, now+max(delay,retry)+random.uniform(1,5)), provider))

    def succeeded(self, provider):
        with self.db() as db: db.execute('UPDATE gates SET failures=0 WHERE provider=?', (provider,))

    def status(self):
        with self.db() as db:
            return {row[0]: {"next_attempt_at": row[1], "failures": row[2]} for row in db.execute('SELECT provider,next_at,failures FROM gates')}
