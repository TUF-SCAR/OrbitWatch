import httpx
from services.providers.budget import budget, ProviderAuthorizationError
from os import getenv
import core.config  # optional local configuration, environment takes precedence

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
        follow_redirects=False,
    )

    try:
        response = client.post("/ajaxauth/login",data={"identity":SPACETRACK_USERNAME,"password":SPACETRACK_PASSWORD})
        response.raise_for_status()
        try:
            result=response.json()
        except ValueError:
            result=None
        if isinstance(result,dict) and result.get("Login")=="Failed":
            raise ProviderAuthorizationError("Space-Track login rejected; verify account configuration")
        return client
    except Exception:
        client.close()
        raise


def get_latest_gp(norad_ids: list[int]):
    if not norad_ids: return []
    with budget.attempt("spacetrack",3600,2):
        return _get_latest_gp(norad_ids)


def _get_latest_gp(norad_ids: list[int]):
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
