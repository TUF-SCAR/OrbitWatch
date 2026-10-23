"""One bounded, read-only database probe per process, shared by all requests."""
import logging
import random
import threading
import time
from sqlalchemy.exc import SQLAlchemyError

logger = logging.getLogger("orbitwatch.dependencies")


class DatabaseUnavailable(RuntimeError):
    pass


class DatabaseAvailability:
    def __init__(self, probe, clock=time.monotonic, jitter=lambda: random.uniform(0, 1)):
        self.probe, self.clock, self.jitter = probe, clock, jitter
        self.lock = threading.Lock()
        self.ready = False
        self.next_probe = 0
        self.failures = 0

    def failed(self, error):
        self.ready = False
        self.failures = min(self.failures + 1, 5)
        self.next_probe = self.clock() + min(60, 5 * 2 ** (self.failures - 1)) + self.jitter()
        # Never log SQLAlchemy exception strings/tracebacks: they can contain SQL,
        # bound parameters, passwords, hosts or connection URLs.
        logger.warning("Database unavailable (%s); recovery probe deferred", type(error).__name__)

    def ensure(self):
        if self.clock() < self.next_probe:
            if self.ready:
                return
            raise DatabaseUnavailable()
        if not self.lock.acquire(blocking=False):
            if self.ready:
                return
            raise DatabaseUnavailable()
        try:
            if self.clock() < self.next_probe:
                if self.ready:
                    return
                raise DatabaseUnavailable()
            try:
                self.probe()
            except SQLAlchemyError as error:
                self.failed(error)
                raise DatabaseUnavailable() from None
            self.ready, self.failures = True, 0
            self.next_probe = self.clock() + 5
        finally:
            self.lock.release()
