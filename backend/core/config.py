"""Environment-first configuration; a local .env is optional, never authoritative."""
from os import getenv
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)


def required(name: str) -> str:
    value = getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Required configuration is missing: {name}")
    return value


def enabled(name: str, default=True) -> bool:
    return getenv(name, str(default)).lower() in {"true", "1", "yes"}


def cors_origins() -> list[str]:
    values = getenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    origins = [value.strip().rstrip("/") for value in values.split(",") if value.strip()]
    from urllib.parse import urlsplit
    for origin in origins:
        parsed = urlsplit(origin)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password:
            raise RuntimeError("CORS_ALLOWED_ORIGINS must contain explicit HTTP(S) origins")
    return origins
