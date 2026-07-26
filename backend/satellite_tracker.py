import httpx
from skyfield.api import EarthSatellite, load, wgs84


def get_satellite_position(norad_id):
    celes = f"https://celestrak.org/NORAD/elements/gp.php?CATNR={norad_id}&FORMAT=TLE"

    response = httpx.get(url=celes, timeout=20)
    response.raise_for_status()

    response_text = response.text.strip().splitlines()

    if len(response_text) >= 3:
        name = response_text[0]
        tle_line_1 = response_text[1]
        tle_line_2 = response_text[2]
    else:
        raise ValueError(f"No valid TLE data found for NORAD ID {norad_id}")

    timescale = load.timescale()

    satellite = EarthSatellite(
        name=name, line1=tle_line_1, line2=tle_line_2, ts=timescale
    )

    t = timescale.now()
    current_position = satellite.at(t)
    location = wgs84.geographic_position_of(current_position)
    latitude = float(location.latitude.degrees)
    longitude = float(location.longitude.degrees)
    altitude = float(location.elevation.km)

    return {
        "name": name.strip(),
        "norad_id": norad_id,
        "timestamp": t.utc_iso(),
        "tle_epoch": satellite.epoch.utc_iso(),
        "latitude": round(latitude, 4),
        "longitude": round(longitude, 4),
        "altitude_km": round(altitude, 2),
    }


if __name__ == "__main__":
    satellite_position = get_satellite_position(25544)
    print(satellite_position)
    satellite_position = get_satellite_position(20580)
    print(satellite_position)
