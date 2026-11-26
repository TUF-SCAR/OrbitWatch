# OrbitWatch V6 final release audit

The audit started on clean `main` at `ad0f8a8c2df4eb39fa3a6c4f7c67537885530d4f`. Live Mode and Time Explorer remain the two primary modes. The permanent desktop freeze in [AGENTS.md](../AGENTS.md) applies to the whole release. The release contains no frontend source, desktop style, orbital calculation, or ERA5 campaign changes.

## Security and authentication

Production PostgreSQL metadata showed that `public.users`, `public.satellite_orbit_data`, and `public.satellite_orbit_history` had direct grants for `anon` and `authenticated`, with row-level security disabled. The audit queried grants, indexes, foreign keys, and RLS state without reading account contents. Historical access via those grants was not established.

Migration `010_private_backend_tables.sql` enables RLS and revokes table privileges from `PUBLIC`, `anon`, and `authenticated`. The deployment's database role retains access as table owner. A local PostgreSQL/PGlite integration test executed the migration twice, checked direct grants and RLS, and verified that the non-superuser owner kept its existing rows and could still write. The targeted production transaction checked the expected Supabase target, kept the three row counts unchanged, verified the new role access, and completed without a service restart. The deployment migration checks the same access conditions. Related account, notification, and archive tables already had RLS and no browser-role policies.

FastAPI previously opened its database dependency before examining bearer credentials. The protected dependency now validates the signature, claims, and expiry first, then checks the revocation digest and loads the user through the same database session. Missing, malformed, expired, and wrong-signature credentials are rejected before the database dependency. A correctly signed token still needs the database and returns HTTP 503 during an outage. The regression covers auth, satellite, and account routes. The outage fixture now uses a registration password that satisfies the existing minimum and disposes the SQLite engine even when an assertion fails.

The account audit covers Argon2id, registration and normalization, rate limits, token expiry, independent sessions, logout revocation, owner filters, request validation, and sanitized errors. The existing browser bearer token remains in local storage and can be read by same-origin JavaScript. This release preserves the session architecture. ORM operations pass user values as parameters. PostgreSQL has uniqueness constraints and foreign keys for account and notification ownership. The database connection pool has a bounded size, connection timeout, pre-ping, and a shared read-only readiness probe with backoff.

## Dependency review

`npm audit` reported nine affected package entries before the update and zero after a clean lockfile install. Vite moved from 8.1.5 to 8.1.6 with Rolldown remaining at 1.1.5. ESLint moved within major version 10. The compatible lockfile fixes also cover DOMPurify, brace-expansion, minimatch, nanoid, source-map-js, and Zod. The project kept its dependency ranges.

OSV checked all 40 pinned Python packages. The initial results included advisories and aliases for certifi and PyJWT. Updating certifi to 2026.10.18 and PyJWT to 2.15.0 cleared the results. The CPython 3.12 environment passed `pip check`. [certifi advisory](https://github.com/advisories/GHSA-6q48-6c7w-9gw2) · [PyJWT advisories](https://github.com/advisories/GHSA-42vr-xj54-vc7v) · [PyJWT JWK advisory](https://github.com/advisories/GHSA-x33g-cr3x-6449)

## Performance and recovery

The local FastAPI benchmark measured 12 requests per case on an isolated SQLite database, resetting the readiness gate for each case. These are in-process route timings. The query counts and HTTP behavior are the primary comparisons.

| Case | Before | After |
| --- | --- | --- |
| Malformed token, database reachable | 401, 3 SQL calls, 5.26 ms median | 401, 0 SQL calls, 3.06 ms median |
| Malformed token, simulated outage | 503, 1 SQL call, 4.22 ms median | 401, 0 SQL calls, 2.80 ms median |
| Signed token, database reachable | 200, 5 SQL calls, 10.38 ms median | 200, 5 SQL calls, 10.25 ms median |
| Signed token, simulated outage | 503, 1 SQL call, 5.31 ms median | 503, 1 SQL call, 4.78 ms median |

The production build reports a 1,805.75 kB application chunk, 535.90 kB gzip. Vite reports its 500 kB advisory. Cesium is loaded separately. The browser workflows retain the existing scene loader and local Earth textures. The audit retains the existing startup/deferred loading boundaries because the reviewed security patch leaves the built frontend application assets identical and a broader split would require measuring the startup animation and scene readiness again.

The source review covered bounded provider budgets, shared weather polling and cache ownership, Retry-After behavior, archived snapshot checksum and bounds checks, and cancellation when the source changes. Time Explorer still applies nearest-match selection to weather only. Historical orbital elements retain the non-future 24-hour policy. Existing stale and unavailable views retain their source timestamps. The release does not change scheduling or scientific data requests.

The synthetic Live API fixture exposed a timezone mismatch in SQLite, which drops the offset from stored UTC epochs. The Live validator now treats those offset-free stored values as UTC and retains identity, checksum, two-second epoch agreement, and age checks. The regression verifies that a matching offset-free epoch is accepted and a three-second discrepancy is rejected. Synthetic integration TLEs now carry valid checksums. PostgreSQL returns timezone-aware values through its existing path.

A read-only production service probe of the 15 July 2024 ERA5 snapshot measured 4,359 ms on the first load and 730 ms on the repeat, with all eight fields validated. These are two service measurements from EC2, including Supabase and storage I/O. The HTTP route already bounds and gzip-compresses snapshot JSON. The cache and response format stay in place.

A Chrome diagnostic build with software WebGL reached its ready HUD in 37.6 seconds during a concurrent test run. Three desktop trips into and out of the Oort Cloud restored the 240 AU view, exercised wheel zoom and the 16,000 AU endpoint, and returned through Time Explorer to Live. Post-GC JS heap snapshots were 27.0 MB at the initial overview, 27.6 MB, 27.8 MB, and 29.7 MB after the three trips, and 28.5 MB after the mode switch. JavaScript event listeners went from 266 to 269 after the mode switch. These measurements cover one bounded run and do not establish GPU memory or long-session leak behavior.

## ERA5 and production infrastructure

The first read-only inspection found 20 of 227 published snapshots, with 207 pending. The years 1970, 1980, 1990, 2000, and 2024 each have four snapshots at 12:00 UTC on January 15, April 15, July 15, and October 15. All 20 published database rows matched approved timestamps and the sizes of their 20 private storage objects. There were zero unindexed objects or unknown-size objects. PostgreSQL contained 1,183 historical satellite element rows.

| Capacity, decimal MB | Used | Free | Projected at 227 |
| --- | ---: | ---: | ---: |
| PostgreSQL, 500 MB | 14.89 | 485.11 | 28.45 used |
| Object storage, 1,000 MB | 13.84 | 986.16 | 192.84 used |

The checkpoint at 17:32:30 UTC on 26 November showed a running campaign with one accepted request for 1971, 2010, and 2020. The job ID ends in `70848f4c3731`. The newest completed benchmark in the checkpoint covered 1990. It waited 25,601.6 seconds in the provider queue, ran 9.68 seconds, and transferred 3,651,984 bytes in 4.04 seconds. Validation, publication, and verification took 54.96 seconds. Peak RSS was 169,920 KiB. No completed three-year result was present at that inspection. Neither quota approached the 200 MB reserve.

EC2 reported load averages of 0.09, 0.03, and 0.01, 741 MiB available RAM, 4 MiB used swap, and 23 GiB free on the root volume. Caddy, FastAPI, the notification worker, and the ERA5 campaign were active. Notification health reported a 3.5-second heartbeat, no recorded error, and push configured. The ERA5 campaign PID was 124832. Public HTTPS liveness and readiness both returned HTTP 200. The three sampled protected routes returned HTTP 401 without credentials. The public HTTPS timing samples include laptop network and TLS time.

## Demonstration dates

- **2 June 2024 at 16:00 UTC (21:30 IST).** The live archive contains 13 eligible catalog identities, including ISS, under the non-future 24-hour rule. Use the featured scene in Available History. The weather source is the nearest approved snapshot on 15 July 2024 at 12:00 UTC.
- **15 July 2024 at 12:00 UTC (17:30 IST).** Use this date to show an exact genuine ERA5 match. The private snapshot passed checksum and eight-field validation. The orbital archive has zero eligible catalog identities at that instant.

## Physical-device verification

Use an authorized disposable account on the intended demo handset. Open the bell, choose **Browser notification settings**, enable browser notifications, and accept the operating-system and browser prompts. Select **Send test notification** and confirm that **OrbitWatch delivery test** appears at the system level. Repeat once in a background tab and once after closing the OrbitWatch tab. Tap a displayed test notification and confirm it opens the inbox. Disable notifications and verify the device is removed. On iOS, use the Home Screen installation. Provider acceptance is a separate result from system notification display.

Verify portrait and landscape safe areas, the dynamic browser bars, the native keyboard with Location Search and the date picker, and Android Back through a nested dialog on the real handset. Browser emulation can exercise those layouts and dialog transitions but cannot confirm the actual system chrome or device notification display.
