// The world behind lesson 15's address board.
//
// Three nodes, each with its own slice of the pod network, and two Deployments:
// `shop`, whose config holds the address of an `api` pod, and `api` itself. The
// reader does things to the cluster and after every action `shop` sends its next
// request to whatever address its config still says. The board draws where that
// packet went.
//
// Three things are modelled faithfully and the lesson leans on all of them:
//
// - Addresses come from the node's range, handed out in order after the last one
//   used, the way the host-local allocator most plugins start from does it. So a
//   pod's address says which node it's on, and a replacement never gets the old
//   one back.
// - A container restart keeps the pod, so it keeps the address. Anything that
//   makes a new pod makes a new address, and that includes a rollout.
// - Nothing is rewritten on the way. The pod on the other end sees the sending
//   pod's own address, whichever node it came from.
//
// The trace never reads what the reader just did. It takes the world and an
// address and walks the route, so any sequence of actions gets an honest account.

export type App = "shop" | "api";

export interface Node {
  name: string;
  /** The machine's own address on the network the nodes share. */
  ip: string;
  /** First three octets of this node's /24, e.g. "10.244.2". */
  range: string;
  /** The host number the allocator tries next. */
  next: number;
}

export interface Pod {
  name: string;
  app: App;
  node: string;
  ip: string;
  serial: number;
  restarts: number;
  /** Requests this pod has answered. Only api pods answer. */
  served: number;
  /** api only: the image tag it was made from. */
  version?: string;
}

export interface World {
  nodes: Node[];
  pods: Pod[];
  replicas: number;
  version: string;
  /** The api address in shop's Deployment, as `API_URL=http://<this>:8080`. */
  config: string;
  serial: number;
  nextNode: number;
}

export type Action =
  | { kind: "delete"; pod: string }
  | { kind: "restart"; pod: string }
  | { kind: "scale"; by: 1 | -1 }
  | { kind: "release" }
  | { kind: "point"; pod: string }
  | { kind: "add" }
  | { kind: "remove"; node: string };

export interface Hop {
  where: string;
  text: string;
  tone: "ok" | "bad" | "plain";
}

export interface Trace {
  from: Pod;
  to: string;
  /** Where the packet got to, for drawing it: the node it reached, if any, and how it ended. */
  dst?: string;
  ending: "answered" | "refused" | "no-pod" | "no-route";
  hops: Hop[];
  /** What shop's log says about it, in the words a Go HTTP client uses. */
  log: string;
  ok: boolean;
  /** The pod that answered, if one did. */
  answeredBy?: string;
}

export interface Report {
  happened: string;
  trace: Trace;
  /** Pods that didn't exist before the action. */
  created: string[];
  /** Pods that existed before and don't now. */
  gone: Pod[];
}

export const MAX_NODES = 4;
export const MAX_REPLICAS = 3;
export const PORT = 8080;

const VERSIONS = ["2.9", "3.0", "3.1", "3.2", "3.3", "3.4", "3.5", "3.6", "3.7", "3.8", "3.9"];

/* --- names ---------------------------------------------------------------- */

const fnv = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

/** The alphabet Kubernetes uses for generated names. No vowels. */
const SAFE = "bcdfghjklmnpqrstvwxz2456789";

const chars = (seed: string, n: number): string => {
  let h = fnv(seed);
  let out = "";
  for (let i = 0; i < n; i += 1) {
    out += SAFE[h % SAFE.length];
    h = Math.floor(h / SAFE.length) + fnv(out + seed);
  }
  return out;
};

/** The ReplicaSet segment follows the template, so it moves when the template does. */
const setName = (w: World, app: App): string =>
  app === "api" ? `api-${chars(`api:${w.version}`, 6)}` : `shop-${chars(`shop:${w.config}`, 6)}`;

const clone = (w: World): World => JSON.parse(JSON.stringify(w)) as World;

const list = (items: string[]): string =>
  items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/* --- the allocator and the controllers ------------------------------------ */

/** Next unused host number after the last one handed out, wrapping at the end. */
const allocate = (w: World, node: Node): string => {
  const used = new Set(w.pods.map((p) => p.ip));
  for (let tries = 0; tries < 253; tries += 1) {
    const host = node.next;
    node.next = node.next >= 254 ? 2 : node.next + 1;
    const ip = `${node.range}.${host}`;
    if (!used.has(ip)) return ip;
  }
  throw new Error(`${node.name} has no addresses left`);
};

/** Fewest pods of any kind, ties broken by node order. */
const place = (w: World): Node => {
  let best = w.nodes[0];
  let load = Infinity;
  for (const n of w.nodes) {
    const l = w.pods.filter((p) => p.node === n.name).length;
    if (l < load) {
      best = n;
      load = l;
    }
  }
  if (!best) throw new Error("no nodes");
  return best;
};

const create = (w: World, app: App): Pod => {
  const node = place(w);
  const pod: Pod = {
    name: `${setName(w, app)}-${chars(`${app}/${w.serial}`, 5)}`,
    app,
    node: node.name,
    ip: allocate(w, node),
    serial: w.serial,
    restarts: 0,
    served: 0,
    version: app === "api" ? w.version : undefined,
  };
  w.serial += 1;
  w.pods.push(pod);
  return pod;
};

/** Both Deployments, settled: right count, right template. Surplus goes newest first. */
const settle = (w: World): void => {
  for (const app of ["shop", "api"] as App[]) {
    const want = app === "api" ? w.replicas : 1;
    const current = setName(w, app);
    // A template change: bring the new set up before taking the old one away, so
    // the new pods get their addresses while the old ones still hold theirs.
    const stale = w.pods.filter((p) => p.app === app && !p.name.startsWith(`${current}-`));
    let fresh = w.pods.filter((p) => p.app === app && p.name.startsWith(`${current}-`)).length;
    while (fresh < want) {
      create(w, app);
      fresh += 1;
    }
    w.pods = w.pods.filter((p) => !stale.includes(p));
    const mine = w.pods.filter((p) => p.app === app).sort((a, b) => b.serial - a.serial);
    const extra = new Set(mine.slice(0, Math.max(0, mine.length - want)).map((p) => p.serial));
    w.pods = w.pods.filter((p) => !extra.has(p.serial));
  }
};

export const start = (): World => {
  const w: World = {
    nodes: [
      { name: "node-a", ip: "192.168.0.11", range: "10.244.1", next: 23 },
      { name: "node-b", ip: "192.168.0.12", range: "10.244.2", next: 41 },
      { name: "node-c", ip: "192.168.0.13", range: "10.244.3", next: 17 },
    ],
    pods: [],
    replicas: 1,
    version: VERSIONS[0] ?? "2.9",
    // Where api's only pod lands on a fresh settle: shop takes node-a, api takes
    // node-b and the first address node-b hands out. The replay checks the
    // opening request really does reach it.
    config: "10.244.2.41",
    serial: 0,
    nextNode: 3,
  };
  settle(w);
  return w;
};

/* --- the route ------------------------------------------------------------ */

const nodeFor = (w: World, ip: string): Node | undefined =>
  w.nodes.find((n) => ip.startsWith(`${n.range}.`));

/** Walk one request from shop to the configured address. Changes `served` only. */
export const send = (w: World): Trace => {
  const from = w.pods.find((p) => p.app === "shop");
  if (!from) throw new Error("no shop pod");
  const src = w.nodes.find((n) => n.name === from.node);
  if (!src) throw new Error("shop is on a node that doesn't exist");
  const to = w.config;
  const hops: Hop[] = [
    { where: from.name, text: `Sends from ${from.ip} to ${to}:${PORT}.`, tone: "plain" },
  ];
  const dst = nodeFor(w, to);
  const dial = `dial tcp ${to}:${PORT}`;

  if (!dst) {
    hops.push({
      where: src.name,
      text: `No route for ${to}. Nothing in the cluster owns that range any more, so it goes out the default route to the network's gateway.`,
      tone: "bad",
    });
    hops.push({
      where: "gateway",
      text: `Has never heard of ${to} and drops it. Nobody sends anything back.`,
      tone: "bad",
    });
    return { from, to, ending: "no-route", hops, log: `${dial}: i/o timeout`, ok: false };
  }

  if (dst.name === src.name) {
    hops.push({
      where: src.name,
      text: `${dst.range}.0/24 is this node's own range, so it's handed straight to the local pod with that address.`,
      tone: "plain",
    });
  } else {
    hops.push({
      where: src.name,
      text: `Route table says ${dst.range}.0/24 is behind ${dst.name}, via ${dst.ip}.`,
      tone: "plain",
    });
    hops.push({
      where: "node network",
      text: `${src.ip} to ${dst.ip}. The packet inside still says ${from.ip} to ${to}, nothing's been rewritten.`,
      tone: "plain",
    });
  }

  const pod = w.pods.find((p) => p.ip === to);
  if (!pod) {
    hops.push({
      where: dst.name,
      text: `Nothing on this node has ${to} any more.`,
      tone: "bad",
    });
    return { from, to, dst: dst.name, ending: "no-pod", hops, log: `${dial}: connect: no route to host`, ok: false };
  }
  if (pod.app !== "api") {
    hops.push({
      where: pod.name,
      text: `Has ${to}, and nothing in it is listening on ${PORT}.`,
      tone: "bad",
    });
    return { from, to, dst: dst.name, ending: "refused", hops, log: `${dial}: connect: connection refused`, ok: false, answeredBy: pod.name };
  }
  pod.served += 1;
  hops.push({
    where: pod.name,
    text: `Answers 200 from version ${pod.version ?? "?"}, and sees the request coming from ${from.ip}.`,
    tone: "ok",
  });
  return { from, to, dst: dst.name, ending: "answered", hops, log: `GET http://${to}:${PORT}/orders 200`, ok: true, answeredBy: pod.name };
};

/* --- what the reader can do ----------------------------------------------- */

export const can = (w: World, a: Action): boolean => {
  switch (a.kind) {
    case "delete":
    case "restart":
      return w.pods.some((p) => p.name === a.pod);
    case "point":
      return w.pods.some((p) => p.name === a.pod && p.app === "api" && p.ip !== w.config);
    case "scale": {
      const r = w.replicas + a.by;
      return r >= 1 && r <= MAX_REPLICAS;
    }
    case "release":
      return VERSIONS.indexOf(w.version) < VERSIONS.length - 1;
    case "add":
      return w.nodes.length < MAX_NODES;
    case "remove":
      return w.nodes.length > 1 && w.nodes.some((n) => n.name === a.node);
  }
};

/** Every action available right now. The replay walks these. */
export const options = (w: World): Action[] =>
  [
    { kind: "scale", by: 1 } as Action,
    { kind: "scale", by: -1 } as Action,
    { kind: "release" } as Action,
    { kind: "add" } as Action,
    ...w.nodes.map((n): Action => ({ kind: "remove", node: n.name })),
    ...w.pods.flatMap((p): Action[] => [
      { kind: "delete", pod: p.name },
      { kind: "restart", pod: p.name },
      { kind: "point", pod: p.name },
    ]),
  ].filter((a) => can(w, a));

export const act = (w0: World, a: Action): { world: World; report: Report } => {
  const w = clone(w0);
  let happened = "";

  if (a.kind === "delete") {
    const p = w.pods.find((x) => x.name === a.pod);
    if (p) {
      w.pods = w.pods.filter((x) => x.serial !== p.serial);
      happened = `You deleted ${p.name}, which had ${p.ip}.`;
    }
  }

  if (a.kind === "restart") {
    const p = w.pods.find((x) => x.name === a.pod);
    if (p) {
      p.restarts += 1;
      happened = `The container in ${p.name} crashed and the kubelet restarted it. Same pod, so it's still ${p.ip}.`;
    }
  }

  if (a.kind === "scale") {
    w.replicas += a.by;
    happened = `You set api to ${w.replicas} ${w.replicas === 1 ? "replica" : "replicas"}.`;
  }

  if (a.kind === "release") {
    const old = w.version;
    w.version = VERSIONS[VERSIONS.indexOf(old) + 1] ?? old;
    happened = `You shipped api ${w.version}. That's a template change, so every api pod was replaced.`;
  }

  if (a.kind === "point") {
    const p = w.pods.find((x) => x.name === a.pod);
    if (p) {
      w.config = p.ip;
      happened = `You set API_URL to ${p.ip} in shop's Deployment. That's inside the template too, so shop's pod was replaced to pick it up.`;
    }
  }

  if (a.kind === "add") {
    const name = `node-${String.fromCharCode(97 + w.nextNode)}`;
    const n = w.nextNode + 1;
    w.nextNode += 1;
    w.nodes.push({ name, ip: `192.168.0.${10 + n}`, range: `10.244.${n}`, next: 2 });
    happened = `${name} joined with ${`10.244.${n}.0/24`} as its range. Nothing moves onto it on its own, pods only land there when something new is made.`;
  }

  if (a.kind === "remove") {
    const on = w.pods.filter((p) => p.node === a.node);
    const node = w.nodes.find((n) => n.name === a.node);
    w.pods = w.pods.filter((p) => p.node !== a.node);
    w.nodes = w.nodes.filter((n) => n.name !== a.node);
    happened = `${a.node} was drained and removed, and ${node ? `${node.range}.0/24` : "its range"} went with it${
      on.length ? `. ${list(on.map((p) => p.name))} ${on.length === 1 ? "was" : "were"} evicted` : ""
    }.`;
  }

  settle(w);

  const before = new Set(w0.pods.map((p) => p.serial));
  const after = new Set(w.pods.map((p) => p.serial));
  const trace = send(w);

  return {
    world: w,
    report: {
      happened,
      trace,
      created: w.pods.filter((p) => !before.has(p.serial)).map((p) => p.name),
      gone: w0.pods.filter((p) => !after.has(p.serial)),
    },
  };
};

/** The request shop sends before the reader has done anything. */
export const opening = (w0: World): { world: World; trace: Trace } => {
  const w = clone(w0);
  return { world: w, trace: send(w) };
};
