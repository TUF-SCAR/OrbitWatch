import json
from pathlib import Path

_catalog = json.loads((Path(__file__).resolve().parents[1] / 'data/time_satellites.json').read_text())
HISTORICAL_IDS = tuple(_catalog['norad_ids'])
HISTORICAL_DEFAULT_IDS = tuple(_catalog['default_ids'])


def check_historical_ids(norad_ids):
    if not norad_ids or len(norad_ids) > 15 or len(set(norad_ids)) != len(norad_ids):
        raise ValueError('Select 1–15 distinct Time Explorer satellites')
    if any(type(value) is not int or value not in HISTORICAL_IDS for value in norad_ids):
        raise ValueError('Satellite is not in the permanent Time Explorer catalog')
    return list(norad_ids)
