import httpx
from os import getenv
from pathlib import Path
from dotenv import load_dotenv

env_path = Path(__file__).resolve().parent.parent.parent / ".env"

if not env_path.is_file():
    raise FileNotFoundError(f".env file not found at: {env_path}")

load_dotenv(dotenv_path=env_path, override=True)

BASE_URL = "https://www.space-track.org"
SPACETRACK_USERNAME = getenv("SPACETRACK_USERNAME")
SPACETRACK_PASSWORD = getenv("SPACETRACK_PASSWORD")


def create_spacetrack_client() -> httpx.Client:
    if not SPACETRACK_USERNAME or not SPACETRACK_USERNAME.strip():
        raise RuntimeError("SPACETRACK_USERNAME is missing or empty in backend/.env")

    if not SPACETRACK_PASSWORD or not SPACETRACK_PASSWORD.strip():
        raise RuntimeError("SPACETRACK_PASSWORD is missing or empty in backend/.env")

    client = httpx.Client(
        base_url=BASE_URL,
        timeout=30,
        follow_redirects=True,
    )

    response = client.post(
        "/ajaxauth/login",
        data={
            "identity": SPACETRACK_USERNAME,
            "password": SPACETRACK_PASSWORD,
        },
    )

    response.raise_for_status()

    try:
        result = response.json()

        if isinstance(result, dict) and result.get("Login") == "Failed":
            client.close()
            raise RuntimeError("Space-Track login failed")
    except ValueError:
        pass

    return client


def get_latest_gp(norad_ids: list[int]):
    if not norad_ids:
        return []

    ids = ",".join(str(norad_id) for norad_id in norad_ids)

    query = (
        f"/basicspacedata/query/class/gp/NORAD_CAT_ID/{ids}"
        "/orderby/NORAD_CAT_ID/format/json"
    )

    client = create_spacetrack_client()

    try:
        response = client.get(query)
        response.raise_for_status()

        data = response.json()

        if not isinstance(data, list):
            raise RuntimeError("Unexpected response received from Space-Track")

        return data
    finally:
        client.close()
