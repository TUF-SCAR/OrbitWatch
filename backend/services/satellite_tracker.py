import time
from math import sqrt, pi, degrees, isfinite
from datetime import datetime, timedelta, timezone
from skyfield.api import EarthSatellite, load, wgs84
from skyfield.sgp4lib import TEME
from skyfield.framelib import itrs
from core.availability import DatabaseUnavailable

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


def propagate_samples(satellite: EarthSatellite, dates: list[datetime]) -> list[dict]:
    """Additive precise vectors. satellite.at() is GCRS; explicitly convert to TEME.

    Vectorized Skyfield evaluation keeps 2000-sample requests bounded. UT1-UTC
    comes from the installed timescale; no external EOP/provider requests occur.
    ITRS truth is included to verify the consumer's fixed-frame conversion.
    """
    times = timescale.from_datetimes(dates)
    position = satellite.at(times)
    if any(position.message):
        raise ValueError("SGP4 propagation unavailable for requested interval")
    location = wgs84.geographic_position_of(position)
    xyz, velocity = position.frame_xyz_and_velocity(TEME)
    fixed = position.frame_xyz(itrs).km
    samples = []
    for i, date in enumerate(dates):
        r, v, f = xyz.km[:, i].tolist(), velocity.km_per_s[:, i].tolist(), fixed[:, i].tolist()
        if not all(isfinite(value) for value in r + v + f):
            raise ValueError("Non-finite SGP4 state")
        samples.append({"timestamp": date.isoformat(),
            "latitude": round(float(location.latitude.degrees[i]), 4),
            "longitude": round(float(location.longitude.degrees[i]), 4),
            "altitude_km": round(float(location.elevation.km[i]), 2),
            "teme_position_km": r, "teme_velocity_km_s": v,
            "itrs_position_km": f, "ut1_minus_utc_seconds": float(times.dut1[i])})
    return samples


def scientific_metadata(satellite, dates, samples):
    return {"sample_schema": 2, "reference_frame": "TEME", "fixed_reference_frame": "ITRS",
        "position_unit": "km", "velocity_unit": "km/s", "time_system": "UTC",
        "tle_epoch": satellite.epoch.utc_iso(places=6),
        "tle_age_seconds": (dates[0] - satellite.epoch.utc_datetime()).total_seconds(),
        "inclination_degrees": degrees(satellite.model.inclo),
        "eccentricity": satellite.model.ecco,
        "orbital_period_seconds": (2 * pi) / satellite.model.no_kozai * 60,
        "altitude_range_km": [min(p["altitude_km"] for p in samples), max(p["altitude_km"] for p in samples)],
        "propagation_timestamp": dates[0].isoformat(),
        "precision_note": "SGP4 prediction, not an observed fix. TEME vectors avoid geographic rounding; UT1 uses installed Skyfield timescale; polar motion unavailable."}


def get_satellite_position(norad_id: int) -> dict:
    satellite = get_satellite_propagator(norad_id)
    dates = [datetime.now(timezone.utc)]
    samples = propagate_samples(satellite, dates)
    return {"name": satellite.name.strip(), "norad_id": norad_id, **samples[0],
        **scientific_metadata(satellite, dates, samples), **get_satellite_cache_details(norad_id)}


def get_satellite_trajectory(norad_id: int, step_skip: int = 5, prediction_duration: int = 120) -> dict:
    if step_skip <= 0 or prediction_duration <= 0:
        raise ValueError("Sampling interval and duration must be greater than 0")
    satellite = get_satellite_propagator(norad_id)
    initial = datetime.now(timezone.utc)
    dates = [initial + timedelta(seconds=i) for i in range(0, prediction_duration + step_skip, step_skip)]
    samples = propagate_samples(satellite, dates)
    v = samples[0]["teme_velocity_km_s"]
    return {"name": satellite.name.strip(), "norad_id": norad_id, "step_seconds": step_skip,
        "velocity_km_s": round(sqrt(sum(a*a for a in v)), 2),
        "orbital_period_minutes": round((2*pi)/satellite.model.no_kozai, 2), "positions": samples,
        **scientific_metadata(satellite, dates, samples), **get_satellite_cache_details(norad_id)}


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
            if isinstance(error, DatabaseUnavailable):
                raise
            errors.append(
                {
                    "norad_id": norad_id,
                    "message": "Orbital data unavailable for this object or interval",
                }
            )

    return {
        "objects": objects,
        "errors": errors,
    }


def get_satellite_orbit(norad_id: int, samples: int = 480) -> dict:
    if not 2 <= samples <= 2000:
        raise ValueError("Orbit requires 2–2000 samples")
    satellite = get_satellite_propagator(norad_id)
    period = (2*pi)/satellite.model.no_kozai*60
    initial = datetime.now(timezone.utc)
    step = period/(samples-1)
    dates = [initial + timedelta(seconds=i*step) for i in range(samples)]
    positions = propagate_samples(satellite, dates)
    return {"name": satellite.name.strip(), "norad_id": norad_id,
        "start_timestamp": dates[0].isoformat(), "end_timestamp": dates[-1].isoformat(),
        "orbital_period_minutes": round(period/60,2), "step_seconds": round(step,3),
        "samples": samples, "positions": positions,
        **scientific_metadata(satellite, dates, positions), **get_satellite_cache_details(norad_id)}


if __name__ == "__main__":
    satellite = get_satellite_trajectories(
        norad_ids=[25544, 20580],
        step_skip=5,
        prediction_duration=120,
    )

    print(satellite)
