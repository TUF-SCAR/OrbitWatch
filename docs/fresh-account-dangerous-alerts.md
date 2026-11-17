# Fresh-account dangerous alerts

## Inspection and reproduction

Inspected `backend/services/notification_runner.py`, `backend/services/notification_policy.py`, the `NotificationPreferences` defaults in `backend/models/account.py`, and the isolated notification delivery fixture in `tests/check_notification_delivery.py`.

The regression fixture creates a newly registered account with a saved location and no `NotificationPreferences` row, then supplies a recent nearby USGS event whose measured magnitude is 6.2. Before the fix, `run_once` completed but returned `{'state': 'completed', 'evaluated': 1, 'generated': 0}`. The fresh account was not among the single owner evaluated, so it received no inbox entry or push.

## Root cause and evidence

There were multiple missing-row gates in the actual path:

- `run_once` selected owners from `NotificationPreferences`, excluding accounts that had saved a location but had never saved notification settings.
- `evaluate_owner` returned immediately when preferences were absent and later code assumed a preference snapshot existed.
- The dangerous-event branch in `preferences_allow` required a preferences row, while `persist` and `process_outbox` dereferenced it to check the event radius.

The test's pre-fix result confirms the first gate prevented the new account from being evaluated. Code inspection found the additional gates that would also reject or fail delivery if the account were evaluated directly.

## Change and implementation decisions

The runner now selects distinct owners with saved observation locations. Accounts without a preferences row can reach dangerous-event evaluation, while ordinary satellite, celestial, and natural-event alerts still require their existing explicit preference opt-ins and continue to honor Quiet Mode.

When a preference row is absent, event distance checks use the mapped `event_radius_km` default from `NotificationPreferences` (100 km), rather than inventing a new setting or inserting a row. Dangerous delivery still requires an event notification, an owned saved location, and current event data that passes the existing freshness, geometry, and quantitative severity rules. The outbox repeats those checks before mocked push delivery. No schema, application authentication, or unrelated UI changes were made; the precipitation tooltip was left untouched.

An alternative was to create preferences automatically for every new account. That would add writes and make the notification settings lifecycle implicit. Reading the existing model default keeps the patch smaller and preserves ordinary notifications as opt-in.

## Verification

The Windows sandbox initially blocked Starlette `TestClient` while it opened its local socket pair. The same isolated test commands were then run with elevated local execution; their fixtures use temporary SQLite data and mocked push delivery, not production services.

Before the fix, command:

```powershell
& .\backend\.venv\Scripts\python.exe tests\check_notification_delivery.py
```

Result: **failed as expected** at the fresh-account assertion with `{'state': 'completed', 'evaluated': 1, 'generated': 0}`.

After the fix, the same command passed: `PASS ... 31 HTTP checks; sqlite`. The regression verifies a no-preferences account is selected by the worker, receives an inbox alert and mocked push, and is not sent a duplicate on re-evaluation. It also verifies that an eligible account receives a dangerous-event alert in Quiet Mode, a qualifying ordinary event is still suppressed by Quiet Mode, and stale dangerous-event data creates no delivery record.

Related notification/account regression command:

```powershell
& .\backend\.venv\Scripts\python.exe tests\check_account_alerts.py
```

Result: **passed**; catalog/subscription, inbox isolation and retention, database constraints, readiness, and **101 HTTP checks** passed.

The PostgreSQL variants were not run because this local verification used the repository's disposable SQLite fixture; no PostgreSQL test service was started. No application server, provider, or production service was started or contacted. The deployment integration script was not run because it does not exercise this notification evaluation path.
