import time
from math import sqrt, pi
from datetime import datetime, timedelta, timezone
from skyfield.api import EarthSatellite, load, wgs84

from repositories.satellite_orbital_data import (
    get_all_orbital_records,
    get_orbital_record,
)

timescale = load.timescale()

satellite_cache = dict()
satellite_cache_lifetime = 3600


def clear_satellite_cache(norad_ids: list[int] | None = None) -> None:
    if norad_ids is None:
        satellite_cache.clear()
        print("Cleared all satellite propagators from RAM cache")
        return

    for norad_id in norad_ids:
        satellite_cache.pop(norad_id, None)

    print(f"Cleared {len(norad_ids)} satellite propagators from RAM cache")


def create_satellite_propagator(record: dict) -> EarthSatellite:
    satellite = EarthSatellite(
        name=record["object_name"],
        line1=record["tle_line1"],
        line2=record["tle_line2"],
        ts=timescale,
    )

    satellite_cache[record["norad_id"]] = {
        "propagator": satellite,
        "cached_at": time.monotonic(),
        "source": record.get("source"),
        "data_fetched_at": record.get("fetched_at"),
        "history": record.get("history", False),
    }

    return satellite


def get_satellite_propagator(norad_id: int) -> EarthSatellite:
    cache_data = satellite_cache.get(norad_id)

    if cache_data:
        age = time.monotonic() - cache_data["cached_at"]

        if age < satellite_cache_lifetime:
            print(f"Found {norad_id} space object from RAM cache")
            return cache_data["propagator"]

        satellite_cache.pop(norad_id)

    record = get_orbital_record(norad_id)

    if record is None:
        raise LookupError(f"No orbital data available for NORAD ID {norad_id}")

    satellite = create_satellite_propagator(record)

    if record.get("history"):
        print(f"Loaded {norad_id} space object from orbital history")
    else:
        print(f"Loaded {norad_id} space object from database")

    return satellite


def prefetch_satellite_propagators(norad_ids: list[int]) -> None:
    missing_ids = set()

    for norad_id in norad_ids:
        cache_data = satellite_cache.get(norad_id)

        if cache_data:
            age = time.monotonic() - cache_data["cached_at"]

            if age < satellite_cache_lifetime:
                continue

            satellite_cache.pop(norad_id)

        missing_ids.add(norad_id)

    if not missing_ids:
        return

    records = get_all_orbital_records()

    for record in records:
        norad_id = record["norad_id"]

        if norad_id not in missing_ids:
            continue

        create_satellite_propagator(record)
        missing_ids.remove(norad_id)

        print(f"Prefetched {norad_id} space object from database")

        if not missing_ids:
            break

    for norad_id in list(missing_ids):
        try:
            get_satellite_propagator(norad_id)
        except Exception:
            continue


def get_satellite_cache_details(norad_id: int) -> dict:
    cache_data = satellite_cache.get(norad_id)

    if cache_data is None:
        return {
            "orbital_source": None,
            "orbital_data_fetched_at": None,
            "using_history": False,
        }

    fetched_at = cache_data.get("data_fetched_at")

    return {
        "orbital_source": cache_data.get("source"),
        "orbital_data_fetched_at": (
            fetched_at.isoformat() if fetched_at is not None else None
        ),
        "using_history": cache_data.get("history", False),
    }


def get_satellite_position(norad_id: int) -> dict:
    satellite = get_satellite_propagator(norad_id)

    t = timescale.now()
    current_position = satellite.at(t)
    location = wgs84.geographic_position_of(current_position)
    latitude = float(location.latitude.degrees)
    longitude = float(location.longitude.degrees)
    altitude = float(location.elevation.km)
    cache_details = get_satellite_cache_details(norad_id)

    return {
        "name": satellite.name.strip(),
        "norad_id": norad_id,
        "timestamp": t.utc_iso(),
        "tle_epoch": satellite.epoch.utc_iso(),
        "latitude": round(latitude, 4),
        "longitude": round(longitude, 4),
        "altitude_km": round(altitude, 2),
        **cache_details,
    }


def get_satellite_trajectory(
    norad_id: int, step_skip: int = 5, prediction_duration: int = 120
) -> dict:
    if step_skip <= 0:
        raise ValueError("step_seconds must be greater than 0")

    if prediction_duration <= 0:
        raise ValueError("duration_seconds must be greater than 0")

    satellite = get_satellite_propagator(norad_id)
    initial_time = datetime.now(timezone.utc)
    positions = []

    initial_satellite_time = timescale.from_datetime(initial_time)
    initial_satellite_position = satellite.at(initial_satellite_time)

    velocity = initial_satellite_position.velocity.km_per_s
    velocity_km_s = sqrt(velocity[0] ** 2 + velocity[1] ** 2 + velocity[2] ** 2)
    orbital_period_minutes = (2 * pi) / satellite.model.no_kozai

    for i in range(0, prediction_duration + step_skip, step_skip):
        future_time = initial_time + timedelta(seconds=i)
        satellite_time = timescale.from_datetime(future_time)
        satellite_position = satellite.at(satellite_time)
        location = wgs84.geographic_position_of(satellite_position)
        latitude = float(location.latitude.degrees)
        longitude = float(location.longitude.degrees)
        altitude = float(location.elevation.km)
        positions.append(
            {
                "timestamp": future_time.isoformat(),
                "latitude": round(latitude, 4),
                "longitude": round(longitude, 4),
                "altitude_km": round(altitude, 2),
            }
        )

    cache_details = get_satellite_cache_details(norad_id)

    return {
        "name": satellite.name.strip(),
        "norad_id": norad_id,
        "tle_epoch": satellite.epoch.utc_iso(),
        "step_seconds": step_skip,
        "velocity_km_s": round(velocity_km_s, 2),
        "orbital_period_minutes": round(orbital_period_minutes, 2),
        "positions": positions,
        **cache_details,
    }


def get_satellite_trajectories(
    norad_ids: list[int], step_skip: int, prediction_duration: int
) -> dict:
    if not norad_ids:
        raise ValueError("At least one NORAD ID is required")

    if step_skip <= 0:
        raise ValueError("step_seconds must be greater than 0")

    if prediction_duration <= 0:
        raise ValueError("duration_seconds must be greater than 0")

    prefetch_satellite_propagators(norad_ids=norad_ids)

    objects = []
    errors = []

    for norad_id in norad_ids:
        try:
            result = get_satellite_trajectory(
                norad_id=norad_id,
                step_skip=step_skip,
                prediction_duration=prediction_duration,
            )
            objects.append(result)
        except Exception as error:
            errors.append(
                {
                    "norad_id": norad_id,
                    "message": str(error),
                }
            )

    return {
        "objects": objects,
        "errors": errors,
    }


def get_satellite_orbit(norad_id: int, samples: int = 480) -> dict:
    if samples < 2:
        raise ValueError("Orbit requires at least 2 samples")

    satellite = get_satellite_propagator(norad_id=norad_id)
    orbital_period_minutes = (2 * pi) / satellite.model.no_kozai
    orbital_period_seconds = orbital_period_minutes * 60
    initial_time = datetime.now(timezone.utc)
    step_seconds = orbital_period_seconds / (samples - 1)
    positions = []

    for i in range(samples):
        future_time = initial_time + timedelta(seconds=i * step_seconds)
        satellite_time = timescale.from_datetime(future_time)
        satellite_position = satellite.at(satellite_time)
        location = wgs84.geographic_position_of(satellite_position)
        latitude = float(location.latitude.degrees)
        longitude = float(location.longitude.degrees)
        altitude = float(location.elevation.km)

        positions.append(
            {
                "timestamp": future_time.isoformat(),
                "latitude": round(latitude, 4),
                "longitude": round(longitude, 4),
                "altitude_km": round(altitude, 2),
            }
        )

    cache_details = get_satellite_cache_details(norad_id)

    return {
        "name": satellite.name.strip(),
        "norad_id": norad_id,
        "start_timestamp": initial_time.isoformat(),
        "end_timestamp": (
            initial_time + timedelta(seconds=orbital_period_seconds)
        ).isoformat(),
        "orbital_period_minutes": round(orbital_period_minutes, 2),
        "step_seconds": round(step_seconds, 3),
        "samples": samples,
        "positions": positions,
        **cache_details,
    }

if __name__ == "__main__":
    satellite = get_satellite_trajectories(
        norad_ids=[25544, 20580],
        step_skip=5,
        prediction_duration=120,
    )

    print(satellite)
