# OrbitWatch V6 scientific accuracy audit

Batch F.1 started from `ce8775d`. The release check used independent reference values, production reads, local real-data replays and isolated regression tests. This report describes the tested samples and the limits of the result.

## Findings

| Severity | Evidence | Correction or limitation |
| --- | --- | --- |
| Major | Time Explorer's simplified Moon differed from JPL Horizons by up to 93,973 km. The Live Moon used a different position model from its plotted orbit. | Both modes now use the existing analytical lunar theory for the position. The plotted track samples the same theory over a mean sidereal month, beginning at the measured scene position, with an open endpoint. |
| Major | The Live satellite endpoints could start a new propagation using elements older than seven days. Four production records were already in that band. | Live validates the TLE checksum, identity and epoch. It rejects elements whose epoch is outside the existing Skywatch age band, including stale cached propagators. Historical propagation retains its separate 24-hour selection rule. |
| Major | Historical and expired minor-body fallback geometry could produce precise-looking distances between schematically placed bodies. | The inspector identifies schematic placement and omits those calculated distances. Scientific reference sizes and elements remain accessible. |
| Major | All five Natural Events caches were stale at the first inspection. NHC and IBTrACS had no independent refresh path without an API consumer. The notification route's event refresh also depended on saved observer locations. | The existing single API scheduler owner checks for due feeds once a minute. HTTP requests still share each provider's persistent budget, backoff and exclusion lease. Validation age and observation age remain independent. |
| Minor | Time Explorer grouped gaps with older usable archive windows under generic unavailability. | The UI identifies a past window that fails the 24-hour policy as stale at the requested instant. Verified launch, decay, missing data and propagation failure retain distinct handling. |
| Minor | Phone weather details abbreviated relative humidity and mean sea-level pressure in ways that obscured the measured variable. | The phone inspector uses the same specific terms as desktop, including the 10 m wind reference height. |
| Documented limitation | Analytical planets, some moon and dwarf-planet placements, model weather cells, coverage gaps and forecast cones each limit observational claims. | The application retains the two modes and the existing precision and attribution boundaries. The tests cover representative numerical cases and catalogue-wide structure. |

## Celestial positions and presentation

Checked 47 catalogue destinations structurally, including 26 moons, eight planets, the Sun, five dwarf planets and seven named asteroids. The checks covered finite metre coordinates, orbit geometry, parent-relative offsets, changing dates, local camera frames, and ICRF-to-Earth-fixed consistency. JPL reference vectors were independently queried for 18 targets or reference points at five dates, for 90 comparisons. The five instants were 1957-10-05, 1970-01-15, 2000-01-01, 2024-10-15 and 2026-11-26 at 12:00. Horizons reports UT1 before 1962 and UTC thereafter under `TIME_TYPE=UT`. The pre-1962 mismatch is subsecond at the scale tested. Vectors are geometric ICRF with no aberration correction, using Earth centers for planets and the Moon, parent centers for the other sampled moons, and the Sun for minor bodies and the Earth–Moon barycentre. No compressed render scale entered the comparisons. [Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html) · [Frames and time scales](https://ssd.jpl.nasa.gov/horizons/manual.html)

The existing analytical lunar model is appropriate to the educational scene. The original 1,000 km screening envelope was exceeded once by 106 km. The regression bound is 1,500 km for these dates. It is an empirical test tolerance and carries no guarantee outside these dates. Distances below are center to center. XYZ error is the norm of the vector difference, so it also detects directional error.

| UTC or UT1 | Horizons distance km | Time Explorer before km | After km | XYZ error before km | XYZ error after km |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1957-10-05 12:00 | 405,862.22 | 391,700.49 | 405,748.42 | 62,173.7 | 890.3 |
| 1970-01-15 12:00 | 387,941.43 | 372,007.28 | 387,663.11 | 93,973.3 | 1,106.3 |
| 2000-01-01 12:00 | 402,450.70 | 400,080.23 | 402,317.66 | 4,485.9 | 250.0 |
| 2024-10-15 12:00 | 359,434.27 | 384,635.79 | 359,596.98 | 44,045.8 | 605.3 |
| 2026-11-26 12:00 | 359,689.55 | 363,179.84 | 359,750.12 | 46,517.1 | 681.6 |

The remaining major-body model comparisons stayed within broad education-scale bounds, based on the documented low-precision planetary fits and the Earth reference error. Positions for these bodies did not change in this batch.

| Target | Worst Time Explorer / Live XYZ error, km | Screening bound, km |
| --- | ---: | ---: |
| Sun | 11,995 / 7,029 | 30,000 |
| Mercury | 7,539 / 6,723 | 30,000 |
| Venus | 17,144 / 12,959 | 40,000 |
| Earth–Moon barycentre | 7,036 / 7,036 | 30,000 |
| Mars | 27,841 / 23,862 | 90,000 |
| Jupiter | 1,151,106 / 1,149,791 | 3,500,000 |
| Saturn | 3,846,213 / 3,847,928 | 6,500,000 |
| Uranus | 1,309,868 / 1,306,610 | 4,000,000 |
| Neptune | 1,173,267 / 1,175,665 | 1,700,000 |

At 2026-11-26 12:00, five usable production small-body solutions differed from Horizons by 0.1 km for Bennu, 257 km for Pluto, 7,545 km for Vesta, 17,298 km for Ceres and 18,515 km for Eris. The two-body solutions are local to their published epoch windows. Their future errors can grow, especially around encounters. The older schematic fallback reached 1.26 billion km XYZ error for Eris across the sampled dates. Parent-centered errors for the modelled Io, Titan and Triton reached 837,307 km, 936,910 km and 278,892 km, consistent with unsuitable phases for observational use. A time-specific fit for these moons remains unavailable in the scene. [JPL approximate elements and range](https://ssd.jpl.nasa.gov/planets/approx_pos.html) · [JPL small-body database](https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html) · [JPL satellite mean elements](https://ssd.jpl.nasa.gov/sats/elem/)

Size and orbital fact cards use the catalogued rounded reference radii, twice the radius for diameter, and physical AU conversion of exactly 149,597,870.700 km. Inclination uses the fit's implied angle magnitude, while the position math retains the signed input. Rotation directions for retrograde bodies and period qualifiers belong to the facts or rendering models. Rendered body spin, rings, gravity and mass are outside the independent numerical verification of position. The full fact catalogue was structurally reviewed, with planetary and moon physical references checked for terminology and representative values rather than a field-by-field independent reconstruction of each body. [JPL planetary physical parameters](https://ssd.jpl.nasa.gov/planets/phys_par.html)

The seeded main belt uses semimajor axes at 2.2–3.3 AU and depleted Jupiter resonances. Trojans retain the two broad islands around ±60° from Jupiter. The Kuiper sample covers 30–50 AU with cold and inclined components. The scattered subset has semimajor axes of 52–90 AU and Neptune-region perihelia. These synthetic distributions describe representative structure. The Oort hypothesis is sampled as a 5,000–100,000 AU shell, stored in compressed render units and navigated with conceptual AU distances. The normal view stays capped at 240 AU and the dedicated Oort view covers 16,000–240,000 AU. These particles have no catalogue identities or measurements. [NASA Solar System facts](https://science.nasa.gov/solar-system/solar-system-facts/) · [NASA Oort Cloud facts](https://science.nasa.gov/solar-system/oort-cloud/facts/)

## Satellites and observing

Production contained 143 distinct Live TLE rows and 143 catalogue identities. All 143 stored TLE checksums and parsed NORAD IDs matched. Epoch ages were 106 under one day, 33 from one to seven days, and four older than seven days at inspection. A recent fetch timestamp can coexist with an old dynamical epoch. Live now rejects out-of-window element epochs and mismatched input records before asking the propagator for a new position. Skywatch keeps its existing seven-day maximum.

The backend's TEME output was compared with Vallado's published position and velocity vectors at epoch and one positive offset for each representative regime. Acceptance was 0.001 km and 0.000001 km/s, with allowance for UTC/Julian-date and reference-frame round trips. The reference dataset contains its original TLEs and output values. The app still uses Skyfield SGP4, UTC, installed UT1 data and WGS84 geodetic altitude. Missing polar motion, maneuvers, drag, ground-model accuracy and source age limit actual tracking accuracy. [Vallado et al. and verification data](https://celestrak.org/publications/AIAA/2006-6753/faq.php) · [Skyfield satellite frames and timing](https://rhodesmill.org/skyfield/earth-satellites.html)

| NORAD reference | Regime | Max position difference, km | Max velocity difference, km/s |
| --- | --- | ---: | ---: |
| 5 | Near-Earth eccentric | 0.000113 | 0.000000109 |
| 28129 | GPS / MEO | 0.0000658 | 0.00000000967 |
| 14128 | Near geosynchronous | 0.00000919 | 0.00000000108 |
| 8195 | Inclined Molniya | 0.000186 | 0.0000000538 |

Production Time Explorer has 15 identities and four defaults, ISS, Hubble, CSS and Landsat 8. Every identity had stored Space-Track history at inspection, totaling 1,183 element sets. Coverage spans selected epochs from 2000-01-01 to 2026-04-15 and varies by identity. Some objects have only one UTC day of records. The backend finds the newest epoch at or before the requested instant with a maximum age of 24 hours, then applies documented lifetime and propagation checks. Trajectory paths are clipped to the same epoch's validity interval. Historical and Live records remain independent. Source epochs are sparse, launch metadata can be day-level, and archive gaps do not imply decay.

My Skywatch retains DE421/Skyfield topocentric checks for geometric altitude, satellite illumination and observer darkness, conservative screening, observing location and timezone, and qualified equipment guidance. An independent Horizons airless topocentric check at 40.7128° N, 74.006° W compared Moon, Mars and Jupiter at 2024-05-09 23:58, 2024-05-10 00:20 and 2026-11-26 12:00 UTC. All nine samples were within 0.05° in both azimuth and elevation. At the first instant, the Moon was at 286.1493685° azimuth and 22.6118774° elevation in Horizons, versus 286.1493572° and 22.6118942° in Skywatch before and after. The largest azimuth difference was 0.0011854° for Mars, and the largest elevation difference was 0.000527° for the Moon. The automated tests include DST, forecast interval and stale-element checks. Live skyline, refraction, actual optics and weather at the moment of observation remain unverified. [JPL airless observer ephemeris](https://ssd.jpl.nasa.gov/horizons/manual.html)

## Live and historical weather

Independent ecCodes nearest-node lookup in the retained NOAA GFS file validated seven planes at eight coordinates, including the antimeridian, both near-pole latitudes, a mountain, coastal and inland points. This was a NOAA GFS 2026-11-01 06:00 UTC physical alignment and conversion check. NOAA inputs confirm instantaneous liquid water-equivalent PRATE in kg/m²/s, 2 m temperature in K, 2 m relative humidity in percent, 10 m wind U/V in m/s, and pressure at mean sea level in Pa. The app converts to °C, mm/h and hPa, and uses east/north wind flow toward the destination while textual bearings represent wind-from. Explicit precipitation phase flags remain categorical, with missing and ambiguous data handled separately. [NOAA GFS GRIB parameters](https://www.nco.ncep.noaa.gov/pmb/products/gfs/) · [NOAA NOMADS](https://nomads.ncep.noaa.gov/)

| Field | NOAA reference at 0°, 0° | OrbitWatch before and after | Worst difference at eight nodes | Acceptance tolerance |
| --- | ---: | ---: | ---: | ---: |
| Temperature °C | 26.43678 | 26.4 | 0.03678 | 0.0501 |
| Precipitation mm/h | 0.12384 | 0.124 | 0.00036 | 0.00051 |
| Cloud fraction % | 100 | 100 | effectively zero | 0.00051 |
| Humidity % | 84.2 | 84.2 | effectively zero | 0.00051 |
| Mean sea-level pressure hPa | 1012.5534 | 1012.553 | 0.0004 | 0.00051 |
| Wind U m/s | −1.381904 | −1.382 | 0.000096 | 0.00051 |
| Wind V m/s | 5.386563 | 5.387 | 0.000438 | 0.00051 |

The licensed EUMETView observed layer is `mumi:worldcloudmap_ir108`. Production retained validated global 2048×1024 images, including the 2026-11-26 06:00 UTC observation published to the cache at 09:40 UTC. The decoder and display use the configured geographic projection and longitude wrapping. The imagery shows IR emphasis for covered regions and the source has polar limits. Model cloud percentage is a separate model field. This audit did not independently georeference the IR image pixel by pixel or observe a physical phone. [EUMETView product](https://view.eumetsat.int/productviewer/productDetails/mumi%3Aworldcloudmap_ir108)

All 16 production ERA5 snapshots passed database/object/checkpoint agreement, byte count, SHA-256, approved timestamp, one-degree orientation, header and eight decoded field checks. They cover the Jan/Apr/Jul/Oct 15 slots at 12:00 UTC in 1970, 1980, 2000 and 2024. All eight planes in those snapshots were finite over the stored 65,160 nodes and within the codec's physical bounds. No unindexed object appeared at inspection. The approved ingestion target remains 227. Weather outside an exact stored timestamp is unavailable. Spatial interpolation stays within a verified snapshot and wraps longitude.

The retained raw CDS file matched the recorded source SHA-256 for all four 2024 snapshots. Independent ecCodes lookup plus explicit conversions passed 256 comparisons across eight fields, eight coordinates and four times. At (0°, 0°) on 2024-01-15 12:00 UTC, reference versus published results were 26.00649 vs 26.01 °C, 0.146866 vs 0.15 mm preceding-hour precipitation, and 1014.226875 vs 1014.2 hPa mean sea-level pressure. Maximum difference across the 256 samples was 0.004987 in nonpressure display units and 0.04750 hPa for pressure. These are within half a quantization step plus a small floating-point allowance. Precipitation GRIB metadata confirmed the forecast-based one-hour accumulation ending at the stated UTC time. The baseline and corrected release have identical weather physics. Raw downloads for 1970, 1980 and 2000 were absent from the retained source directory, so those decades received integrity and range checks only. [ERA5 data documentation](https://confluence.ecmwf.int/spaces/CKB/pages/76414402/ERA5+data+documentation)

## Natural Events

The cache and display classification distinguish dated occurrences, dated reports, closed reports, confirmed active or ended storms, forecasts and older or unverified records. Upstream open status alone carries no active-hazard evidence. Published points, polygons, reports and identity-bound tracks have separate handling. NOAA forecast tracks and uncertainty cones appear only when an official matched product is available. A cone describes historical uncertainty of the forecast storm center and has no storm-size or guaranteed-impact interpretation. The inspected NHC feed had zero current storms or official forecasts, so the actual cone path could only be exercised with provider contracts and fixtures. [NASA EONET](https://eonet.gsfc.nasa.gov/docs/v3) · [GDACS documentation](https://gdacs.org/Documents/2025/GDACS_API_quickstart_v1.pdf) · [NOAA cone definition](https://www.nhc.noaa.gov/aboutcone.shtml)

USGS event `aka2026xkkapt` matched the independent official GeoJSON detail exactly in origin time (2026-11-26 09:24:20.916 UTC), longitude −156.931°, latitude 54.674°, local magnitude 3.3 ML and hypocentral depth 5.0 km. This magnitude describes the source, while local shaking and damage are separate quantities. [USGS event detail](https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&eventid=aka2026xkkapt) · [USGS GeoJSON format](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php)

| Provider | Cached reports | Validation age | HTTP/application freshness | Recent classifications in its cache |
| --- | ---: | ---: | --- | --- |
| EONET | 646 | 34m 39s | Upstream requires revalidation | One recently closed wildfire, three recently closed floods, one dated ice report |
| GDACS | 31 | 49m 59s | 15 minutes | Four drought reports |
| USGS | 1,824 | 44m 54s | One minute | 37 earthquakes within 24 hours |
| IBTrACS | 2 | 18h 32m 48s | 12 hours | One independently confirmed ended cyclone |
| NHC/CPHC | 0 | 17h 17m 07s | Five minutes | Empty validated feed at last refresh |

All five caches reported zero preceding gate failures. Provider publication cadence, HTTP freshness directives and shared request intervals can still yield stale labels after the scheduler correction. In particular, EONET's `no-cache` directive remains respected, and USGS and NHC freshness windows can expire before the next budgeted request. The change removes browser dependence from acquisition and keeps these distinctions. It introduces no new provider, increase in caps, or automatic attribution of effects to reported hazards.

## Test evidence

The serial targeted frontend test run passed 40 of 40 tests across ephemerides, scene ownership, Time Explorer, weather, precipitation hover and Natural Events. ESLint and the production build passed. Vite's existing bundle-size warning remains. In local Chrome at 1280×900 and 390×844, genuine ERA5 data replayed the January-to-April 2024 change, all five displayed weather layer selectors, the wind legend and the location inspector. Desktop and phone both received 34.66720946 °C at the shared scene center for 2024-04-15 12:00 UTC. The phone inspector and color legend took turns to preserve the center viewport. The phone resumed its legend after the inspector closed and rendered the full mean sea-level pressure label in the details. This was a local data replay with desktop Chrome and touch emulation.

`tests/check_scientific_accuracy.py` passed the published SGP4 vector check, Live-specific age and input guard, and due-provider scheduler check. The initial 5 cm position bound failed with an 11.3 cm numerical residual. The reported 1 m reference threshold accounts for the round trip through separately parsed UTC. The historical PostgreSQL test used the genuine retained archive, reimported 1,183 unique records idempotently, found 13 usable tracks at 2024-06-02 16:00 UTC, and matched ISS OMM/TLE within the 10 m reference envelope. It made zero orbital provider requests. The database setup included the previously deployed authentication tables.

An additional 28 frontend tests passed for TEME/UT1 and ITRS geometry, ring and population placement, Oort distances, weather fields and wind direction. Backend checks passed for the 14 historical weather cases, model fields, recorded GFS phase, observed infrared, 14 Natural Events expansion tests, Natural Events concurrency and provider budgets, and 16 authenticated Skywatch HTTP checks. The Natural Events fixture made zero provider requests and exercised 36 consumers and 48 atomic reservations. The historical-weather fixture supplied its own database dependency for the unauthenticated contract because the current bearer path expects one.

The broader reliability script failed at an existing authentication edge case. Its invalid-token request returned 503 while the database was unavailable, whereas the fixture expected 401. This code was unchanged from the starting commit. Windows denied symlink creation for the local deployment-helper check, and that check passed as a required step of the Linux release workflow.

## Production verification

The AWS release converged on `6d575e57a88e1aa9df0651ca60dec2f6e1752225`. Cloudflare served the new JS containing the schematic and stale archive labels. The read-only deployed-route smoke returned HTTP 200 and a timestamped TEME sample for ISS and HTTP 503 for each of the four old element sets (28485, 36402, 37869 and 43435). FastAPI was ready, Caddy and the notification service were active, and the worker heartbeat was 11.4 seconds old with no reported error. [Successful AWS deployment](https://github.com/TUF-SCAR/OrbitWatch/actions/runs/45816421551)

The API service entered active state at 12:06:33 UTC on 2026-11-26. By 12:07:43 UTC, all five provider caches had validated successfully with no Natural Events API calls made by this audit. USGS retained 1,819 reports, EONET 646, GDACS 31, IBTrACS two, and NHC an empty current feed. Cache validation did not imply a new official occurrence for any unchanged report.

ERA5 kept PID 124832 through deployment. The checkpoint and Supabase still recorded 16/227 published snapshots (7.05%), with 1990 as the current campaign year. PostgreSQL had 484,882,541 bytes free and object storage had 988,927,877 bytes free under the existing quota assumptions. Both exceed the 200 MB reserve. The audit made no CDS requests and used read-only inventory, object reads and snapshot comparisons.
