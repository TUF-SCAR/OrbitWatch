"""Vallado reference vectors and release science guards, with no provider access."""
from datetime import datetime, timedelta, timezone
from importlib.resources import files
from math import dist
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
os.environ['DATABASE_URL'] = 'sqlite://'

from services import natural_events, satellite_tracker as tracker

REFERENCE_IDS = {5, 8195, 14128, 28129}


def vallado_records():
    lines = files('sgp4').joinpath('SGP4-VER.TLE').read_text().splitlines()
    return {int(line[2:7]):dict(norad_id=int(line[2:7]), object_name='Vallado reference',
                               tle_line1=line[:69], tle_line2=lines[index+1][:69])
            for index,line in enumerate(lines) if line.startswith('1 ') and int(line[2:7]) in REFERENCE_IDS}


class ScientificAccuracy(unittest.TestCase):
    def tearDown(self):
        tracker.satellite_cache.clear()

    def test_vallado_published_teme_vectors(self):
        # Published tcppver.out accompanying Vallado et al. (2006-6753).
        # Compare geocentric TEME axes in km and km/s, at epoch and one later sample.
        references = {}
        for line in files('sgp4').joinpath('tcppver.out').read_text().splitlines():
            if line.endswith(' xx'):
                identity = int(line.split()[0])
                if identity in REFERENCE_IDS:
                    references[identity] = []
            elif identity in references and len(references[identity]) < 2:
                references[identity].append([float(cell) for cell in line.split()[:7]])
        for identity, record in vallado_records().items():
            satellite = tracker.create_satellite_propagator(record)
            for minutes, *expected in references[identity]:
                when = satellite.epoch.utc_datetime() + timedelta(minutes=minutes)
                measured = tracker.propagate_samples(satellite, [when])[0]
                location_error = dist(measured['teme_position_km'], expected[:3])
                speed_error = dist(measured['teme_velocity_km_s'], expected[3:])
                # Allow for UTC/Julian date rounding and Skyfield's TEME round trip.
                self.assertLess(location_error, 0.001)
                self.assertLess(speed_error, 0.000001)
                print(identity, when.isoformat(), f'{location_error:.3g} km', f'{speed_error:.3g} km/s')

    def test_live_rejects_old_elements_even_in_ram_and_keeps_historical_propagation(self):
        record = vallado_records()[5]
        fresh = tracker.create_satellite_propagator(record)
        epoch = fresh.epoch.utc_datetime()
        self.assertEqual(tracker.create_satellite_propagator({**record, 'epoch': epoch.replace(tzinfo=None)}).epoch.utc_datetime(), epoch)
        with self.assertRaises(tracker.LiveElementsUnavailable):
            tracker.create_satellite_propagator({**record, 'epoch': (epoch + timedelta(seconds=3)).replace(tzinfo=None)})
        tracker.require_live_epoch(fresh, epoch + timedelta(days=7))
        with self.assertRaises(tracker.LiveElementsUnavailable):
            tracker.require_live_epoch(fresh, epoch + timedelta(days=7, microseconds=1))
        with self.assertRaises(tracker.LiveElementsUnavailable):
            tracker.require_live_epoch(fresh, epoch - timedelta(days=2))
        with self.assertRaises(tracker.LiveElementsUnavailable):
            tracker.get_satellite_trajectory(record['norad_id'])
        self.assertEqual(tracker.propagate_samples(fresh, [epoch])[0]['timestamp'], epoch.isoformat())
        with self.assertRaises(tracker.LiveElementsUnavailable):
            tracker.create_satellite_propagator({**record, 'norad_id':8195})
        with self.assertRaises(tracker.LiveElementsUnavailable):
            tracker.create_satellite_propagator({**record, 'epoch':epoch + timedelta(minutes=1)})
        with self.assertRaises(tracker.LiveElementsUnavailable):
            tracker.create_satellite_propagator({**record,'tle_line1':record['tle_line1'][:-1]+'0'})

    def test_background_refresh_queues_only_due_providers_and_honours_opt_out(self):
        now = datetime.now(timezone.utc).timestamp()
        stores = {'eonet':Mock(), 'nhc':Mock(), 'ibtracs':Mock()}
        stores['eonet'].get.return_value = {'validated_at': now - 30}
        stores['nhc'].get.return_value = None
        stores['ibtracs'].get.return_value = {'validated_at': now - 43201}
        with patch.object(natural_events, 'stores', stores), patch.object(natural_events, 'revalidate') as submit:
            with patch.dict(os.environ, {'ORBITWATCH_EVENT_PROVIDER_REQUESTS':'true'}):
                natural_events.queue_due_refreshes()
            self.assertEqual([call.args for call in submit.call_args_list], [('nhc',), ('ibtracs',)])
            submit.reset_mock()
            with patch.dict(os.environ, {'ORBITWATCH_EVENT_PROVIDER_REQUESTS':'false'}):
                natural_events.queue_due_refreshes()
            submit.assert_not_called()


if __name__ == '__main__':
    unittest.main()
