import json
from pathlib import Path
from datetime import datetime, timezone

from repositories.satellite_orbital_data import (
    archive_current_orbital_records,
    delete_old_orbital_history,
    get_all_orbital_records,
    get_latest_orbital_timestamp,
    get_oldest_orbital_timestamp,
    get_orbital_history_count,
    get_orbital_record_count,
    save_orbital_records,
)
from services.providers import celestrak, spacetrack

space_objects_json_path = (
    Path(__file__).resolve().parent.parent / "data" / "space_objects.json"
)

orbital_data_lifetime = 3600
orbital_history_lifetime = 7200
provider_retry_cooldown = 3600
last_provider_attempt_at = None


def get_supported_norad_ids() -> list[int]:
    with open(space_objects_json_path, "r") as file:
        objects = json.load(file)

    norad_ids = []

    for norad_id in objects:
        try:
            parsed_norad_id = int(norad_id)
        except (TypeError, ValueError):
            continue

        if parsed_norad_id not in norad_ids:
            norad_ids.append(parsed_norad_id)

    return norad_ids


def orbital_data_is_stale(norad_ids: list[int] | None = None) -> bool:
    if norad_ids is None:
        norad_ids = get_supported_norad_ids()

    oldest_timestamp = get_oldest_orbital_timestamp(norad_ids)

    if oldest_timestamp is None:
        return True

    if oldest_timestamp.tzinfo is None:
        oldest_timestamp = oldest_timestamp.replace(tzinfo=timezone.utc)

    age = datetime.now(timezone.utc) - oldest_timestamp

    return age.total_seconds() >= orbital_data_lifetime


def orbital_data_is_missing(norad_ids: list[int]) -> bool:
    current_records = get_all_orbital_records()
    available_ids = set()

    for record in current_records:
        available_ids.add(record["norad_id"])

    for norad_id in norad_ids:
        if norad_id not in available_ids:
            return True

    return False


def refresh_orbital_data(force: bool = False) -> dict:
    global last_provider_attempt_at

    norad_ids = get_supported_norad_ids()

    deleted_history = delete_old_orbital_history(
        max_age_seconds=orbital_history_lifetime
    )

    stale = orbital_data_is_stale(norad_ids)
    missing = orbital_data_is_missing(norad_ids)

    if not force and not stale and not missing:
        return {
            "refreshed": False,
            "source": None,
            "received": 0,
            "saved": 0,
            "archived": 0,
            "deleted_history": deleted_history,
            "reason": "Current orbital data is still fresh",
        }

    if not force and last_provider_attempt_at is not None:
        attempt_age = datetime.now(timezone.utc) - last_provider_attempt_at

        if attempt_age.total_seconds() < provider_retry_cooldown:
            return {
                "refreshed": False,
                "source": None,
                "received": 0,
                "saved": 0,
                "archived": 0,
                "deleted_history": deleted_history,
                "reason": "Orbital provider retry cooldown is active",
            }

    last_provider_attempt_at = datetime.now(timezone.utc)

    records = []
    source = None
    spacetrack_error = None
    celestrak_error = None

    try:
        print(f"Requesting {len(norad_ids)} orbital records from Space-Track")
        records = spacetrack.get_latest_gp(norad_ids)

        if not records:
            raise RuntimeError("Space-Track returned no orbital records")

        source = "spacetrack"
        print(f"Received {len(records)} orbital records from Space-Track")
    except Exception as error:
        spacetrack_error = str(error)
        print(f"Space-Track refresh failed: {error}")

    if not records:
        try:
            print("Trying CelesTrak fallback")
            records = celestrak.get_latest_gp(norad_ids)

            if not records:
                raise RuntimeError("CelesTrak returned no orbital records")

            source = "celestrak"
            print(f"Received {len(records)} orbital records from CelesTrak")
        except Exception as error:
            celestrak_error = str(error)
            print(f"CelesTrak refresh failed: {error}")

    if not records:
        return {
            "refreshed": False,
            "source": None,
            "received": 0,
            "saved": 0,
            "archived": 0,
            "deleted_history": deleted_history,
            "reason": "Both orbital data providers failed. Existing database data kept.",
            "spacetrack_error": spacetrack_error,
            "celestrak_error": celestrak_error,
        }

    received_ids = []

    for record in records:
        norad_id = record.get("NORAD_CAT_ID")

        if norad_id is None:
            continue

        try:
            received_ids.append(int(norad_id))
        except (TypeError, ValueError):
            continue

    archived = archive_current_orbital_records(received_ids)
    saved = save_orbital_records(records=records, source=source)

    try:
        from services.satellite_tracker import clear_satellite_cache

        clear_satellite_cache(received_ids)
    except Exception as error:
        print(f"Could not clear satellite RAM cache: {error}")

    return {
        "refreshed": True,
        "source": source,
        "received": len(records),
        "saved": saved,
        "archived": archived,
        "deleted_history": deleted_history,
        "reason": "Orbital data refreshed",
        "spacetrack_error": spacetrack_error,
        "celestrak_error": celestrak_error,
    }


def get_orbital_data_status() -> dict:
    norad_ids = get_supported_norad_ids()
    latest_timestamp = get_latest_orbital_timestamp()
    oldest_timestamp = get_oldest_orbital_timestamp(norad_ids)
    age_seconds = None

    if oldest_timestamp is not None:
        if oldest_timestamp.tzinfo is None:
            oldest_timestamp = oldest_timestamp.replace(tzinfo=timezone.utc)

        age = datetime.now(timezone.utc) - oldest_timestamp
        age_seconds = max(0, int(age.total_seconds()))

    if latest_timestamp is not None:
        if latest_timestamp.tzinfo is None:
            latest_timestamp = latest_timestamp.replace(tzinfo=timezone.utc)

    return {
        "supported_objects": len(norad_ids),
        "current_records": get_orbital_record_count(),
        "history_records": get_orbital_history_count(),
        "latest_fetched_at": (
            latest_timestamp.isoformat() if latest_timestamp is not None else None
        ),
        "oldest_fetched_at": (
            oldest_timestamp.isoformat() if oldest_timestamp is not None else None
        ),
        "age_seconds": age_seconds,
        "refresh_interval_seconds": orbital_data_lifetime,
        "history_retention_seconds": orbital_history_lifetime,
        "provider_retry_cooldown_seconds": provider_retry_cooldown,
        "last_provider_attempt_at": (
            last_provider_attempt_at.isoformat()
            if last_provider_attempt_at is not None
            else None
        ),
        "stale": orbital_data_is_stale(norad_ids),
        "missing_supported_objects": orbital_data_is_missing(norad_ids),
    }
