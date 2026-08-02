# Monitoring & CTFd backups

`backup-monitoring.sh` backs up two data sources so they can be replayed later
for the portfolio charts:

| What | How | Output |
|------|-----|--------|
| Prometheus TSDB | ephemeral debug container (prometheus image is distroless) mounts the data volume read-only and streams it out with `tar` | `data/<ts>/prometheus-tsdb.tar.gz` |
| CTFd MariaDB | `kubectl port-forward` to the DB (inside vcluster `u-ctf-ctf-7001b39a`) + `mariadb-dump --all-databases` | `data/<ts>/mariadb-all-databases.sql.gz` |

The Prometheus data volume is an **`emptyDir`** (retention 10d). It is lost on
every pod restart, so run this regularly if you want continuous history.

## Run

```bash
./backup/backup-monitoring.sh                 # both
./backup/backup-monitoring.sh --only mariadb
./backup/backup-monitoring.sh --only prometheus
```

Uses `../kubeconfig` by default. Every setting is overridable via env vars
(see the CONFIG block at the top of the script).

## Restore / use the data

**MariaDB** into a local container:

```bash
docker run -d --name ctfd-restore -e MARIADB_ROOT_PASSWORD=root -p 3307:3306 mariadb:11
zcat data/<ts>/mariadb-all-databases.sql.gz | mysql -h127.0.0.1 -P3307 -uroot -proot
```

**Prometheus TSDB** into a local Prometheus:

```bash
mkdir -p /tmp/promdata && tar xzf data/<ts>/prometheus-tsdb.tar.gz -C /tmp/promdata
docker run -d --name prom-restore -p 9090:9090 \
  -v /tmp/promdata:/prometheus \
  prom/prometheus:v3.13.2 \
  --storage.tsdb.path=/prometheus --storage.tsdb.retention.time=100y \
  --config.file=/etc/prometheus/prometheus.yml --storage.tsdb.no-lockfile
```

Then query it (or point Grafana at `http://localhost:9090`) to build the graphs.

## Notes

- `data/` is git-ignored because the DB dump contains user emails/PII, and the TSDB
  archive is large (~hundreds of MB).
- Kubernetes cannot delete ephemeral containers; each run adds a short-lived
  `tsdb-backup-<ts>` container to the Prometheus pod that exits on its own and
  is cleared whenever the pod restarts.
