import time
import httpx
from skyfield.api import EarthSatellite, load, wgs84

timescale = load.timescale()

satellite_cache = dict()
satellite_cache_lifetime = 7200


def get_satellite_propagator(norad_id) -> EarthSatellite:

    for key in satellite_cache:
        if key == norad_id:
            value = satellite_cache.get(key)
            age = time.monotonic() - value["fetched_at"]
            if age < satellite_cache_lifetime:
                print(f"Found {norad_id} space object from cache")
                return value["propagator"]
            else:
                satellite_cache.pop(key)

    celes = f"https://celestrak.org/NORAD/elements/gp.php?CATNR={norad_id}&FORMAT=TLE"

    response = httpx.get(url=celes, timeout=20)
    response.raise_for_status()

    response_text = response.text.strip().splitlines()

    if len(response_text) >= 3:
        name = response_text[0]
        tle_line_1 = response_text[1]
        tle_line_2 = response_text[2]
    else:
        raise ValueError(f"No valid TLE data found for {norad_id} space object")

    satellite = EarthSatellite(
        name=name, line1=tle_line_1, line2=tle_line_2, ts=timescale
    )

    satellite_cache[norad_id] = {
        "propagator": satellite,
        "fetched_at": time.monotonic(),
    }

    print(f"Downloaded fresh TLE for {norad_id} space object")

    return satellite


def get_satellite_position(norad_id) -> dict:
    satellite = get_satellite_propagator(norad_id)

    t = timescale.now()
    current_position = satellite.at(t)
    location = wgs84.geographic_position_of(current_position)
    latitude = float(location.latitude.degrees)
    longitude = float(location.longitude.degrees)
    altitude = float(location.elevation.km)

    return {
        "name": satellite.name.strip(),
        "norad_id": norad_id,
        "timestamp": t.utc_iso(),
        "tle_epoch": satellite.epoch.utc_iso(),
        "latitude": round(latitude, 4),
        "longitude": round(longitude, 4),
        "altitude_km": round(altitude, 2),
    }


if __name__ == "__main__":
    satellite = get_satellite_position(25544)
    print(satellite)
    satellite = get_satellite_position(25544)
    print(satellite)
