"""Stored historical SGP4 elements only; no provider or Live cache writes."""
import hashlib
import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from functools import lru_cache
from math import isfinite, pi, sqrt
from skyfield.api import EarthSatellite
from services.historical_archive import utc
from services.historical_catalog import check_historical_ids
from services.satellite_tracker import timescale, propagate_samples, scientific_metadata
from repositories.historical_elements import historical_records, MAX_ELEMENT_AGE_SECONDS

OMM_NUMBERS = ('MEAN_MOTION','ECCENTRICITY','INCLINATION','RA_OF_ASC_NODE','ARG_OF_PERICENTER',
               'MEAN_ANOMALY','BSTAR','MEAN_MOTION_DOT','MEAN_MOTION_DDOT')
OMM_INTEGERS = ('EPHEMERIS_TYPE','ELEMENT_SET_NO','REV_AT_EPOCH')


def normalize_elements(record, source='Space-Track GP_HISTORY'):
    norad_id = int(record['NORAD_CAT_ID']); check_historical_ids([norad_id])
    raw_epoch = str(record['EPOCH'])
    epoch = datetime.fromisoformat(raw_epoch.replace('Z', '+00:00'))
    # The OMM TIME_SYSTEM defaults to UTC for Space-Track GP records.
    epoch = epoch.replace(tzinfo=timezone.utc) if epoch.tzinfo is None else utc(epoch)
    if not datetime(1957, 1, 1, tzinfo=timezone.utc) <= epoch <= datetime.now(timezone.utc):
        raise ValueError('Historical element epoch is invalid')
    if record.get('TIME_SYSTEM', 'UTC') != 'UTC' or record.get('CENTER_NAME', 'EARTH') != 'EARTH' or record.get('REF_FRAME', 'TEME') != 'TEME' or record.get('MEAN_ELEMENT_THEORY', 'SGP4') != 'SGP4':
        raise ValueError('Only Earth/TEME/UTC SGP4 elements are supported')
    if all(record.get(key) is not None for key in OMM_NUMBERS + OMM_INTEGERS):
        elements = {}
        for key in OMM_NUMBERS:
            try:
                value = Decimal(str(record[key]))
                if not value.is_finite() or not isfinite(float(value)):
                    raise ValueError('Non-finite orbital parameter')
                elements[key] = format(value.normalize(), 'f')
            except (InvalidOperation, OverflowError) as error:
                raise ValueError('Invalid OMM number') from error
        for key in OMM_INTEGERS:
            value = Decimal(str(record[key]))
            if not value.is_finite() or value != value.to_integral_value() or value < 0:
                raise ValueError('Invalid OMM integer')
            elements[key] = str(int(value))
        if int(elements['EPHEMERIS_TYPE']) not in (0, 2):
            raise ValueError('This element set requires an unsupported propagation theory')
        elements['CLASSIFICATION_TYPE'] = str(record.get('CLASSIFICATION_TYPE', 'U'))
        if elements['CLASSIFICATION_TYPE'] != 'U':
            raise ValueError('Only unclassified orbital elements may be imported')
        if not 0 < float(elements['MEAN_MOTION']) <= 20 or not 0 <= float(elements['ECCENTRICITY']) < 1 or not 0 <= float(elements['INCLINATION']) <= 180:
            raise ValueError('Invalid OMM orbital elements')
        element_format = 'OMM'
    elif record.get('TLE_LINE1') and record.get('TLE_LINE2'):
        elements = {key: str(record[key]).rstrip() for key in ('TLE_LINE1', 'TLE_LINE2')}
        from sgp4.io import verify_checksum
        verify_checksum(elements['TLE_LINE1'],elements['TLE_LINE2'])
        if any(int(line[2:7])!=norad_id for line in elements.values()):
            raise ValueError('TLE identity differs from the requested satellite')
        element_format = 'TLE'
    else:
        raise ValueError('Record is missing required SGP4 OMM/TLE parameters')
    name, object_id = str(record.get('OBJECT_NAME') or f'NORAD {norad_id}'), str(record.get('OBJECT_ID') or '')
    if not object_id or len(name) > 255 or len(object_id) > 50:
        raise ValueError('Invalid orbital identity')
    identity = json.dumps([norad_id, epoch.isoformat(), element_format, elements], sort_keys=True, separators=(',', ':'))
    result = dict(record_id=hashlib.sha256(identity.encode()).hexdigest(), norad_id=norad_id, epoch=epoch,
                  object_name=name, object_id=object_id, source=source, source_record_id=str(record['GP_ID']) if record.get('GP_ID') is not None else None,
                  launch_date=date.fromisoformat(record['LAUNCH_DATE'][:10]) if record.get('LAUNCH_DATE') else None,
                  decay_date=date.fromisoformat(record['DECAY_DATE'][:10]) if record.get('DECAY_DATE') else None,
                  element_format=element_format, elements=elements, imported_at=datetime.now(timezone.utc))
    satellite = historical_propagator(result)
    if satellite.model.satnum != norad_id or abs((satellite.epoch.utc_datetime() - epoch).total_seconds()) > .01:
        raise ValueError('Propagator identity/epoch differs from source metadata')
    # Reject mathematically invalid/decayed source sets before storing them.
    propagate_samples(satellite, [epoch])
    return result


@lru_cache(maxsize=128)
def _propagator(record_id, name, object_id, epoch, element_format, payload):
    fields = json.loads(payload)
    if element_format == 'TLE':
        return EarthSatellite(fields['TLE_LINE1'], fields['TLE_LINE2'], name, timescale)
    fields.update(OBJECT_NAME=name, OBJECT_ID=object_id, EPOCH=utc(epoch).strftime('%Y-%m-%dT%H:%M:%S.%f'))
    # NORAD is recovered from the immutable cache payload, never a Live lookup.
    return EarthSatellite.from_omm(timescale, fields)


def historical_propagator(record):
    fields = dict(record['elements'], NORAD_CAT_ID=str(record['norad_id']))
    return _propagator(record['record_id'], record['object_name'], record['object_id'],
                       utc(record['epoch']).isoformat(), record['element_format'], json.dumps(fields, sort_keys=True))


def metadata(record, satellite, timestamp, dates, samples):
    age = (timestamp - utc(record['epoch'])).total_seconds()
    return dict(scientific_metadata(satellite, dates, samples), historical=True,
                requested_timestamp=timestamp.isoformat(), element_id=record['record_id'],
                orbital_source=record['source'], historical_epoch=utc(record['epoch']).isoformat(),
                element_age_seconds=age, max_element_age_seconds=MAX_ELEMENT_AGE_SECONDS,
                precision_note='SGP4 reconstruction from archived orbital elements, not an observed position. A 24-hour epoch-age limit is a conservative display policy, not an accuracy guarantee; maneuvers, drag, installed UT1 and missing polar motion limit accuracy.')


def historical_batch(norad_ids, timestamp, step_seconds=5, duration_seconds=300, orbit_samples=480):
    check_historical_ids(norad_ids); timestamp = utc(timestamp)
    if not 1 <= step_seconds <= 60 or not 10 <= duration_seconds <= 3600 or not 32 <= orbit_samples <= 960:
        raise ValueError('Historical sampling limits exceeded')
    if duration_seconds / step_seconds > 720:
        raise ValueError('Historical trajectory exceeds 720 sample intervals')
    records = historical_records(norad_ids, timestamp)
    objects, errors = [], []
    for norad_id in norad_ids:
        record = records.get(norad_id)
        if record is None or timestamp > datetime.now(timezone.utc):
            errors.append(dict(norad_id=norad_id, state='unavailable', message='No stored historical element epoch at/before this timestamp within the 24-hour age limit.'))
            continue
        try:
            if record.get('launch_date') and timestamp.date() < record['launch_date'] or record.get('decay_date') and timestamp.date() >= record['decay_date']:
                raise ValueError('Requested timestamp is outside the documented orbital lifetime')
            satellite = historical_propagator(record)
            epoch = utc(record['epoch'])
            # Do not sample before the selected historical epoch or beyond its
            # validity window. The selected instant is always an exact sample.
            start = max(epoch, timestamp - timedelta(seconds=duration_seconds / 2))
            end = min(epoch + timedelta(seconds=MAX_ELEMENT_AGE_SECONDS), timestamp + timedelta(seconds=duration_seconds / 2))
            dates = sorted(set([start, end, timestamp] + [start + timedelta(seconds=i) for i in range(0, int((end-start).total_seconds()), step_seconds)]))
            if len(dates) < 2:
                raise ValueError('No valid historical sample interval')
            positions = propagate_samples(satellite, dates)
            position = positions[dates.index(timestamp)]
            period = 2 * pi / satellite.model.no_kozai * 60
            details = metadata(record, satellite, timestamp, dates, positions)
            trajectory = dict(name=satellite.name, norad_id=norad_id, positions=positions,
                              step_seconds=step_seconds, orbital_period_minutes=period / 60,
                              velocity_km_s=sqrt(sum(value*value for value in position['teme_velocity_km_s'])), **details)
            orbit_start = max(epoch, timestamp - timedelta(seconds=period / 2))
            orbit_end = min(epoch + timedelta(seconds=MAX_ELEMENT_AGE_SECONDS), orbit_start + timedelta(seconds=period))
            orbit_dates = [orbit_start + (orbit_end - orbit_start) * i / (orbit_samples - 1) for i in range(orbit_samples)]
            orbit_positions = propagate_samples(satellite, orbit_dates)
            orbit = dict(name=satellite.name, norad_id=norad_id, positions=orbit_positions, samples=orbit_samples,
                         start_timestamp=orbit_start.isoformat(), end_timestamp=orbit_end.isoformat(),
                         orbital_period_minutes=period / 60, path_kind='orbit' if (orbit_end-orbit_start).total_seconds() >= period-.1 else 'arc',
                         **metadata(record, satellite, timestamp, orbit_dates, orbit_positions))
            objects.append(dict(norad_id=norad_id, position=dict(position, **details), trajectory=trajectory, orbit=orbit))
        except ValueError:
            errors.append(dict(norad_id=norad_id, state='unavailable', message='Archived elements cannot produce a valid SGP4 state for this interval.'))
    return dict(requested_timestamp=timestamp.isoformat(), objects=objects, errors=errors)
