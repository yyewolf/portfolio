#!/usr/bin/env python3
"""
extract-showcase-data.py

Turns a restored CTF backup into the static JSON that the /ctf showcase page reads.

Prereqs (see backup/README.md "Restore / use the data"):
  * MariaDB dump restored into a local container listening on 127.0.0.1:$DB_PORT
      docker run -d --name ctf-analysis -e MARIADB_ROOT_PASSWORD=root -p 13307:3306 mariadb:11
      zcat backup/data/<ts>/mariadb-all-databases.sql.gz | docker exec -i ctf-analysis mariadb -uroot -proot
  * Prometheus TSDB restored into a local container on 127.0.0.1:$PROM_PORT
      (see README; run as your own uid so /prometheus is writable)

Then:  ./backup/extract-showcase-data.py
Output: src/data/ctf/*.json

All queries hit the LOCAL restored copies, never the live cluster.
"""
import json, os, subprocess, urllib.parse, urllib.request, re, sys
from datetime import datetime, timezone

# --- config ---------------------------------------------------------------
DB_CONTAINER = os.environ.get("DB_CONTAINER", "ctf-analysis")
PROM = os.environ.get("PROM_URL", "http://localhost:19090")
CTF_NS = os.environ.get("CTF_NS", "u-ctf-ctf-7001b39a")
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "data", "ctf")

# CTF schedule (unix seconds) -- read from config table below, these are fallbacks
CTF_START = 1785567600  # 2026-08-01 07:00 UTC
CTF_END   = 1785682800  # 2026-08-02 15:00 UTC

os.makedirs(OUT, exist_ok=True)


# --- helpers --------------------------------------------------------------
def db(query):
    """Run SQL against the restored MariaDB, return list of rows (list[str])."""
    out = subprocess.run(
        ["docker", "exec", "-i", DB_CONTAINER,
         "mariadb", "-uroot", "-proot", "ctfd", "-B", "-N", "-e", query],
        capture_output=True, text=True, check=True,
    ).stdout
    return [line.split("\t") for line in out.splitlines()]


def db1(query):
    r = db(query)
    return r[0] if r else []


def promq(query, time=None):
    p = {"query": query}
    if time is not None:
        p["time"] = time
    url = f"{PROM}/api/v1/query?" + urllib.parse.urlencode(p)
    with urllib.request.urlopen(url) as r:
        return json.load(r)["data"]["result"]


def prom_range(query, start, end, step):
    p = {"query": query, "start": start, "end": end, "step": step}
    url = f"{PROM}/api/v1/query_range?" + urllib.parse.urlencode(p)
    with urllib.request.urlopen(url) as r:
        return json.load(r)["data"]["result"]


def series1(query, start, end, step):
    """Range query expected to yield a single series -> [[ts,val],...] as floats."""
    r = prom_range(query, start, end, step)
    if not r:
        return []
    return [[int(float(t)), float(v)] for t, v in r[0]["values"]]


def write(name, obj):
    path = os.path.join(OUT, name)
    with open(path, "w") as f:
        json.dump(obj, f, separators=(",", ":"))
    print(f"  wrote {name:24s} {os.path.getsize(path)/1024:8.1f} KiB")


# --- read schedule from config -------------------------------------------
cfg = dict(db("SELECT `key`,`value` FROM config WHERE `key` IN ('start','end','ctf_name')"))
if cfg.get("start"):
    CTF_START = int(cfg["start"])
if cfg.get("end"):
    CTF_END = int(cfg["end"])
CTF_NAME = cfg.get("ctf_name", "CTF")
print(f"CTF: {CTF_NAME}  {datetime.fromtimestamp(CTF_START, timezone.utc)} -> "
      f"{datetime.fromtimestamp(CTF_END, timezone.utc)}")


# =========================================================================
# 1) SUMMARY  (headline numbers)
# =========================================================================
print("summary.json")
scale = {k: int(v) for k, v in db(
    "SELECT 'users',COUNT(*) FROM users UNION ALL "
    "SELECT 'teams',COUNT(*) FROM teams UNION ALL "
    "SELECT 'challenges',COUNT(*) FROM challenges UNION ALL "
    "SELECT 'categories',COUNT(DISTINCT category) FROM challenges UNION ALL "
    "SELECT 'solves',COUNT(*) FROM solves UNION ALL "
    "SELECT 'submissions',COUNT(*) FROM submissions")}

by_type = {k: int(v) for k, v in db("SELECT type,COUNT(*) FROM submissions GROUP BY type")}
correct = by_type.get("correct", 0)
total_sub = sum(by_type.values())

teams_scored = int(db1("SELECT COUNT(DISTINCT team_id) FROM solves")[0])
users_sub = int(db1("SELECT COUNT(DISTINCT user_id) FROM submissions")[0])
unsolved = int(db1(
    "SELECT COUNT(*) FROM challenges c WHERE NOT EXISTS "
    "(SELECT 1 FROM solves s WHERE s.challenge_id=c.id)")[0])

# first blood overall
fb = db1(
    "SELECT c.name,t.name,sub.date,"
    "TIMESTAMPDIFF(SECOND,FROM_UNIXTIME(%d),sub.date) "
    "FROM solves s JOIN submissions sub ON sub.id=s.id "
    "JOIN challenges c ON c.id=s.challenge_id JOIN teams t ON t.id=s.team_id "
    "ORDER BY sub.date ASC LIMIT 1" % CTF_START)

# winner + runner-up gap (score = sum of current challenge value)
top2 = db(
    "SELECT t.name,SUM(c.value) score FROM teams t "
    "JOIN solves s ON s.team_id=t.id JOIN challenges c ON c.id=s.challenge_id "
    "GROUP BY t.id ORDER BY score DESC LIMIT 2")

busiest = db1(
    "SELECT DATE_FORMAT(date,'%H:%i'),COUNT(*) n FROM submissions "
    "WHERE type='correct' GROUP BY DATE_FORMAT(date,'%Y-%m-%d %H:%i') "
    "ORDER BY n DESC LIMIT 1")

# infra numbers from prometheus
def prom_peak(q):
    vs = series1(q, CTF_START - 7200, CTF_END, 300)
    return max((v for _, v in vs), default=0)

instance_pods_total = 0
combos = teams_with_instances = 0
nodes = int(float(promq("count(node_uname_info)", CTF_START + 3600)[0]["value"][1]))
mem_total_gib = round(float(promq(
    "sum(node_memory_MemTotal_bytes)/1024/1024/1024", CTF_START + 3600)[0]["value"][1]))

# distinct instance pods over the whole window (via /series)
url = (f"{PROM}/api/v1/series?" + urllib.parse.urlencode(
    {"match[]": f'kube_pod_info{{namespace="{CTF_NS}",pod=~"ch-team.*"}}',
     "start": CTF_START - 7200, "end": CTF_END}))
with urllib.request.urlopen(url) as r:
    ser = json.load(r)["data"]
pods = set(s.get("pod", "") for s in ser)
instance_pods_total = len(pods)
cs, ts = set(), set()
for p in pods:
    m = re.match(r"ch-team-(\d+)(?:-user-\d+)?-challenge-(\d+)", p)
    if m:
        cs.add((m.group(1), m.group(2)))
        ts.add(m.group(1))
combos, teams_with_instances = len(cs), len(ts)

summary = {
    "name": CTF_NAME,
    "start": CTF_START, "end": CTF_END,
    "durationHours": round((CTF_END - CTF_START) / 3600),
    "usersReg": scale["users"], "teamsReg": scale["teams"],
    "teamsScored": teams_scored, "usersSubmitted": users_sub,
    "challenges": scale["challenges"], "categories": scale["categories"],
    "unsolved": unsolved,
    "submissions": total_sub, "correct": correct,
    "accuracyPct": round(100 * correct / total_sub, 1) if total_sub else 0,
    "wrong": by_type.get("incorrect", 0),
    "rateLimited": by_type.get("ratelimited", 0),
    "firstBlood": {"challenge": fb[0], "team": fb[1], "seconds": int(fb[3])} if fb else None,
    "winner": {"team": top2[0][0], "score": int(top2[0][1])} if top2 else None,
    "winnerGap": int(top2[0][1]) - int(top2[1][1]) if len(top2) > 1 else None,
    "busiestMinute": {"time": busiest[0], "solves": int(busiest[1])} if busiest else None,
    "infra": {
        "nodes": nodes, "memTotalGiB": mem_total_gib,
        "instancePodsTotal": instance_pods_total,
        "teamChallengeInstances": combos,
        "teamsWithInstances": teams_with_instances,
        "peakConcurrentInstances": int(prom_peak(
            f'count(kube_pod_info{{namespace="{CTF_NS}",pod=~"ch-team.*"}})')),
        "peakCpuCores": round(prom_peak(
            'sum(rate(node_cpu_seconds_total{mode!="idle"}[5m]))'), 1),
        "peakMemGiB": round(prom_peak(
            'sum(node_memory_MemTotal_bytes-node_memory_MemAvailable_bytes)/1024/1024/1024'), 1),
        "peakTargets": int(prom_peak("count(up)")),
    },
}
write("summary.json", summary)


# =========================================================================
# 2) CHALLENGES + CATEGORIES + FIRST BLOODS
# =========================================================================
print("challenges.json / categories.json / firstbloods.json")
chals = db(
    "SELECT c.id,c.name,c.category,c.value,COUNT(s.id) solves "
    "FROM challenges c LEFT JOIN solves s ON s.challenge_id=c.id "
    "GROUP BY c.id ORDER BY c.value DESC")
challenges = [{"id": int(i), "name": n, "category": cat, "value": int(v), "solves": int(sv)}
              for i, n, cat, v, sv in chals]
write("challenges.json", challenges)

cats = db(
    "SELECT c.category,COUNT(DISTINCT c.id),COUNT(s.id) "
    "FROM challenges c LEFT JOIN solves s ON s.challenge_id=c.id "
    "GROUP BY c.category ORDER BY COUNT(s.id) DESC")
categories = [{"name": n, "challenges": int(ch), "solves": int(sv)} for n, ch, sv in cats]
write("categories.json", categories)

fbs = db(
    "SELECT c.name,c.category,t.name,"
    "TIMESTAMPDIFF(SECOND,FROM_UNIXTIME(%d),sub.date),UNIX_TIMESTAMP(sub.date) "
    "FROM solves s JOIN submissions sub ON sub.id=s.id "
    "JOIN challenges c ON c.id=s.challenge_id JOIN teams t ON t.id=s.team_id "
    "WHERE sub.id IN (SELECT MIN(s2.id) FROM solves s2 GROUP BY s2.challenge_id) "
    "ORDER BY sub.date ASC" % CTF_START)
firstbloods = [{"challenge": n, "category": cat, "team": tm,
                "secondsAfterStart": int(sec), "t": int(float(ts_))}
               for n, cat, tm, sec, ts_ in fbs]
write("firstbloods.json", firstbloods)


# =========================================================================
# 3) FINAL STANDINGS + SOLVES TIMELINE  (charts)
# =========================================================================
print("teams.json / timeline.json")
teams = db(
    "SELECT t.name,COUNT(s.id),SUM(c.value) FROM teams t "
    "JOIN solves s ON s.team_id=t.id JOIN challenges c ON c.id=s.challenge_id "
    "GROUP BY t.id ORDER BY SUM(c.value) DESC")
standings = [{"team": n, "solves": int(sv), "score": int(sc)} for n, sv, sc in teams]
write("teams.json", standings)

# solves per 15-min bucket
buckets = db(
    "SELECT FLOOR(UNIX_TIMESTAMP(date)/900)*900 b,COUNT(*) "
    "FROM submissions WHERE type='correct' GROUP BY b ORDER BY b")
solves_timeline = [[int(b), int(n)] for b, n in buckets]
# submissions (all) per 15-min for accuracy-over-time
sub_buckets = db(
    "SELECT FLOOR(UNIX_TIMESTAMP(date)/900)*900 b,"
    "SUM(type='correct'),SUM(type='incorrect') "
    "FROM submissions GROUP BY b ORDER BY b")
submissions_timeline = [[int(b), int(ok), int(bad)] for b, ok, bad in sub_buckets]

write("timeline.json", {
    "solves": solves_timeline,
    "submissions": submissions_timeline,
})


# =========================================================================
# 4) INFRA TIMELINE  (prometheus)
# =========================================================================
print("infra.json")
S, E, STEP = CTF_START - 3600, CTF_END, 120


def merge(*seriesdicts):
    """Merge several {ts:val} dicts on a shared time axis."""
    axis = sorted(set().union(*[set(d) for d in seriesdicts]))
    return axis, [[d.get(t) for d in seriesdicts] for t in axis]


def sdict(q):
    return {t: round(v, 2) for t, v in series1(q, S, E, STEP)}


d_inst = sdict(f'count(kube_pod_info{{namespace="{CTF_NS}",pod=~"ch-team.*"}})')
d_pods = sdict(f'count(kube_pod_info{{namespace="{CTF_NS}"}})')
d_cpu  = sdict('sum(rate(node_cpu_seconds_total{mode!="idle"}[5m]))')
d_mem  = sdict('sum(node_memory_MemTotal_bytes-node_memory_MemAvailable_bytes)/1024/1024/1024')
d_tgt  = sdict('count(up)')
axis, rows = merge(d_inst, d_pods, d_cpu, d_mem, d_tgt)
infra = {
    "t": axis,
    "keys": ["instances", "nsPods", "cpuCores", "memGiB", "targets"],
    "rows": rows,
}
write("infra.json", infra)


# =========================================================================
# 4b) NETWORK THROUGHPUT  (prometheus) -> traffic-flow animation
# =========================================================================
print("network.json")
NDEV = 'device!~"lo|cali.*|lxc.*|veth.*|docker.*|flannel.*|cni.*|tunl.*"'
NS0, NE, NST = CTF_START - 1800, CTF_END, 180
rx_s = series1(f"sum(rate(node_network_receive_bytes_total{{{NDEV}}}[5m]))/1048576", NS0, NE, NST)
tx_s = series1(f"sum(rate(node_network_transmit_bytes_total{{{NDEV}}}[5m]))/1048576", NS0, NE, NST)
rxd = {t: v for t, v in rx_s}
txd = {t: v for t, v in tx_s}
naxis = sorted(set(rxd) | set(txd))
narr, rxa, txa = [], [], []
for t in naxis:
    narr.append(t); rxa.append(round(rxd.get(t, 0), 3)); txa.append(round(txd.get(t, 0), 3))


def _total_gb(metric):
    r = promq(f"sum(increase({metric}{{{NDEV}}}[33h]))/1073741824", CTF_END)
    return round(float(r[0]["value"][1]), 1) if r else 0


write("network.json", {
    "start": CTF_START, "end": CTF_END, "nodes": nodes,
    "t": narr, "rx": rxa, "tx": txa,
    "peakRx": round(max(rxa) if rxa else 0, 1),
    "peakTx": round(max(txa) if txa else 0, 1),
    "totalRxGB": _total_gb("node_network_receive_bytes_total"),
    "totalTxGB": _total_gb("node_network_transmit_bytes_total"),
})


# =========================================================================
# 5) LEADERBOARD RACE  (solve event stream)
# =========================================================================
print("race.json")
events = db(
    "SELECT UNIX_TIMESTAMP(sub.date),t.name,c.value "
    "FROM solves s JOIN submissions sub ON sub.id=s.id "
    "JOIN challenges c ON c.id=s.challenge_id JOIN teams t ON t.id=s.team_id "
    "ORDER BY sub.date ASC")
# team index to keep the file small
team_names = []
team_idx = {}
ev = []
for ts_, name, val in events:
    if name not in team_idx:
        team_idx[name] = len(team_names)
        team_names.append(name)
    ev.append([int(float(ts_)), team_idx[name], int(val)])
write("race.json", {
    "start": CTF_START, "end": CTF_END,
    "teams": team_names,
    "events": ev,  # [t, teamIdx, points]
})


# =========================================================================
# 6) INSTANCE LIFECYCLE  (prometheus, for the living-infra grid)
# =========================================================================
print("instances.json  (this one takes a moment)")
# query kube_pod_info in time chunks and record first/last-seen per pod+node
nodes_list = []
node_idx = {}
pod_life = {}  # pod -> {node, chal, first, last}
CH, STEP2 = 6 * 3600, 60
t = S
while t < E:
    chunk_end = min(t + CH, E)
    r = prom_range(
        f'kube_pod_info{{namespace="{CTF_NS}",pod=~"ch-team.*|ctfd.*"}}', t, chunk_end, STEP2)
    for s in r:
        pod = s["metric"].get("pod", "")
        node = s["metric"].get("node", "?")
        # challenge instances come in per-user and per-team naming schemes
        m = re.match(r"ch-team-(\d+)(?:-user-\d+)?-challenge-(\d+)", pod)
        if m:
            team = int(m.group(1)); chal = int(m.group(2))
        elif pod.startswith("ctfd"):
            # CTFd platform pods -> negative "challenge" ids the UI renders as one group
            team = 0
            if "mariadb" in pod:      chal = -2
            elif "redis" in pod:      chal = -3
            elif "controller" in pod: chal = -4
            else:                     chal = -1  # web replicas
        else:
            team = 0; chal = 0
        tsv = [int(float(x[0])) for x in s["values"]]
        if not tsv:
            continue
        if node not in node_idx:
            node_idx[node] = len(nodes_list)
            nodes_list.append(node)
        rec = pod_life.get(pod)
        if rec is None:
            pod_life[pod] = {"node": node_idx[node], "chal": chal, "team": team,
                             "first": tsv[0], "last": tsv[-1]}
        else:
            rec["first"] = min(rec["first"], tsv[0])
            rec["last"] = max(rec["last"], tsv[-1])
    t = chunk_end

# compact: [nodeIdx, chalId, teamId, startOffsetSec, durationSec]
insts = []
for rec in pod_life.values():
    insts.append([rec["node"], rec["chal"], rec["team"],
                  rec["first"] - CTF_START,
                  max(STEP2, rec["last"] - rec["first"])])
insts.sort(key=lambda x: x[3])
write("instances.json", {
    "start": CTF_START, "end": CTF_END,
    "nodes": len(nodes_list),
    "nodeNames": nodes_list,
    "instances": insts,  # [nodeIdx, chalId, startOffset, duration]
})

print("done.")
