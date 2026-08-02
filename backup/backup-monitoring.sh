#!/usr/bin/env bash
#
# backup-monitoring.sh
#
# Repeatable backup of:
#   1. Prometheus TSDB  -- the prometheus image is distroless (no shell/tar), so we
#      attach an ephemeral debug container that mounts the same data volume read-only
#      and stream the TSDB out with tar.
#   2. CTFd MariaDB     -- port-forward to the DB (running inside a vcluster) and
#      mariadb-dump every database.
#
# Output goes to backup/data/<UTC-timestamp>/ (git-ignored -- the DB dump holds user PII).
#
# Usage:
#   ./backup/backup-monitoring.sh                 # back up both
#   ./backup/backup-monitoring.sh --only prometheus
#   ./backup/backup-monitoring.sh --only mariadb
#
# Everything is overridable via env vars (see CONFIG below).
#
set -euo pipefail

# ---------------------------------------------------------------------------
# CONFIG (override with env vars)
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${KUBECONFIG:=${SCRIPT_DIR}/../kubeconfig}"
export KUBECONFIG

# --- Prometheus (host cluster) ---
PROM_CONTEXT="${PROM_CONTEXT:-kubernetes-admin@pck-h7dr48y}"
PROM_NS="${PROM_NS:-monitoring}"
# Pod is auto-detected by label; override PROM_POD to pin it.
PROM_POD_SELECTOR="${PROM_POD_SELECTOR:-app.kubernetes.io/name=prometheus}"
DEBUG_IMAGE="${DEBUG_IMAGE:-alpine:3.20}"

# --- MariaDB (inside vcluster u-ctf-ctf-7001b39a) ---
DB_CONTEXT="${DB_CONTEXT:-vcluster_vcluster_u-ctf-ctf-7001b39a_kubernetes-admin@pck-h7dr48y}"
DB_NS="${DB_NS:-ctfd}"
DB_SVC="${DB_SVC:-ctfd-mariadb}"
DB_POD="${DB_POD:-ctfd-mariadb-0}"
DB_PORT="${DB_PORT:-3306}"
DB_LOCAL_PORT="${DB_LOCAL_PORT:-13306}"
DB_USER="${DB_USER:-root}"
# DB_PASSWORD is auto-read from the pod env if unset.

# --- output ---
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${OUT_DIR:-${SCRIPT_DIR}/data/${TS}}"

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
log()  { printf '\033[1;34m[%s]\033[0m %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
warn() { printf '\033[1;33m[%s] WARN\033[0m %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
die()  { printf '\033[1;31m[%s] ERROR\033[0m %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; exit 1; }

k_prom() { kubectl --context "$PROM_CONTEXT" -n "$PROM_NS" "$@"; }
k_db()   { kubectl --context "$DB_CONTEXT"   -n "$DB_NS"   "$@"; }

PF_PID=""
cleanup() { [ -n "$PF_PID" ] && kill "$PF_PID" 2>/dev/null || true; }
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 1) Prometheus TSDB
# ---------------------------------------------------------------------------
backup_prometheus() {
  log "Prometheus: resolving pod (context=$PROM_CONTEXT ns=$PROM_NS)"
  local pod="${PROM_POD:-}"
  if [ -z "$pod" ]; then
    pod="$(k_prom get pods -l "$PROM_POD_SELECTOR" -o jsonpath='{.items[0].metadata.name}')"
  fi
  [ -n "$pod" ] || die "Prometheus pod not found (selector: $PROM_POD_SELECTOR)"
  log "Prometheus: pod = $pod"

  # Auto-detect the volume mounted at /prometheus in the prometheus container.
  local vol
  vol="$(k_prom get pod "$pod" -o jsonpath='{range .spec.containers[?(@.name=="prometheus")].volumeMounts[?(@.mountPath=="/prometheus")]}{.name}{end}')"
  [ -n "$vol" ] || die "Could not find the /prometheus volume on pod $pod"
  log "Prometheus: data volume = $vol (mounted read-only into debug container)"

  local ec="tsdb-backup-$(printf '%s' "$TS" | tr 'A-Z' 'a-z')"
  local custom; custom="$(mktemp)"
  cat > "$custom" <<EOF
{"volumeMounts":[{"name":"${vol}","mountPath":"/promdata","readOnly":true}]}
EOF

  log "Prometheus: attaching ephemeral debug container '$ec' (image=$DEBUG_IMAGE)"
  # name/image/command must be passed as flags; --custom carries only volumeMounts.
  k_prom debug "$pod" -c "$ec" --image="$DEBUG_IMAGE" --custom "$custom" -- sleep 900 >/dev/null
  rm -f "$custom"

  log "Prometheus: waiting for debug container to run"
  local i st
  for i in $(seq 1 60); do
    st="$(k_prom get pod "$pod" -o jsonpath="{range .status.ephemeralContainerStatuses[?(@.name==\"$ec\")]}{.state}{end}")"
    case "$st" in *running*) break ;; esac
    sleep 1
  done
  case "$st" in *running*) : ;; *) die "Debug container '$ec' never reached Running (state: $st)";; esac

  local out="${OUT_DIR}/prometheus-tsdb.tar.gz"
  log "Prometheus: streaming TSDB -> $out"
  # 'lock' and 'queries.active' are live-runtime files; excluding them keeps the
  # archive restorable into a fresh Prometheus.
  k_prom exec "$pod" -c "$ec" -- \
    tar cf - -C /promdata --exclude=lock --exclude=queries.active . \
    | gzip > "$out"

  log "Prometheus: done ($(du -h "$out" | cut -f1)). NB: k8s cannot delete ephemeral"
  log "           containers -- '$ec' will exit on its own (sleep) and clear on pod restart."
}

# ---------------------------------------------------------------------------
# 2) CTFd MariaDB
# ---------------------------------------------------------------------------
backup_mariadb() {
  log "MariaDB: resolving credentials (context=$DB_CONTEXT ns=$DB_NS)"
  local pass="${DB_PASSWORD:-}"
  if [ -z "$pass" ]; then
    pass="$(k_db get pod "$DB_POD" -o jsonpath='{range .spec.containers[*].env[?(@.name=="MARIADB_ROOT_PASSWORD")]}{.value}{end}' 2>/dev/null || true)"
  fi
  [ -n "$pass" ] || die "Could not determine DB password (set DB_PASSWORD to override)"

  log "MariaDB: port-forward svc/$DB_SVC $DB_LOCAL_PORT -> $DB_PORT"
  local pflog; pflog="$(mktemp)"
  k_db port-forward "svc/${DB_SVC}" "${DB_LOCAL_PORT}:${DB_PORT}" >"$pflog" 2>&1 &
  PF_PID=$!

  local i
  for i in $(seq 1 40); do
    grep -q "Forwarding from" "$pflog" && break
    kill -0 "$PF_PID" 2>/dev/null || { cat "$pflog" >&2; die "port-forward died"; }
    sleep 0.5
  done
  grep -q "Forwarding from" "$pflog" || { cat "$pflog" >&2; die "port-forward not ready"; }
  rm -f "$pflog"

  local dump; dump="$(command -v mariadb-dump || command -v mysqldump)"
  local out="${OUT_DIR}/mariadb-all-databases.sql.gz"
  log "MariaDB: dumping all databases with $(basename "$dump") -> $out"
  "$dump" \
    --host=127.0.0.1 --port="$DB_LOCAL_PORT" \
    --user="$DB_USER" --password="$pass" \
    --all-databases --single-transaction --quick \
    --routines --triggers --events \
    | gzip > "$out"

  kill "$PF_PID" 2>/dev/null || true; PF_PID=""
  log "MariaDB: done ($(du -h "$out" | cut -f1))"
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
WHAT="all"
while [ $# -gt 0 ]; do
  case "$1" in
    --only) WHAT="$2"; shift 2 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown arg: $1" ;;
  esac
done

[ -f "$KUBECONFIG" ] || die "KUBECONFIG not found: $KUBECONFIG"
mkdir -p "$OUT_DIR"
log "Output dir: $OUT_DIR"

case "$WHAT" in
  all)        backup_prometheus; backup_mariadb ;;
  prometheus) backup_prometheus ;;
  mariadb)    backup_mariadb ;;
  *) die "--only must be one of: all|prometheus|mariadb" ;;
esac

# manifest
{
  echo "timestamp_utc: $TS"
  echo "scope: $WHAT"
  echo "prometheus_context: $PROM_CONTEXT"
  echo "db_context: $DB_CONTEXT"
  echo "files:"
  ( cd "$OUT_DIR" && ls -la --time-style=+%Y-%m-%dT%H:%M:%SZ | grep -vE '^total|manifest.txt' )
} > "${OUT_DIR}/manifest.txt"

log "Backup complete:"
ls -lh "$OUT_DIR" | grep -vE '^total' >&2
