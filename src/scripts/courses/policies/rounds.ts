// Lesson 19's policy puzzle, as data.
//
// One shop namespace with a front end, a backend and a database, a monitoring
// namespace next to it, the cluster's DNS, and two places on the internet. Four
// things the team wants locked down, one after the other. Each round starts from
// a working answer to the one before, so the policies pile up the way they would.
//
// The reader edits NetworkPolicies by switching rule entries on and off and by
// isolating a pod's ingress or egress. The entries are the rules people really
// write, tempting ones included. A round is a list of connections that have to
// work or have to be blocked, never a list of entries to pick. engine.ts
// evaluates every connection the way the NetworkPolicy spec does, so any set of
// policies that gets the connections right clears.
//
// Each round is decided by one thing:
//
// 1. Isolation. A pod with no policy accepts anything, and the moment one policy
//    selects it, it accepts only what some rule allows.
// 2. One dash. `namespaceSelector` and `podSelector` in the same entry must both
//    match. Put a dash in front of the second and they're two entries, and
//    either one lets you in.
// 3. Egress with no rules. The database gets nothing out, and replies to
//    connections it accepted still go back.
// 4. DNS. Isolating the backend's egress breaks every name it looks up until
//    port 53 to kube-dns is allowed.

export type Labels = Record<string, string>;

export interface Endpoint {
  id: string;
  /** How the brief and the results refer to it. */
  name: string;
  ns?: string;
  labels?: Labels;
  /** Outside the cluster. */
  ip?: string;
}

export interface Peer {
  pods?: Labels;
  /** Namespace labels, or every namespace. */
  namespaces?: Labels | "all";
  cidr?: string;
}

export interface Port {
  port: number;
  protocol: "TCP" | "UDP";
}

export type Direction = "ingress" | "egress";

export interface Entry {
  id: string;
  policy: string;
  dir: Direction;
  /** Each peer is one item under `from` or `to`. */
  peers: Peer[];
  ports: Port[];
  /** The toggle's text. */
  label: string;
}

export interface PolicyDef {
  name: string;
  /** podSelector, in the shop namespace. */
  selects: Labels;
  /** Which of its directions the reader can isolate or not. */
  offer: Direction[];
}

export interface Check {
  from: string;
  to: string;
  port: number;
  protocol: "TCP" | "UDP";
  /** The app connects by this name, so it has to look it up first. */
  byName?: string;
  want: boolean;
}

export interface Setup {
  /** Entry ids switched on. */
  on: string[];
  /** "policy:direction" pairs isolated. */
  isolated: string[];
}

export interface Round {
  n: number;
  title: string;
  brief: string;
  policies: PolicyDef[];
  entries: Entry[];
  start: Setup;
  checks: Check[];
  note: string;
}

export const NS = "shop";

export const endpoints: Endpoint[] = [
  { id: "frontend", name: "frontend", ns: "shop", labels: { app: "frontend" } },
  { id: "backend", name: "backend", ns: "shop", labels: { app: "backend" } },
  { id: "database", name: "database", ns: "shop", labels: { app: "database" } },
  { id: "prometheus", name: "prometheus", ns: "monitoring", labels: { app: "prometheus" } },
  { id: "grafana", name: "grafana", ns: "monitoring", labels: { app: "grafana" } },
  { id: "coredns", name: "coredns", ns: "kube-system", labels: { "k8s-app": "kube-dns" } },
  { id: "payments", name: "the payment provider", ip: "198.51.100.24" },
  { id: "elsewhere", name: "some other server", ip: "203.0.113.80" },
];

export const nsLabels = (ns: string): Labels => ({ "kubernetes.io/metadata.name": ns });

const tcp = (port: number): Port[] => [{ port, protocol: "TCP" }];
const DNS: Port[] = [
  { port: 53, protocol: "UDP" },
  { port: 53, protocol: "TCP" },
];

const DATABASE: PolicyDef = { name: "database", selects: { app: "database" }, offer: ["ingress"] };

/* --- the entries, shared so a later round can start from an earlier answer -- */

const fromBackend: Entry = { id: "db-from-backend", policy: "database", dir: "ingress", peers: [{ pods: { app: "backend" } }], ports: tcp(5432), label: "from pods app=backend, on 5432" };
const fromBackendAny: Entry = { id: "db-from-backend-any", policy: "database", dir: "ingress", peers: [{ pods: { app: "backend" } }], ports: [], label: "from pods app=backend, any port" };
const fromAllNs: Entry = { id: "db-from-all-ns", policy: "database", dir: "ingress", peers: [{ namespaces: "all" }], ports: tcp(5432), label: "from every namespace, on 5432" };
const fromFrontend: Entry = { id: "db-from-frontend", policy: "database", dir: "ingress", peers: [{ pods: { app: "frontend" } }], ports: tcp(5432), label: "from pods app=frontend, on 5432" };

const fromMonitoring: Entry = { id: "db-from-monitoring", policy: "database", dir: "ingress", peers: [{ namespaces: nsLabels("monitoring") }], ports: tcp(9187), label: "from namespace monitoring, on 9187" };
const fromPromAnd: Entry = {
  id: "db-from-prom-and",
  policy: "database",
  dir: "ingress",
  peers: [{ namespaces: nsLabels("monitoring"), pods: { app: "prometheus" } }],
  ports: tcp(9187),
  label: "from namespace monitoring and pods app=prometheus, one entry, on 9187",
};
const fromPromOr: Entry = {
  id: "db-from-prom-or",
  policy: "database",
  dir: "ingress",
  peers: [{ namespaces: nsLabels("monitoring") }, { pods: { app: "prometheus" } }],
  ports: tcp(9187),
  label: "from namespace monitoring, and from pods app=prometheus, two entries, on 9187",
};

const dbToAnywhere: Entry = { id: "db-to-anywhere", policy: "database", dir: "egress", peers: [{ cidr: "0.0.0.0/0" }], ports: tcp(443), label: "to anywhere, on 443" };
const dbToBackend: Entry = { id: "db-to-backend", policy: "database", dir: "egress", peers: [{ pods: { app: "backend" } }], ports: [], label: "to pods app=backend, so its replies get out" };

const beToDatabase: Entry = { id: "be-to-database", policy: "backend", dir: "egress", peers: [{ pods: { app: "database" } }], ports: tcp(5432), label: "to pods app=database, on 5432" };
const beToAnywhere: Entry = { id: "be-to-anywhere", policy: "backend", dir: "egress", peers: [{ cidr: "0.0.0.0/0" }], ports: tcp(443), label: "to anywhere, on 443" };
const beToProvider: Entry = { id: "be-to-provider", policy: "backend", dir: "egress", peers: [{ cidr: "198.51.100.0/24" }], ports: tcp(443), label: "to 198.51.100.0/24, the provider's range, on 443" };
const beToDns: Entry = {
  id: "be-to-dns",
  policy: "backend",
  dir: "egress",
  peers: [{ namespaces: nsLabels("kube-system"), pods: { "k8s-app": "kube-dns" } }],
  ports: DNS,
  label: "to pods k8s-app=kube-dns in kube-system, on 53",
};
const beToKubeSystem: Entry = { id: "be-to-kube-system", policy: "backend", dir: "egress", peers: [{ namespaces: nsLabels("kube-system") }], ports: [], label: "to namespace kube-system, any port" };

const DB_EGRESS: PolicyDef = { name: "database", selects: { app: "database" }, offer: ["ingress", "egress"] };

export const rounds: Round[] = [
  {
    n: 1,
    title: "Lock the database",
    brief:
      "Right now any pod in the cluster can open a connection to the database. Only the backend should be able to, and the policy for it is empty so far.",
    policies: [DATABASE],
    entries: [fromBackend, fromBackendAny, fromAllNs, fromFrontend],
    start: { on: [], isolated: [] },
    checks: [
      { from: "backend", to: "database", port: 5432, protocol: "TCP", want: true },
      { from: "frontend", to: "database", port: 5432, protocol: "TCP", want: false },
      { from: "grafana", to: "database", port: 5432, protocol: "TCP", want: false },
      { from: "frontend", to: "backend", port: 8080, protocol: "TCP", want: true },
    ],
    note: "Every policy that selects a pod adds to what it accepts, and none of them can take anything away. There's no deny rule, only isolation plus allows.",
  },
  {
    n: 2,
    title: "Metrics",
    brief:
      "Since the lock went in, Prometheus can't scrape the database's metrics exporter on 9187. Prometheus should get back in. Grafana, which lives in the same namespace, shouldn't get anywhere near the database.",
    policies: [DATABASE],
    entries: [fromBackend, fromMonitoring, fromPromAnd, fromPromOr],
    start: { on: ["db-from-backend"], isolated: ["database:ingress"] },
    checks: [
      { from: "prometheus", to: "database", port: 9187, protocol: "TCP", want: true },
      { from: "grafana", to: "database", port: 9187, protocol: "TCP", want: false },
      { from: "grafana", to: "database", port: 5432, protocol: "TCP", want: false },
      { from: "backend", to: "database", port: 5432, protocol: "TCP", want: true },
      { from: "frontend", to: "database", port: 5432, protocol: "TCP", want: false },
    ],
    note: "The YAML for those two differs by a single dash. Two selectors in one entry both have to match, and a dash starts a new entry.",
  },
  {
    n: 3,
    title: "Nothing out of the database",
    brief:
      "The database has no reason to reach the internet, and if someone ever gets a shell in it, it shouldn't be able to send the data anywhere. Everything that connects to it today has to keep working.",
    policies: [DB_EGRESS],
    entries: [fromBackend, fromPromAnd, dbToAnywhere, dbToBackend],
    start: { on: ["db-from-backend", "db-from-prom-and"], isolated: ["database:ingress"] },
    checks: [
      { from: "database", to: "elsewhere", port: 443, protocol: "TCP", want: false },
      { from: "database", to: "payments", port: 443, protocol: "TCP", want: false },
      { from: "backend", to: "database", port: 5432, protocol: "TCP", want: true },
      { from: "prometheus", to: "database", port: 9187, protocol: "TCP", want: true },
      { from: "frontend", to: "database", port: 5432, protocol: "TCP", want: false },
    ],
    note: "Policies are about who opens a connection. Once one's allowed, the replies travel back on it whatever the other side's egress says.",
  },
  {
    n: 4,
    title: "The backend",
    brief:
      "Security wants the backend limited to what it actually uses: the database, and the payment provider at api.payments.example over HTTPS. Someone's started on it. The backend connects to both by name.",
    policies: [DB_EGRESS, { name: "backend", selects: { app: "backend" }, offer: ["egress"] }],
    entries: [fromBackend, fromPromAnd, beToDatabase, beToAnywhere, beToProvider, beToDns, beToKubeSystem],
    start: {
      on: ["db-from-backend", "db-from-prom-and", "be-to-database", "be-to-anywhere"],
      isolated: ["database:ingress", "database:egress", "backend:egress"],
    },
    checks: [
      { from: "backend", to: "database", port: 5432, protocol: "TCP", byName: "database", want: true },
      { from: "backend", to: "payments", port: 443, protocol: "TCP", byName: "api.payments.example", want: true },
      { from: "backend", to: "elsewhere", port: 443, protocol: "TCP", want: false },
      { from: "backend", to: "grafana", port: 3000, protocol: "TCP", want: false },
      { from: "frontend", to: "backend", port: 8080, protocol: "TCP", want: true },
      { from: "frontend", to: "database", port: 5432, protocol: "TCP", want: false },
    ],
    note: "Every pod that has its egress isolated needs DNS allowed explicitly, and it's the first thing to go. A broken lookup looks like a timeout in the app's logs, which is why it takes so long to spot.",
  },
];
