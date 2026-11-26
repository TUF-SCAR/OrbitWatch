"""Offline tests for sequential CDS batching and resumable archive publication."""
from contextlib import nullcontext
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from check_historical_weather import grib_fixture
import historical_weather_campaign as campaign
import historical_weather_import as importer
from services.era5_source import DATASET, read_grib, request_for_years, request_timestamps
from services.historical_weather_codec import SPECS


NOW = datetime(2026, 11, 26, tzinfo=timezone.utc)
PUBLISHED = set().union(*(campaign.approved_dates(year) for year in (1970, 2000, 2024)))


def manifest(years, state, job_id='isolated'):
    return {'dataset': DATASET, 'request': request_for_years(years, NOW),
            'state': state, 'job_id': job_id}


def grib_batch(path, years, *, omit=None, duplicate=None):
    import eccodes as ec

    item = manifest(years, 'downloaded')
    dates = sorted(request_timestamps(item['request']))
    template = path.with_suffix('.sample')
    grib_fixture(template)
    with template.open('rb') as source, path.open('wb') as output:
        while handle := ec.codes_grib_new_from_file(source):
            try:
                for date in dates:
                    if date == omit:
                        continue
                    ec.codes_set(handle, 'dataDate', int(date.strftime('%Y%m%d')))
                    ec.codes_write(handle, output)
                    if date == duplicate and ec.codes_get(handle, 'paramId') == 167:
                        ec.codes_write(handle, output)
            finally:
                ec.codes_release(handle)
    item['source_sha256'] = sha256(path.read_bytes()).hexdigest()
    path.with_suffix('.json').write_text(json.dumps(item), encoding='utf8')
    return item


class CampaignChecks(unittest.TestCase):
    def test_exact_cartesian_product_and_2026(self):
        request = request_for_years((1990, 2010, 2020), NOW)
        dates = {date.isoformat() for date in request_timestamps(request)}
        self.assertEqual(dates, set().union(*(campaign.approved_dates(year) for year in (1990, 2010, 2020))))
        self.assertEqual(len(dates) * len(request['variable']), 84)
        self.assertEqual(request_timestamps(request_for_years((2026,), NOW)),
                         {datetime(2026, month, 15, 12, tzinfo=timezone.utc) for month in (1, 4, 7)})
        for years in ((1990, 2026), (1990, 1990), (1969, 1990), (1990, 1991, 1992, 1993)):
            with self.subTest(years=years), self.assertRaises(ValueError):
                request_for_years(years, NOW)
        for months in (['01', '01'], ['02'], ['01', '04', '07']):
            with self.subTest(months=months), self.assertRaises(ValueError):
                request_timestamps(request | {'month': months})

    def test_planner_resumes_1980_then_batches_and_reuses_partial_source(self):
        pilot = (Path('pilot.json'), manifest((2024,), 'downloaded', 'pilot'))
        job = (Path('1980.json'), manifest((1980,), 'queued', 'preserved-1980'))
        self.assertEqual(campaign.next_request(PUBLISHED, [pilot, job]), ((1980,), list(campaign.QUARTERS), None))
        completed = PUBLISHED | campaign.approved_dates(1980)
        saved = [pilot, (job[0], job[1] | {'state': 'published'})]
        self.assertEqual(campaign.next_request(completed, saved), ((1990, 2010, 2020), campaign.QUARTERS, None))
        group = (Path('group.json'), manifest((1990, 2010, 2020), 'downloaded'))
        partial = completed | {next(iter(campaign.approved_dates(2010)))}
        plan = campaign.next_request(partial, [*saved, group])
        self.assertEqual(plan[0], (1990, 2010, 2020))
        self.assertEqual(plan[2], group)
        self.assertEqual(campaign.next_request(campaign.APPROVED - campaign.approved_dates(2026), saved),
                         ((2026,), list(campaign.QUARTERS[:3]), None))

    def test_planner_stops_for_uncertain_and_overlapping_jobs(self):
        for saved in (
            [(Path('uncertain.json'), manifest((1980,), 'submission_uncertain'))],
            [(Path('a.json'), manifest((1980,), 'queued')), (Path('b.json'), manifest((1981,), 'queued'))],
            [(Path('a.json'), manifest((1980,), 'queued')), (Path('b.json'), manifest((1980, 1981), 'downloaded'))],
            [(Path('failed.json'), manifest((1980,), 'failed'))],
        ):
            with self.subTest(saved=saved), self.assertRaises(campaign.CampaignStop):
                campaign.next_request(PUBLISHED, saved)

    def test_cds_history_blocks_outstanding_and_unsaved_overlaps(self):
        request = request_for_years((1990, 2010, 2020), NOW)
        archive_job = {'jobID':'remote-id', 'status':'successful', 'processID':DATASET,
                       'metadata':{'request':{'ids':{'year':['2010']}}}}
        for detail in (archive_job, archive_job | {'status':'accepted', 'processID':'another-dataset'}):
            client = Mock()
            client.get_jobs.return_value = SimpleNamespace(
                request_ids=['remote-id'], response=Mock(json=Mock(return_value={'jobs':[detail]})), next=None)
            with self.assertRaises(ValueError):
                importer.check_provider_history(client, request, set())
            client.submit.assert_not_called()
        client.get_jobs.return_value.response.json.return_value = {'jobs':[archive_job]}
        importer.check_provider_history(client, request, {'remote-id'})

    def test_staged_source_recovers_without_another_download(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)/'job.json'
            partial = path.with_suffix('.grib.part')
            partial.write_bytes(b'verified local source')
            item = manifest((1990, 2010, 2020), 'staged')
            item['source_sha256'] = sha256(partial.read_bytes()).hexdigest()
            self.assertEqual(importer.finalize_source(path, item)['state'], 'downloaded')
            self.assertFalse(partial.exists())
            self.assertEqual(json.loads(path.read_text())['state'], 'downloaded')
            path.with_suffix('.grib').write_bytes(b'corrupt')
            with self.assertRaises(ValueError):
                importer.finalize_source(path, item)

    def test_batch_submission_and_lost_response_are_recoverable(self):
        engine = Mock()
        engine.begin.return_value = nullcontext(Mock())
        usage = {'database_bytes':15_000_000, 'storage':{'bytes':8_300_000}}
        years = (1990, 2010, 2020)
        with (
            tempfile.TemporaryDirectory() as temp,
            patch.object(importer, 'ARCHIVE', Path(temp)),
            patch.object(importer, 'target', return_value=(engine, 'ISOLATED')),
            patch.object(importer, 'measurement', return_value=usage),
            patch.object(importer, 'stored_timestamps', return_value=[]),
            patch.object(importer, 'SnapshotStorage'),
            patch.object(importer, 'cds_settings', return_value=('https://example.test', 'ISOLATED')),
            patch.object(importer, 'refresh_owner', return_value=nullcontext(True)),
            patch.object(importer.budget, 'attempt', side_effect=lambda *args: nullcontext()),
            patch('ecmwf.datastores.Client') as client,
        ):
            cds = client.return_value
            cds.get_jobs.return_value = None
            remote = Mock(request_id='isolated-batch-job', json={'status':'accepted'})
            cds.submit.return_value = remote
            cds.get_remote.return_value = remote
            self.assertEqual(importer.download_batch(years)['job_id'], remote.request_id)
            self.assertEqual(importer.download_batch(tuple(reversed(years)))['job_id'], remote.request_id)
            cds.submit.assert_called_once_with(DATASET, request_for_years(years, NOW))
            with self.assertRaisesRegex(ValueError, 'Resume the existing'):
                importer.download_batch((1971, 1972, 1973))
            cds.get_remote.assert_called_once_with(remote.request_id)

            path, saved = importer.manifests()[0]
            importer.write_manifest(path, saved | {'state':'published'})
            cds.submit.side_effect = TimeoutError('isolated response lost')
            with self.assertRaises(TimeoutError):
                importer.download_batch((1971, 1972, 1973))
            with self.assertRaisesRegex(ValueError, 'automatic resubmission prohibited'):
                importer.download_batch((1971, 1972, 1973))
            self.assertEqual(cds.submit.call_count, 2)

    def test_real_grib_twelve_timestamps_and_reject_missing_or_duplicate(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)/'batch.grib'
            years = (1990, 2010, 2020)
            item = grib_batch(path, years)
            results = read_grib(path, item)
            self.assertEqual(len(results), 12)
            self.assertTrue(all(set(result['fields']) == set(SPECS) for result in results.values()))
            omitted = max(results)
            grib_batch(path, years, omit=omitted)
            with patch.object(importer, 'target') as target, self.assertRaisesRegex(ValueError, 'requires complete'):
                importer.publish(path, importer.EXPECTED, complete_only=True)
            target.assert_not_called()
            item = grib_batch(path, years, duplicate=omitted)
            with self.assertRaises(ValueError):
                read_grib(path, item)

    def test_window_expiry_preserves_saved_job_and_requests_supervised_resume(self):
        state = {'years': {'1980': {'state':'queued', 'job_id':'preserved-1980'}}}
        with patch.object(campaign, 'reconcile', return_value=PUBLISHED), patch.object(campaign, 'download_batch') as download:
            campaign.run(state, deadline=0)
        download.assert_not_called()
        self.assertEqual(state['status'], 'continuing')
        self.assertEqual(state['years']['1980']['job_id'], 'preserved-1980')
        self.assertEqual(campaign.CONTINUE_EXIT, 75)

    def test_quota_guards_apply_to_the_remaining_archive(self):
        state = {'sizes': {date:700_000 for date in PUBLISHED}}
        measured = {'database_bytes':15_000_000, 'storage':{'bytes':8_400_000, 'objects':12}}
        campaign.estimate(state, measured)
        self.assertGreater(state['database_free'], 200_000_000)
        self.assertGreater(state['storage_free'], 200_000_000)
        for unsafe in (measured | {'database_bytes':260_000_000},
                       measured | {'storage':{'bytes':749_000_000, 'objects':12}}):
            with self.assertRaises(ValueError):
                campaign.estimate(state, unsafe)


if __name__ == '__main__':
    unittest.main()
