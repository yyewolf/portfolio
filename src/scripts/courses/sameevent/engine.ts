// The world behind lesson 13's side-by-side board.
//
// One cluster, three workloads that all ask for pods, and three controllers that
// each answer the same event differently. The reader does something to the
// cluster (deletes a pod, adds or removes a node, cuts one off, scales) and the
// board shows what each controller did about it. No rounds and no scoring: the
// point is the three columns disagreeing.
//
// The controllers are deliberately small and deliberately faithful:
//
// - The ReplicaSet behind `web` counts pods that aren't Terminating and closes
//   the gap. It never cares about names or nodes.
// - The DaemonSet `logs` puts one pod on every Ready node that doesn't have one.
//   It has no count, and it doesn't evict its own pods from a node that stopped
//   answering.
// - The StatefulSet `db` walks ordinals from 0, creating the first missing one
//   only when every lower one is Running, and scales down from the top. A pod
//   that still exists in any state blocks its own replacement, which is the
//   at-most-one rule that makes it wait on an unreachable node while the
//   Deployment next to it has already moved on.
//
// Disks are named after the pod (`data-db-1`) and are never deleted, so a
// returning name gets its old disk back.
//
// No controller reads what the reader just did. Each one reads the world, so
// the report is always an honest account of three loops looking at one state.

export type Owner = "web" | "logs" | "db";

export const OWNERS: Owner[] = ["web", "logs", "db"];

export interface Node {
  name: string;
  state: "Ready" | "Unreachable";
}

export interface Pod {
  name: string;
  owner: Owner;
  node: string;
  status: "Running" | "Terminating" | "Unknown";
  /** Creation order. Two pods can share a name over time, never a serial. */
  serial: number;
  ordinal?: number;
}

export interface World {
  nodes: Node[];
  /** Asked of both `web` and `db`. `logs` has nothing to ask. */
  replicas: number;
  pods: Pod[];
  volumes: string[];
  serial: number;
  nextNode: number;
  /** Every pod name that has ever existed, so a returning name can be spotted. */
  seen: string[];
}

export type Action =
  | { kind: "add" }
  | { kind: "scale"; by: 1 | -1 }
  | { kind: "remove"; node: string }
  | { kind: "cut"; node: string }
  | { kind: "back"; node: string }
  | { kind: "delete"; pod: string };

export interface Report {
  /** What happened to the cluster, before any controller looked. */
  happened: string;
  did: Record<Owner, string[]>;
  waiting: Partial<Record<Owner, string>>;
  /** Names of pods that didn't exist before the action. */
  created: string[];
  /** Pods that existed before the action and don't now. */
  gone: Pod[];
  /** Created pods whose name had been used before. */
  returned: string[];
  removedNode?: string;
}

export const RS = "web-7d4f9c";
export const MAX_NODES = 5;
export const MAX_REPLICAS = 5;

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

const suffix = (seed: string): string => {
  let h = fnv(seed);
  let out = "";
  for (let i = 0; i < 5; i += 1) {
    out += SAFE[h % SAFE.length];
    h = Math.floor(h / SAFE.length) + fnv(out);
  }
  return out;
};

const list = (items: string[]): string =>
  items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

const clone = (w: World): World => JSON.parse(JSON.stringify(w)) as World;

/* --- the controllers ------------------------------------------------------ */

type Step = { did: string } | { waiting: string } | null;

/** Least loaded Ready node for this owner, ties broken by node order. */
const place = (w: World, owner: Owner): string | null => {
  const ready = w.nodes.filter((n) => n.state === "Ready");
  let best: string | null = null;
  let bestLoad = Infinity;
  for (const n of ready) {
    const load = w.pods.filter((p) => p.owner === owner && p.node === n.name && p.status !== "Terminating").length;
    if (load < bestLoad) {
      best = n.name;
      bestLoad = load;
    }
  }
  return best;
};

const reconcileWeb = (w: World): Step => {
  const live = w.pods.filter((p) => p.owner === "web" && p.status !== "Terminating");
  if (live.length < w.replicas) {
    const node = place(w, "web");
    if (!node) return { waiting: "Waiting. There's no Ready node to put a pod on." };
    const pod: Pod = { name: `${RS}-${suffix(`web/${w.serial}`)}`, owner: "web", node, status: "Running", serial: w.serial };
    w.serial += 1;
    w.pods.push(pod);
    return { did: `created ${pod.name} on ${node}` };
  }
  if (live.length > w.replicas) {
    const victim = [...live].sort((a, b) => b.serial - a.serial)[0];
    if (!victim) return null;
    w.pods = w.pods.filter((p) => p.serial !== victim.serial);
    return { did: `deleted ${victim.name}` };
  }
  return null;
};

const reconcileLogs = (w: World): Step => {
  for (const n of w.nodes) {
    if (n.state !== "Ready") continue;
    if (w.pods.some((p) => p.owner === "logs" && p.node === n.name)) continue;
    const pod: Pod = { name: `logs-${suffix(`logs/${w.serial}`)}`, owner: "logs", node: n.name, status: "Running", serial: w.serial };
    w.serial += 1;
    w.pods.push(pod);
    return { did: `created ${pod.name} on ${n.name}` };
  }
  return null;
};

const reconcileDb = (w: World): Step => {
  for (let i = 0; i < w.replicas; i += 1) {
    const p = w.pods.find((x) => x.owner === "db" && x.ordinal === i);
    if (p && p.status === "Running") continue;
    if (p) {
      return {
        waiting: `Waiting. ${p.name} still exists on ${p.node} as far as it can tell, and it won't start a second ${p.name} until it's sure that one is gone.`,
      };
    }
    const node = place(w, "db");
    if (!node) return { waiting: "Waiting. There's no Ready node to put a pod on." };
    const name = `db-${i}`;
    const vol = `data-${name}`;
    const fresh = !w.volumes.includes(vol);
    if (fresh) w.volumes.push(vol);
    w.pods.push({ name, owner: "db", node, status: "Running", serial: w.serial, ordinal: i });
    w.serial += 1;
    return { did: `created ${name} on ${node}, ${fresh ? `with a new disk, ${vol}` : `and reattached ${vol}`}` };
  }
  const extra = w.pods
    .filter((p) => p.owner === "db" && (p.ordinal ?? 0) >= w.replicas)
    .sort((a, b) => (b.ordinal ?? 0) - (a.ordinal ?? 0))[0];
  if (extra) {
    if (extra.status !== "Running") {
      return { waiting: `Waiting. ${extra.name} is still Terminating on ${extra.node}.` };
    }
    w.pods = w.pods.filter((p) => p.serial !== extra.serial);
    return { did: `deleted ${extra.name}, and kept data-${extra.name}` };
  }
  return null;
};

const RECONCILE: Record<Owner, (w: World) => Step> = {
  web: reconcileWeb,
  logs: reconcileLogs,
  db: reconcileDb,
};

/** Every controller takes a look, in turn, until a whole pass changes nothing. */
export const settle = (
  w0: World,
): { world: World; did: Record<Owner, string[]>; waiting: Partial<Record<Owner, string>> } => {
  const w = clone(w0);
  const did: Record<Owner, string[]> = { web: [], logs: [], db: [] };
  const waiting: Partial<Record<Owner, string>> = {};
  for (let pass = 0; pass < 60; pass += 1) {
    let acted = false;
    for (const o of OWNERS) {
      const step = RECONCILE[o](w);
      if (step === null) {
        delete waiting[o];
      } else if ("did" in step) {
        did[o].push(step.did);
        delete waiting[o];
        acted = true;
      } else {
        waiting[o] = step.waiting;
      }
    }
    if (!acted) break;
  }
  w.seen = [...new Set([...w.seen, ...w.pods.map((p) => p.name)])];
  return { world: w, did, waiting };
};

export const start = (): World =>
  settle({
    nodes: ["node-a", "node-b", "node-c"].map((name) => ({ name, state: "Ready" })),
    replicas: 3,
    pods: [],
    volumes: [],
    serial: 0,
    nextNode: 3,
    seen: [],
  }).world;

/* --- what the reader can do ----------------------------------------------- */

export const can = (w: World, a: Action): boolean => {
  const ready = w.nodes.filter((n) => n.state === "Ready");
  switch (a.kind) {
    case "add":
      return w.nodes.length < MAX_NODES;
    case "scale": {
      const r = w.replicas + a.by;
      return r >= 1 && r <= MAX_REPLICAS;
    }
    case "remove": {
      const n = w.nodes.find((x) => x.name === a.node);
      return !!n && w.nodes.length > 2 && (n.state !== "Ready" || ready.length > 1);
    }
    case "cut": {
      const n = w.nodes.find((x) => x.name === a.node);
      return !!n && n.state === "Ready" && ready.length > 1 && !w.nodes.some((x) => x.state === "Unreachable");
    }
    case "back":
      return w.nodes.some((x) => x.name === a.node && x.state === "Unreachable");
    case "delete":
      return w.pods.some((p) => p.name === a.pod);
  }
};

/** Every action available right now. The replay walks these. */
export const options = (w: World): Action[] =>
  [
    { kind: "add" } as Action,
    { kind: "scale", by: 1 } as Action,
    { kind: "scale", by: -1 } as Action,
    ...w.nodes.flatMap((n): Action[] => [
      { kind: "remove", node: n.name },
      { kind: "cut", node: n.name },
      { kind: "back", node: n.name },
    ]),
    ...w.pods.map((p): Action => ({ kind: "delete", pod: p.name })),
  ].filter((a) => can(w, a));

const names = (pods: Pod[]): string => list(pods.map((p) => p.name));

export const act = (w0: World, a: Action): { world: World; report: Report } => {
  const w = clone(w0);
  let happened = "";
  let removedNode: string | undefined;

  if (a.kind === "add") {
    const name = `node-${String.fromCharCode(97 + w.nextNode)}`;
    w.nextNode += 1;
    w.nodes.push({ name, state: "Ready" });
    happened = `${name} joined the cluster.`;
  }

  if (a.kind === "scale") {
    w.replicas += a.by;
    happened = `You set replicas to ${w.replicas} on web and db. logs doesn't have a replicas field, so there was nothing to set.`;
  }

  if (a.kind === "remove") {
    const on = w.pods.filter((p) => p.node === a.node);
    w.pods = w.pods.filter((p) => p.node !== a.node);
    w.nodes = w.nodes.filter((n) => n.name !== a.node);
    removedNode = a.node;
    happened = `${a.node} was drained and removed from the cluster${on.length ? `, taking ${names(on)} with it` : ""}.`;
  }

  if (a.kind === "cut") {
    const node = w.nodes.find((n) => n.name === a.node);
    if (node) node.state = "Unreachable";
    const evicted: Pod[] = [];
    const unknown: Pod[] = [];
    for (const p of w.pods) {
      if (p.node !== a.node) continue;
      if (p.owner === "logs") {
        p.status = "Unknown";
        unknown.push(p);
      } else {
        p.status = "Terminating";
        evicted.push(p);
      }
    }
    happened = `${a.node} stopped answering.${
      evicted.length
        ? ` Five minutes later its pods were evicted, but there's nothing on the node to confirm it, so ${names(evicted)} ${
            evicted.length === 1 ? "is" : "are"
          } stuck Terminating.`
        : ""
    }${unknown.length ? ` ${names(unknown)} just shows Unknown, because DaemonSet pods aren't evicted for this.` : ""}`;
  }

  if (a.kind === "back") {
    const node = w.nodes.find((n) => n.name === a.node);
    if (node) node.state = "Ready";
    const stopped = w.pods.filter((p) => p.node === a.node && p.status === "Terminating");
    const carried = w.pods.filter((p) => p.node === a.node && p.status === "Unknown");
    w.pods = w.pods.filter((p) => !(p.node === a.node && p.status === "Terminating"));
    for (const p of carried) p.status = "Running";
    happened = `${a.node} is answering again.${stopped.length ? ` Its kubelet finished stopping ${names(stopped)}.` : ""}${
      carried.length ? ` ${names(carried)} carried on as if nothing had happened.` : ""
    }`;
  }

  if (a.kind === "delete") {
    const p = w.pods.find((x) => x.name === a.pod);
    if (p) {
      w.pods = w.pods.filter((x) => x.serial !== p.serial);
      if (p.status === "Running") {
        happened = `You deleted ${p.name}.`;
      } else if (p.owner === "db") {
        happened = `You force-deleted ${p.name} while ${p.node} still isn't answering. If ${p.node} is really still up and just cut off, the old ${p.name} is still running there, and there's about to be a second one.`;
      } else if (p.owner === "web") {
        happened = `You force-deleted ${p.name}. Its replacement was already running somewhere else.`;
      } else {
        happened = `You force-deleted ${p.name}. ${p.node} still isn't answering, so there's nowhere to put another one yet.`;
      }
    }
  }

  const s = settle(w);
  const beforeSerials = new Set(w0.pods.map((p) => p.serial));
  const afterSerials = new Set(s.world.pods.map((p) => p.serial));
  const created = s.world.pods.filter((p) => !beforeSerials.has(p.serial)).map((p) => p.name);

  return {
    world: s.world,
    report: {
      happened,
      did: s.did,
      waiting: s.waiting,
      created,
      gone: w0.pods.filter((p) => !afterSerials.has(p.serial)),
      returned: created.filter((n) => w0.seen.includes(n)),
      removedNode,
    },
  };
};

/** What a controller that did nothing would say about it. */
export const idle = (owner: Owner, w: World, a: Action | null): string => {
  if (owner === "logs" && a?.kind === "scale") return "Nothing. It has no count to change.";
  if (owner === "logs" && w.pods.some((p) => p.owner === "logs" && p.status === "Unknown")) {
    return "Nothing. It doesn't pull its pods off a node that stopped answering.";
  }
  if (owner === "logs") return "Nothing. Every Ready node already had one.";
  if (owner === "web") return "Nothing. The count was already right.";
  return "Nothing. Every number it asks for is Running.";
};
