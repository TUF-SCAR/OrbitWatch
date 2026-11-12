#!/usr/bin/env bash
# Installed once as root-owned /usr/local/sbin/orbitwatch-deploy.
# Called through SSM Run Command for an exact commit pushed to main.
set -Eeuo pipefail

TARGET="${1:-}"
GITHUB_REQUIREMENTS_CHANGED="${2:-false}"
if [[ "$GITHUB_REQUIREMENTS_CHANGED" != true && "$GITHUB_REQUIREMENTS_CHANGED" != false ]]; then
  echo 'Invalid requirements-changed flag' >&2
  exit 2
fi
echo "GitHub reports requirements changed in this push: $GITHUB_REQUIREMENTS_CHANGED"
if [[ ! "$TARGET" =~ ^[0-9a-f]{40}$ ]]; then
  echo 'Expected a 40-character Git commit SHA' >&2
  exit 2
fi

# No overlapping deployments, including manually triggered ones.
exec 9>/run/lock/orbitwatch-deploy.lock
flock 9

APP=/home/ubuntu/OrbitWatch
PY="$APP/.venv/bin/python"
ENV="$APP/backend/.env"
SERVICE=orbitwatch
WORKER=orbitwatch-notifications
# Verified existing Supabase target; changing projects requires a reviewed release.
EXPECTED_DATABASE_FINGERPRINT=91629c91746ef7a1

# Git operations run without root and never touch .env or .runtime.
git_as_ubuntu() { runuser -u ubuntu -- git -C "$APP" "$@"; }

[[ -x "$PY" ]] || { echo 'Missing Python virtual environment' >&2; exit 1; }
[[ -s "$ENV" ]] || { echo 'Missing backend .env (refusing deployment)' >&2; exit 1; }
[[ -z "$(git_as_ubuntu status --porcelain --untracked-files=no)" ]] || {
  echo 'Server has manually modified tracked files; refusing to overwrite' >&2
  exit 1
}

git_as_ubuntu fetch --no-tags origin main
NEWEST="$(git_as_ubuntu rev-parse origin/main)"
if [[ "$NEWEST" != "$TARGET" ]]; then
  echo "Skipped: commit $TARGET is not the latest main ($NEWEST)"
  exit 0
fi

git_as_ubuntu cat-file -e "${TARGET}^{commit}"
PREVIOUS="$(git_as_ubuntu rev-parse HEAD)"

# Compare the server's deployed revision, not only HEAD^ on GitHub:
# this catches dependency changes even when earlier deployments were missed.
if [[ "$PREVIOUS" != "$TARGET" ]] && git_as_ubuntu diff --quiet "$PREVIOUS" "$TARGET" -- backend/ deploy/ .github/workflows/deploy-backend.yml; then
  echo 'No backend changes; synchronizing Git checkout without restarting FastAPI.'
  git_as_ubuntu reset --hard "$TARGET"
  systemctl is-active --quiet "$WORKER"
  runuser -u ubuntu -- bash -c "cd '$APP/backend' && '$PY' notification_health.py --require-worker --require-push"
  exit 0
fi

REQUIREMENTS_CHANGED=0
if ! git_as_ubuntu diff --quiet "$PREVIOUS" "$TARGET" -- \
    backend/requirements.txt backend/requirements.lock; then
  REQUIREMENTS_CHANGED=1
fi
# Trust the actual server baseline for install decisions. A previous failed
# deployment can leave more changes pending than the latest GitHub push alone.
echo "Requirements changed since server revision: $REQUIREMENTS_CHANGED"

SWITCHED=0
WORKER_WAS_ACTIVE=0
WORKER_WAS_ENABLED=0
systemctl is-active --quiet "$WORKER" && WORKER_WAS_ACTIVE=1
systemctl is-enabled --quiet "$WORKER" && WORKER_WAS_ENABLED=1
WORKER_BACKUP="$(mktemp)"
if [[ -f "/etc/systemd/system/$WORKER.service" ]]; then
  cp "/etc/systemd/system/$WORKER.service" "$WORKER_BACKUP"
fi
on_failure() {
  local result=$?
  trap - ERR
  if [[ "$SWITCHED" == 1 ]]; then
    systemctl stop "$WORKER" || true
    echo "Deployment failed (status $result), restoring code at $PREVIOUS" >&2
    git_as_ubuntu reset --hard "$PREVIOUS" || true
    if [[ "$REQUIREMENTS_CHANGED" == 1 ]]; then
      echo 'Attempting to restore previous Python dependencies...' >&2
      runuser -u ubuntu -- "$PY" -m pip install \
        -r "$APP/backend/requirements.lock" \
        -r "$APP/backend/requirements.txt" || true
    fi
    systemctl restart "$SERVICE" || true
    if [[ -s "$WORKER_BACKUP" ]]; then
      install -o root -g root -m 644 "$WORKER_BACKUP" "/etc/systemd/system/$WORKER.service"
      systemctl daemon-reload
    fi
    if [[ "$WORKER_WAS_ENABLED" == 0 ]]; then systemctl disable "$WORKER" || true; fi
    if [[ "$WORKER_WAS_ACTIVE" == 1 ]]; then systemctl restart "$WORKER" || true; fi
    if curl -fsS --max-time 7 http://127.0.0.1:8000/health/ready >/dev/null; then
      echo 'Previous backend restored and ready.' >&2
    else
      echo 'Warning: rollback health check unsuccessful; inspect service manually.' >&2
    fi
  fi
  rm -f "$WORKER_BACKUP"
  exit "$result"
}
trap on_failure ERR
if [[ "$WORKER_WAS_ACTIVE" == 1 ]]; then systemctl stop "$WORKER"; fi

# The .env, persistent .runtime caches, .venv and user-created untracked files
# remain untouched. Changes to tracked code are controlled by GitHub main.
git_as_ubuntu reset --hard "$TARGET"
SWITCHED=1

if [[ "$REQUIREMENTS_CHANGED" == 1 ]]; then
  echo 'Python requirements changed: installing pinned + direct dependencies.'
  runuser -u ubuntu -- "$PY" -m pip install \
    -r "$APP/backend/requirements.lock" \
    -r "$APP/backend/requirements.txt"
  runuser -u ubuntu -- "$PY" -m pip check
  runuser -u ubuntu -- "$PY" -m eccodes selfcheck
else
  echo 'Python requirements unchanged: skipping pip install.'
fi

# Smoke-check imports before interrupting the running service.
runuser -u ubuntu -- "$PY" -m compileall -q "$APP/backend"
runuser -u ubuntu -- bash -c \
  "cd '$APP/backend' && '$PY' -c 'import main'"

# Explicit additive schema admission/target checks. No create_all or user seeding.
# New empty tables/columns safely remain if application code needs rollback.
runuser -u ubuntu -- bash -c \
  "cd '$APP/backend' && '$PY' apply_account_migrations.py --apply --expected-target '$EXPECTED_DATABASE_FINGERPRINT'"
runuser -u ubuntu -- bash -c \
  "cd '$APP/backend' && '$PY' configure_notifications.py --configure --expected-target '$EXPECTED_DATABASE_FINGERPRINT'"
install -o root -g root -m 644 "$APP/deploy/orbitwatch-notifications.service" "/etc/systemd/system/$WORKER.service"
systemctl daemon-reload
systemctl enable "$WORKER"

systemctl restart "$SERVICE"

healthy=0
for attempt in $(seq 1 18); do
  if curl -fsS --max-time 4 http://127.0.0.1:8000/health/live >/dev/null 2>&1 && \
     curl -fsS --max-time 6 http://127.0.0.1:8000/health/ready >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 3
done

if [[ "$healthy" == 0 ]]; then
  echo 'Health check failed after restart' >&2
  false
fi

systemctl restart "$WORKER"
worker_healthy=0
for attempt in $(seq 1 40); do
  if systemctl is-active --quiet "$WORKER" && runuser -u ubuntu -- bash -c \
    "cd '$APP/backend' && '$PY' notification_health.py --require-worker --require-push"; then
    worker_healthy=1
    break
  fi
  sleep 3
done
if [[ "$worker_healthy" == 0 ]]; then
  echo 'Notification worker/schema/push readiness check failed' >&2
  false
fi

SWITCHED=0
trap - ERR
rm -f "$WORKER_BACKUP"
echo "Successfully deployed $TARGET, API ready and notification worker heartbeat/push configuration verified"
