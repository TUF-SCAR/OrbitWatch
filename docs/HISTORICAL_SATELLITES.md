# Historical satellites

Time Explorer has exactly 15 permanent identities from
`backend/data/time_satellites.json`; its first four are selected by default.
Python validation and the React catalog use this same file. Live retains 143
independent objects. Collections cannot edit the Time Explorer catalog.

Historical APIs read `satellite_historical_elements` only. They never retrieve
Space-Track data, call Live propagation lookups, or run migrations. An absent
historical table returns 503 without invalidating Live database readiness.

## Scientific policy

Use the newest archived epoch at/before the requested UTC instant, at most 24
hours old. At equal epochs the latest Space-Track record identity wins. Launch
and decay dates are checked when provided. Before the first stored epoch, in
archive gaps, beyond the age limit, and at future times, positions are
unavailable. No current elements substitute for missing history.

Skyfield's genuine OMM loader and TLE parser feed the existing SGP4 TEME/ITRS
sampling code. Immutable record/epoch cache keys are separate from Live and
limited to 128 propagators. Trajectories include the exact selected instant.
Paths are clipped to the element validity window; long/eccentric orbits can be
honestly labeled partial arcs. No fictional closed orbit is drawn. The 24-hour
limit is a conservative display policy, not an accuracy guarantee. Maneuvers,
drag, UT1 prediction and missing polar motion remain limitations.

## Explicit archive operations

From `backend`, use `..\.venv\Scripts\python.exe historical_import.py`:

```powershell
# Only disjoint, bounded windows; cached identical requests make no HTTP calls.
..\.venv\Scripts\python.exe historical_import.py download --ids 25544,20580,48274,39084 --start 2024-06-01T00:00:00Z --end 2024-06-03T00:00:00Z
..\.venv\Scripts\python.exe historical_import.py inspect .runtime/history/415be1c02a933847dd258140.json.gz
```

Windows are limited to seven days, 15 fixed IDs, 5,000 records and 10 MiB raw.
The shared provider request ceiling covers both Live and historical requests;
history also has a separate persistent cooldown/circuit. Failed/ambiguous
queries are not silently repeated. Original responses are retained losslessly
in gzip with a request manifest, checksum and retrieval timestamp. Preserve the
`.runtime/history` volume; do not re-download saved history or reset budgets.

## Deployment and activation

The existing configured Supabase project was activated on October 31, 2026,
with the owner's explicit authorization: the migration and both saved imports
succeeded, storing 86 unique element sets for 14 identities. Reimporting both
archives inserted zero additional rows. Database storage reported 12,266,643
bytes (11.698 MiB); the historical table and indexes occupy 122,880 bytes.
The fixed NORAD constraint, index, RLS and FastAPI role read access were verified.
Fingerprints confirmed that existing users and both Live orbital tables were
unchanged. No additional Space-Track requests were made.

For a new target, first review and authorize
`backend/migrations/001_historical_elements.sql`. The migration creates only the new table/index and enables RLS; the
server database role must have the appropriate table access. Browser access
continues through authenticated FastAPI, without Supabase browser policies.

Inject the approved target URL as `HISTORICAL_DATABASE_URL` through the existing
secret mechanism. The importer deliberately does not default to `DATABASE_URL`.
Only after approval, from `backend`:

```powershell
..\.venv\Scripts\python.exe historical_import.py migrate --allow-remote
..\.venv\Scripts\python.exe historical_import.py import .runtime/history/415be1c02a933847dd258140.json.gz --allow-remote
..\.venv\Scripts\python.exe historical_import.py import .runtime/history/65c4f142070f5c1e831fb346.json.gz --allow-remote
```

Imports validate the complete archive before writing, use one transaction,
deduplicate by element identity, and can safely resume by rerunning the saved
archive. A PostgreSQL advisory lock serializes size accounting/imports. Both
database table/index storage and downloaded archives have conservative 50 MiB
pilot limits. Reaching a limit stops expansion; it does not delete data.

## Verified pilot

Two disjoint-ID GP_HISTORY queries retrieved June 1–2, 2024: 88 source records,
86 unique element sets for 14 identities. TESS returned no records. The original
responses total 99,360 bytes, compressed to 11,221 bytes. The local PostgreSQL
pilot measured 548 bytes per row on average and 122,880 bytes including indexes.
This is a small-sample footprint. At the observed density, roughly 16,000 rows
per year and a conservative 1.5 kB/row allowance imply about 24 MB/year; this is
not permission or a capacity guarantee for a multi-decade archive.

All four defaults and 13 of the 15 identities have valid states at June 2,
2024 16:00 UTC (21:30 India time). Galileo's available epoch is too old there;
TESS is absent. Other timestamps must be checked individually.

`tests/check_historical.py` requires an explicitly supplied
`HISTORICAL_TEST_DATABASE_URL` on loopback port 55432. It exercises the versioned
migration, real saved archives, deduplication, OMM/TLE and raw SGP4 agreement,
protected APIs, missing coverage/schema and Live cache separation without
orbital provider HTTP. Existing regressions use isolated fixtures.

The implementation batch's historical/backend contract checks and 140 frontend tests passed,
as did frontend lint/build. Broader weather and Natural Events asynchronous
regressions failed timing/Windows cleanup checks; those systems were not edited.
The October 31 activation verified the protected endpoints against the real
Supabase table for all four defaults at 2024-06-02T16:00:00Z (61 trajectory and
480 orbital samples per object). The real-app Cesium smoke check loaded four
historical entities, visually verified ISS and its Orbit Trace, inspected source
metadata, confirmed position changes with time and zero entities outside
coverage, and restored six Live objects, all four weather cards and enabled
cloud imagery. The fixed 15-object catalog and static Esri reference remained
intact. This check used the existing account and real API, without fixtures.

Sources: [Space-Track archive/query policy](https://www.space-track.org/documentation),
[Skyfield OMM and element-epoch limitations](https://rhodesmill.org/skyfield/earth-satellites.html).
