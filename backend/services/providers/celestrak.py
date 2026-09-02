import httpx
from datetime import datetime, timedelta, timezone

BASE_URL = "https://celestrak.org"


def parse_tle_epoch(tle_line1: str) -> str:
    epoch_value = tle_line1[18:32].strip()

    if len(epoch_value) < 5:
        raise ValueError("Invalid TLE epoch")

    short_year = int(epoch_value[:2])
    day_of_year = float(epoch_value[2:])

    if short_year >= 57:
        year = 1900 + short_year
    else:
        year = 2000 + short_year

    start_of_year = datetime(year, 1, 1, tzinfo=timezone.utc)
    epoch = start_of_year + timedelta(days=day_of_year - 1)

    return epoch.isoformat()


def get_latest_gp(norad_ids: list[int]):
    if not norad_ids:
        return []

    wanted_ids = set(norad_ids)

    response = httpx.get(
        url=f"{BASE_URL}/NORAD/elements/gp.php",
        params={
            "GROUP": "active",
            "FORMAT": "TLE",
        },
        timeout=45,
        follow_redirects=True,
    )

    response.raise_for_status()

    response_lines = response.text.strip().splitlines()
    records = []

    for i in range(0, len(response_lines) - 2, 3):
        name = response_lines[i].strip()
        tle_line1 = response_lines[i + 1].strip()
        tle_line2 = response_lines[i + 2].strip()

        if not tle_line1.startswith("1 ") or not tle_line2.startswith("2 "):
            continue

        try:
            norad_id = int(tle_line1[2:7])
        except ValueError:
            continue

        if norad_id not in wanted_ids:
            continue

        records.append(
            {
                "NORAD_CAT_ID": str(norad_id),
                "OBJECT_NAME": name,
                "OBJECT_ID": None,
                "EPOCH": parse_tle_epoch(tle_line1),
                "TLE_LINE1": tle_line1,
                "TLE_LINE2": tle_line2,
            }
        )

    return records
