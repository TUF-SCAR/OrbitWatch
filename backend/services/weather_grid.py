"""Decode one NOAA GFS regular lat/lon 2m temperature field; no network here."""
from datetime import datetime, timezone
import numpy as np


def iso(value):
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def decode_temperature(data: bytes, source_file: str, retrieved_at: datetime) -> dict:
    from eccodes import codes_new_from_message, codes_get, codes_get_array, codes_get_values, codes_release, codes_get_message_size
    if not data.startswith(b'GRIB') or len(data) > 2000000:
        raise ValueError('Expected one bounded GRIB message')
    # Message API avoids Windows FILE*/TemporaryFile incompatibilities.
    handle = codes_new_from_message(data)
    if handle is None:
        raise ValueError("No GRIB field")
    try:
        get = lambda key: codes_get(handle, key)
        if (get("shortName"), get("typeOfLevel"), get("level"), get("units"), get("gridType")) != ("2t", "heightAboveGround", 2, "K", "regular_ll"):
            raise ValueError("Unexpected temperature field")
        if (get("Ni"), get("Nj")) != (360, 181) or get("iDirectionIncrementInDegrees") != 1 or get("jDirectionIncrementInDegrees") != 1:
            raise ValueError("Expected global one-degree grid")
        values = np.asarray(codes_get_values(handle), dtype=float)
        lats, lons = codes_get_array(handle, "latitudes"), codes_get_array(handle, "longitudes")
        y = np.rint(90 - lats).astype(int)
        x = np.rint((lons + 180) % 360).astype(int)
        if len(values) != 65160 or np.any(y < 0) or np.any(y > 180) or np.any(x < 0) or np.any(x > 359) or len(np.unique(y * 360 + x)) != 65160:
            raise ValueError("Incomplete or repeated global coordinates")
        if not np.allclose(lats,90-y,atol=1e-6) or not np.allclose((lons+180)%360,x,atol=1e-6):
            raise ValueError("Grid origin is not aligned to one-degree nodes")
        valid = np.isfinite(values) & (values != get("missingValue"))
        if np.any((values[valid] < 140) | (values[valid] > 360)) or valid.mean() < .95:
            raise ValueError("Temperature field failed plausibility/coverage check")
        output = np.full((181, 360), np.nan)
        output[y[valid], x[valid]] = np.round(values[valid] - 273.15, 1)
        stamp = lambda date, time: datetime.strptime(f"{int(date):08d}{int(time):04d}", "%Y%m%d%H%M").replace(tzinfo=timezone.utc)
        init = stamp(get("dataDate"), get("dataTime"))
        valid_time = stamp(get("validityDate"), get("validityTime"))
        if get("stepType") != "instant" or valid_time < init:
            raise ValueError("Unexpected field time semantics")
        field = {"id": f"gfs-1deg-2t-{init:%Y%m%d%H}-{valid_time:%Y%m%d%H}",
                 "provider": "NOAA/NCEP", "model": "GFS", "variable": "2-metre air temperature",
                 "units": "°C", "source_units": "K", "resolution_degrees": 1,
                 "kind": "analysis" if valid_time == init else "forecast",
                 "model_initialized_at": iso(init), "valid_at": iso(valid_time),
                 "retrieved_at": iso(retrieved_at), "source_file": source_file,
                 "source_url": "https://nomads.ncep.noaa.gov/", "attribution": "NOAA/NCEP GFS · public-domain US government data",
                 "grid": {"width": 360, "height": 181, "west": -180, "north": 90, "step": 1,
                          "longitude_wrap": True, "latitude_order": "north_to_south"},
                 "minimum_c": float(np.nanmin(output)), "maximum_c": float(np.nanmax(output)),
                 "missing_count": int(np.isnan(output).sum()),
                 "values_c": [None if not np.isfinite(v) else float(v) for v in output.ravel()]}
        if codes_get_message_size(handle) != len(data):
            raise ValueError("Expected exactly one filtered GRIB message")
        return field
    finally:
        codes_release(handle)
