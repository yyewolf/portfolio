// Lesson 18's route table, as data.
//
// One Gateway, one hostname, and four things the team needs from it. The reader
// edits an HTTPRoute (or, in the last round, the Gateway's listener), sends the
// round's requests, and reads where each one landed and what came back.
//
// A request says which backend it has to reach, or a round says what share one
// backend should get. Neither says which rule gets there. engine.ts does the
// matching the way the Gateway API specifies it, so any route that sends every
// request to the right place clears.
//
// Each round is decided by one thing:
//
// 1. Path matching. `Exact /api/orders` misses `/api/orders/41`, and a prefix
//    matches whole path segments, so `/api` doesn't catch `/apidocs`.
// 2. The path the backend sees. search only knows its own root, so it needs the
//    `/search` taken off with a rewrite.
// 3. Weights. Both backends default to a weight of 1, which is half the traffic
//    to the canary.
// 4. Who's allowed to attach. Opening the listener to every namespace lets an
//    old demo route in sandbox win `/`, because the older route wins a tie.

export type Match = "PathPrefix" | "Exact";

export interface BackendRef {
  name: string;
  weight: number;
}

export interface Rule {
  match: Match;
  path: string;
  rewrite: boolean;
  backends: BackendRef[];
}

export interface Route {
  ns: string;
  name: string;
  /** When it was created. Decides ties between routes. */
  created: string;
  rules: Rule[];
}

export type Allowed = "Same" | "All" | "Selector";

export interface Namespace {
  name: string;
  labels: Record<string, string>;
}

export interface Request {
  path: string;
  /** The backend this request has to reach. */
  want: string;
}

export interface Round {
  n: number;
  title: string;
  brief: string;
  host: string;
  /** The route the reader edits, as first written. */
  route: Route;
  /** Routes the reader can't edit. */
  others: Route[];
  namespaces: Namespace[];
  allowed: Allowed;
  edit: {
    /** Add and remove rules, and change their match, path and backend. */
    rules?: boolean;
    rewrite?: boolean;
    weights?: boolean;
    allowed?: boolean;
  };
  paths: string[];
  backends: string[];
  weights: number[];
  requests: Request[];
  /** Instead of per-request checks: a backend's share of `sample` requests. */
  share?: { backend: string; min: number; max: number; sample: number };
  note: string;
}

const NAMESPACES: Namespace[] = [
  { name: "infra", labels: { "kubernetes.io/metadata.name": "infra" } },
  { name: "shop", labels: { "kubernetes.io/metadata.name": "shop", "gateway-access": "public" } },
  { name: "sandbox", labels: { "kubernetes.io/metadata.name": "sandbox" } },
];

const shopRoute = (rules: Rule[]): Route => ({ ns: "shop", name: "shop", created: "2026-06-02", rules });

export const rounds: Round[] = [
  {
    n: 1,
    title: "The api under /api",
    brief:
      "shop.example.com goes to the front end. The api has to live on the same hostname, under /api. The front end also has a page called /apidocs that has to keep working.",
    host: "shop.example.com",
    route: shopRoute([{ match: "PathPrefix", path: "/", rewrite: false, backends: [{ name: "web", weight: 1 }] }]),
    others: [],
    namespaces: NAMESPACES,
    allowed: "Selector",
    edit: { rules: true },
    paths: ["/", "/api", "/api/orders"],
    backends: ["web", "api"],
    weights: [1],
    requests: [
      { path: "/", want: "web" },
      { path: "/cart", want: "web" },
      { path: "/apidocs", want: "web" },
      { path: "/api/orders", want: "api" },
      { path: "/api/orders/41", want: "api" },
    ],
    note: "A prefix matches whole path segments, so `/api` covers `/api` and everything under `/api/`, and nothing else. When more than one rule matches, an exact match wins, then the longest prefix, wherever the rule sits in the list.",
  },
  {
    n: 2,
    title: "Search",
    brief:
      "The search team's service answers at its own root: / for results and /suggest for autocomplete. It has to show up under /search on the shop's hostname, and their rule is already in.",
    host: "shop.example.com",
    route: shopRoute([
      { match: "PathPrefix", path: "/", rewrite: false, backends: [{ name: "web", weight: 1 }] },
      { match: "PathPrefix", path: "/search", rewrite: false, backends: [{ name: "search", weight: 1 }] },
    ]),
    others: [],
    namespaces: NAMESPACES,
    allowed: "Selector",
    edit: { rewrite: true },
    paths: ["/", "/search"],
    backends: ["web", "search"],
    weights: [1],
    requests: [
      { path: "/", want: "web" },
      { path: "/search?q=boots", want: "search" },
      { path: "/search/suggest?q=bo", want: "search" },
    ],
    note: "A rewrite is a filter on the rule, and it changes the path the backend sees without changing what the browser asked for. `ReplacePrefixMatch` swaps out exactly the part the rule matched on.",
  },
  {
    n: 3,
    title: "The canary",
    brief:
      "api 3.2 is deployed as its own Service, api-canary, and it's been added to the /api rule next to api. The team wants roughly one request in ten on it for the next hour.",
    host: "shop.example.com",
    route: shopRoute([
      { match: "PathPrefix", path: "/", rewrite: false, backends: [{ name: "web", weight: 1 }] },
      {
        match: "PathPrefix",
        path: "/api",
        rewrite: false,
        backends: [
          { name: "api", weight: 1 },
          { name: "api-canary", weight: 1 },
        ],
      },
    ]),
    others: [],
    namespaces: NAMESPACES,
    allowed: "Selector",
    edit: { weights: true },
    paths: ["/", "/api"],
    backends: ["web", "api", "api-canary"],
    weights: [0, 1, 9],
    requests: [],
    share: { backend: "api-canary", min: 5, max: 15, sample: 100 },
    note: "Weights are relative, so 9 and 1 is a tenth and so is 90 and 10. And unlike the Service canary, the split doesn't depend on how many pods each side has.",
  },
  {
    n: 4,
    title: "Letting the shop in",
    brief:
      "The platform team rebuilt the Gateway in the infra namespace this morning, and since then nothing reaches the shop, whose route lives in the shop namespace. Namespaces that should be public are labelled gateway-access=public, and there's an old demo in sandbox nobody's cleaned up.",
    host: "shop.example.com",
    route: shopRoute([
      { match: "PathPrefix", path: "/", rewrite: false, backends: [{ name: "web", weight: 1 }] },
      { match: "PathPrefix", path: "/api", rewrite: false, backends: [{ name: "api", weight: 1 }] },
    ]),
    others: [
      {
        ns: "sandbox",
        name: "demo",
        created: "2026-03-11",
        rules: [{ match: "PathPrefix", path: "/", rewrite: false, backends: [{ name: "demo", weight: 1 }] }],
      },
    ],
    namespaces: NAMESPACES,
    allowed: "Same",
    edit: { allowed: true },
    paths: ["/", "/api"],
    backends: ["web", "api"],
    weights: [1],
    requests: [
      { path: "/", want: "web" },
      { path: "/cart", want: "web" },
      { path: "/api/orders", want: "api" },
    ],
    note: "Attaching takes both sides. The route asks for the Gateway in `parentRefs`, and the listener decides which namespaces it'll take routes from. That's what lets the platform team own the Gateway while every app team writes its own routes.",
  },
];
