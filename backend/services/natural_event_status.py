"""Presentation evidence for the live globe. Notification inputs are unchanged."""
from datetime import timedelta

from services.natural_event_data import date, iso


# Reviewed, identity-bound final bulletins. Never match a storm by its name.
AKVAN = {
    'state': 'ended_confirmed',
    'at': '2026-11-21T00:00:00Z',
    'agency': 'IMD / RSMC New Delhi',
    'source_url': 'https://internal.imd.gov.in/press_release/20261121_pr_5513.pdf',
    'classification': 'Low Pressure Area',
}
AKVAN_REPORTS = {'gdacs:TC:1001351', 'ibtracs:2026321N11087'}

CYCLONE_ADVISORY_WINDOW = timedelta(hours=12)
# Display windows for dated reports. They do not estimate hazard duration.
REPORT_DAYS = {'cyclone': 3, 'wildfire': 3, 'flood': 7, 'volcano': 14,
               'drought': 30, 'landslide': 7, 'storm': 3, 'snow_ice': 30,
               'dust': 3, 'temperature_extreme': 3, 'water_color': 7, 'other': 3}


def live_status(event, now, evidence=None):
    provider, category = event['provider'], event['category']
    stamp = date(event.get('reported_at'))
    if event.get('classification') == 'forecast' or (stamp and stamp > now):
        return {'state': 'verification_pending', 'at': iso(stamp)}
    track = event.get('track') or {}
    if category == 'cyclone' and (event['id'] in AKVAN_REPORTS or
            provider == 'ibtracs' and 'IO052026' in track.get('atcf_ids', [])) and date(AKVAN['at']) <= now:
        return AKVAN.copy()
    if evidence:
        observed = date(evidence.get('at'))
        if observed and observed <= now:
            if evidence['state'] == 'ended_confirmed':
                return evidence.copy()
            expiry = observed + CYCLONE_ADVISORY_WINDOW
            if evidence['state'] == 'active_confirmed' and now < expiry:
                return {**evidence, 'expires_at': iso(expiry)}
    if provider == 'usgs' and category == 'earthquake' and stamp and stamp <= now < stamp + timedelta(days=1):
        return {'state': 'recent_occurrence', 'at': iso(stamp), 'expires_at': iso(stamp + timedelta(days=1)),
                'agency': 'USGS', 'source_url': event.get('source_url')}
    if not stamp:
        return {'state': 'verification_pending', 'at': iso(stamp)}
    if provider == 'nhc':
        return {'state': 'stale_unverified', 'at': iso(stamp)}
    window = timedelta(days=REPORT_DAYS.get(category, 1))
    expiry = stamp + window
    if category in REPORT_DAYS and now < expiry:
        closed = date(event.get('closed_at'))
        state = 'recently_closed' if closed and closed <= now else 'recent_report'
        return {'state': state, 'at': iso(stamp), 'expires_at': iso(expiry),
                'agency': provider.upper(), 'source_url': event.get('source_url')}
    return {'state': 'stale_unverified' if now >= expiry else 'verification_pending', 'at': iso(stamp)}


def presentation_events(value):
    now = date(value['generated_at'])
    events = value['events']
    evidence_by_report = {}
    additions = []
    for evidence in value.get('official_storms', []):
        identity = evidence['official_id']
        official = next((e for e in events if e['id'] == f'nhc:{identity}'), None)
        linked = [e for e in events if e['provider'] == 'ibtracs'
                  and identity in (e.get('track') or {}).get('atcf_ids', [])]
        owner = official or (linked[0] if len(linked) == 1 else None)
        if owner:
            evidence_by_report[owner['id']] = evidence
        elif evidence['state'] == 'active_confirmed' and evidence['position']:
            stamp = evidence['at']
            additions.append({'id': f'nhc:{identity}', 'provider': 'nhc', 'provider_event_id': identity,
                'category': 'cyclone', 'title': evidence['name'], 'status': evidence['classification'],
                'status_meaning': 'Classification from the latest NOAA NHC/CPHC storm status summary.',
                'reported_at': stamp, 'last_report_at': stamp, 'source_url': evidence['source_url'],
                'position': evidence['position'], 'geometry': {'type': 'Point', 'coordinates': evidence['position']},
                'measurements': [], 'references': [], 'data_state': 'available',
                'track': {'official_id': identity, 'observed': [], 'forecast': []}})
            evidence_by_report[additions[-1]['id']] = evidence
    return [{**event, 'live_status': live_status(event, now, evidence_by_report.get(event['id']))}
            for event in [*events, *additions]]
