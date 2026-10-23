# Live Earth reported natural events

23 October2026, pending `ac36865` working tree. Read-only educational reports,
inside Weather; no Disaster Lab, alert service, Supabase ingestion or Time data.

## Official sources and scope

| Provider / endpoint | Bounded scope | Meaning / terms |
| --- | --- | --- |
| [NASA EONETv3](https://eonet.gsfc.nasa.gov/docs/v3), `https://eonet.gsfc.nasa.gov/api/v3/events?status=all&days=30&limit=300` |Latest300 curated events with reported geometry in30days |Open is curation status, **not an active threat**. [NASA disclaimer](https://eonet.gsfc.nasa.gov/what-is-eonet): spatial/temporal extents may be approximate; visualization/general information. Source identities and report links retained; external source material can have separate terms. |
| [GDACS Swagger](https://www.gdacs.org/gdacsapi/swagger/index.html), `https://www.gdacs.org/gdacsapi/api/Events/geteventlist/search` |`eventlist=EQ;TC;FL;VO;DR;WF`, from/to30day window, pageSize100/pageNumber1; latest100, no automatic pagination |[Terms/disclaimer](https://www.gdacs.org/About/termofuse.aspx): automated impact estimates can be uncertain and revised; do not replace national/local warnings. Credit GDACS/UN/EC and linked source. No blanket CC license claimed. |
| [USGS GeoJSON](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php), `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson` |M2.5+ earthquakes reported in7days, not all earthquakes; feed normally updates each minute |Origin time differs from review/update time. Magnitude type and hypocentral depth km retained. [USGS-produced data are US public domain with credit requested](https://www.usgs.gov/faqs/are-usgs-reportspublications-copyrighted); third-party material can differ. |

Real verification returned295 accepted EONET reports/5 rejected,16 GDACS and360
USGS:671 provider reports, **not671 independent disasters**. Represented categories:
cyclone10, flood15, wildfire275, earthquake363, volcano2, drought4, snow/ice2.
Landslide, storm, dust/haze, temperature-extreme and water-colour adapters accept
their real EONET categories but none occurred in the bounded verified response.
The UI honestly shows empty categories. Unknown/manmade categories are excluded.
EONET severe storms are called cyclones only when the source title explicitly
identifies a hurricane, typhoon or tropical cyclone/storm; no wind radius inferred.

These are recent **reports**, often about earlier events. Latest reporting dates,
source status and retrieval times are visible. GDACS overall alert level and
latest episode level are separate fields; neither becomes a local danger claim.
GDACS ISO date-times without offsets are explicitly interpreted as UTC. Its
unitless zero flood/volcano severity placeholders become unavailable, not a
measured zero. Source-reported maximum wind can describe an earlier event peak.

## Normalization and contracts

`backend/services/natural_event_data.py`, `natural_events.py`,
`routes/natural_events.py`; existing auth/DB readiness dependency unchanged.

- Protected `GET /api/events`: events plus independent provider states.200 for
  usable caches, including empty feeds; partial if some feeds unavailable.202
  when cold jobs run and503 when none usable. Auth401/DB503 remain distinct.
- Protected `GET /api/events/{id}`: cache-only supported details;404 for absent
  or hard-expired reports,422 for malformed IDs. No per-event external call.
- Event fields: `id`, `provider`, actual `provider_event_id`, optional event type/
  episode ID/status, `category`, `title`, original `status`/`status_meaning`,
  `reported_at`, optional `updated_at`/`closed_at`, original `retrieved_at`,
  validated GeoJSON `geometry`, reported `position` and `position_meaning`,
  `measurements` with original units, plain `description`, safe `source_url`,
  `references`, optional source geometry `timeline`, `related_ids`, `data_state`.
  Unsupported `track`, `size_km`, `danger_radius_km` are explicitly null.
- Exact provider IDs deduplicate repeated records, retaining the latest report.
  Cross-provider exact report URLs establish related source identities; no
  proximity/name merging or unique-incident-count claim.
- Point longitude/latitude must be finite and within bounds. Polygon/MultiPolygon
  rings must be closed and bounded to2048total vertices/32parts. Antimeridian
  coordinates are preserved; Cesium draws supplied rings geodesically. No large
  planar bounding-box fill. Polygon markers use a supplied boundary vertex,
  explicitly not a fabricated centre. Only selected genuine extents are outlined.
- Malformed rows/timestamps, future beyond5minutes of clock tolerance or >30day last reports/updates are rejected;
  rejection counts remain in provider metadata. EONET timelines bounded128entries.
  USGS negative depth can be legitimate, within a bounded−10..1000km range.
- Only safe http(s) report links without credentials/local IPs/control characters;
  bounded plain text, no HTML execution; source links never fetched by our detail
  endpoint. Missing quantities remain null/absent measurements, visibly unavailable.

## Budgets, cache policy and recovery

These are conservative **OrbitWatch limits**, not invented provider rate promises.
Reviewed public EONET/GDACS documentation does not promise a numeric allowance;
the USGS feed cadence does not require each client to fetch it every minute.

| Provider | Minimum interval + jitter | Hour/day maximum |
| --- | ---: | ---: |
| EONET |900seconds |4 /96 |
| GDACS |900seconds |4 /96 |
| USGS |300seconds |12 /288 |

Separate persistent SQLite caches/OS leases in `backend/.runtime/events/{provider}`
or `ORBITWATCH_EVENTS_CACHE_DIR`. Same-host workers coordinate; independent hosts
must share one API owner/store rather than multiply quotas. Reservations persist
before HTTP; one lazy job/provider, three workers total. No startup requests.
DB readiness is checked before external requests. Failures remain independent,
with exponential backoff capped6h and numeric/date Retry-After. No automatic HTTP
retry or redirect. Requests bounded by5s connect/20s read/35s checked streaming
deadline and8MB. At most600normalized events/provider; source query bounds are
usually smaller. Only the normalized feed snapshot is stored, not source HTML.

Conditional ETag/Last-Modified headers are sent when provided.304 updates cache
validation time without changing original report/retrieval timestamps. Upstream
max-age/Expires can shorten freshness; longer cache deadlines extend retry gates.
EONET's actual `no-cache, private` response is retained only as a visibly stale
application report snapshot, not represented as a reusable fresh HTTP response;
revalidation remains bounded by the provider gate. USGS's observed max-age60
means snapshots become stale after60s even though refresh is limited to300s.
`no-store` responses are rejected rather than persisted. Unvalidated caches
hard-expire after24h. Failed client transport retains explicitly stale reports
only up to24h from retrieval; later they disappear rather than becoming current.

`ORBITWATCH_EVENT_PROVIDER_REQUESTS=false` serves usable caches with no upstream
calls. No quota resets on panel open, retry, reload or process restart.
All client responses are private,no-store. Client requests are single-flight,
cancelled on travel/Time/logout, and never occur per marker or hover.

## Rendering and interaction

One existing Viewer; one clustered context CustomDataSource and one selected
source. Sparse category sprites, Earth depth testing and Cesium ellipsoid cluster
occlusion. Selected reports stay outside clustering. Counts use **one baked
sprite**, fixing demonstrated coincident point/label depth conflict. No through-
Earth markers, fake physical scales, interpolated event movement or derived tracks.
Only selected cyclones rotate slowly (24s illustrative symbol cycle); earthquake
symbols breathe subtly. Reduced motion freezes these; changing the preference is
checked during animation. No timers per report. Ordinary controls do not bounce.

Native event picking is consumed before satellite/celestial picking. Selecting a
report does not mutate the camera, satellite identity or Follow. An aggregate
cluster consumes its click without choosing an arbitrary incident; use the recent
report list/category filters to inspect its members or zoom manually. Hidden
layers clear entities/animation listeners; viewer disposal removes both sources
and cluster listener. Report textures are bounded small category/count assets.

## Optional sources and qualifications

[FIRMS Area API](https://firms.modaps.eosdis.nasa.gov/api/area/) requires a server-
side MAP_KEY. Its published5000transactions/10min limit can count large requests
as multiple transactions. **No FIRMS adapter is enabled** and a key alone does
not activate one; do not put a key in Vite/client code. A future optional adapter
needs key provisioning, bounded regional/product choices, hotspot semantics and
separate qualified budget. EONET/GDACS fire reports work without it.

NASA GIBS daily MODIS cloud fraction was investigated; it is not enabled as
continuous Live cloud imagery. See [Weather](WEATHER.md). Google3D cannot accept
the raster weather drape; reported-location billboards remain usable there.
No source offers guaranteed global completeness or emergency-warning suitability.

## Verification evidence

Genuine public data requests this batch: **5** — NOAA grouped1,EONET1,USGS1,
GDACS2 (map400 then documented search200). Three additional saved metadata downloads (documentation browsing separate):
NOAA inventory, GDACS Swagger, NASA GIBS capabilities. No repeated public feed
requests for stress/native browser testing: genuine responses seeded into their
normal **local** caches with original retrieval times and initial reservations.
Re-normalizing GDACS placeholders preserves retrieval times and exact gates.
No production account, Supabase record or schema writes; ingestion disabled.

`tests/check_natural_events.py` covers protected routes,36concurrent clients/
3independent jobs,48atomic reservations, provider failure/recovery,304/cache
semantics, DB gate, geometry/security/empty/stale/duplicate/unit cases.
`tests/check_weather_fields.py` generates genuine multi-message ecCodes fixtures;
instant/average, units/conversions/coverage/duplicates/truncation checked.
Frontend tests cover reversible presentation, vectors and600report ownership,
selection/cluster click isolation and cleanup. Real-browser evidence and final
outcomes are indexed in `.orbitwatch-backups/weather-events/README.md` and the
continuation checkpoint. No synthetic disasters are mixed into Live results.
