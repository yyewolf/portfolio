// The world model behind lesson 1. It knows nothing about the DOM and nothing
// about Kubernetes: it holds a specification, a set of machines, a set of
// servers, and the rules for the five things a player can do to them.
//
// Every mutation goes through `apply` and `settle`. Timing is the runner's
// business, so the same sequence of moves always produces the same world.

export type Status = "running" | "starting" | "failed" | "unavailable" | "pending";

export type ActionKind = "create" | "delete" | "restart" | "observe" | "wait";

export interface Machine {
  id: string;
  status: "ready" | "failed";
  capacity: number;
}

export interface Server {
  id: string;
  machine: string;
  status: Status;
  /** Seconds the server has been up, shown when the player inspects it. */
  uptime: number;
  cpu: number;
  /** Whether a restart brings this one back. Some failures are not repairable. */
  restartRecovers: boolean;
}

export interface Spec {
  label: string;
  replicas: number;
}

export interface Entry {
  at: string;
  text: string;
  kind: "world" | "you" | "system";
}

export interface World {
  desired: Spec;
  machines: Machine[];
  servers: Server[];
  /** Things that happened to the system. Newest first, because it is a feed. */
  feed: Entry[];
  /** Everything, including the player's own moves. Oldest first. */
  log: Entry[];
  selected: string | null;
  clock: number;
  seq: number;
  flags: Record<string, number>;
  moves: number;
  /** Who the history credits for a move. The finale hands the world over. */
  actor: string;
}

export interface Move {
  kind: ActionKind;
  machine?: string;
  target?: string;
}

export interface MoveResult {
  /** False when nothing happened, so the runner can skip the diff card. */
  ok: boolean;
  message: string;
}

const DAY_START = 14 * 3600 + 32 * 60;

const pad = (n: number): string => String(n).padStart(2, "0");

export function stamp(clock: number): string {
  const t = DAY_START + clock;
  return `${pad(Math.floor(t / 3600) % 24)}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}`;
}

export function running(w: World): number {
  return w.servers.filter((s) => s.status === "running").length;
}

/** Positive means too many, negative means too few, zero means converged. */
export function gap(w: World): number {
  return running(w) - w.desired.replicas;
}

export function converged(w: World): boolean {
  return gap(w) === 0;
}

export function machineOf(w: World, id: string): Machine | undefined {
  return w.machines.find((m) => m.id === id);
}

export function serverOf(w: World, id: string | null): Server | undefined {
  if (!id) return undefined;
  return w.servers.find((s) => s.id === id);
}

/** How many servers a machine is already carrying, failed ones included. */
export function load(w: World, id: string): number {
  return w.servers.filter((s) => s.machine === id).length;
}

export function note(w: World, text: string, kind: Entry["kind"]): void {
  const entry = { at: stamp(w.clock), text, kind };
  w.log.push(entry);
  if (kind !== "you") w.feed.unshift(entry);
}

export function record(w: World, text: string): void {
  w.log.push({ at: stamp(w.clock), text, kind: "you" });
}

function nextId(w: World): string {
  w.seq += 1;
  return `server-${pad(w.seq)}`;
}

function firstUsable(w: World): Machine | undefined {
  return w.machines.find((m) => m.status === "ready" && load(w, m.id) < m.capacity);
}

/**
 * Runs one player move. Mutates the world and reports what came of it. A move
 * that starts a server leaves it "starting"; `settle` finishes the job.
 */
export function apply(w: World, move: Move): MoveResult {
  w.clock += 4;

  if (move.kind === "observe") {
    record(w, `${w.actor} read the current state`);
    return { ok: false, message: "You read the state again. Nothing changed while you looked." };
  }

  if (move.kind === "wait") {
    w.moves += 1;
    record(w, `${w.actor} took no action`);
    return { ok: true, message: "You took no action." };
  }

  if (move.kind === "create") {
    const machine = move.machine ? machineOf(w, move.machine) : firstUsable(w);
    if (!machine) {
      return { ok: false, message: "Every machine is either down or full. There is nowhere to put a new server." };
    }
    if (machine.status === "ready" && load(w, machine.id) >= machine.capacity) {
      return { ok: false, message: `${machine.id} is full. It has room for ${machine.capacity} servers and is already carrying that many.` };
    }

    const id = nextId(w);
    const usable = machine.status === "ready";
    w.servers.push({
      id,
      machine: machine.id,
      status: usable ? "starting" : "pending",
      uptime: 0,
      cpu: 0,
      restartRecovers: true,
    });
    w.moves += 1;
    w.selected = id;
    record(w, `${w.actor} created ${id} on ${machine.id}`);
    if (!usable) {
      note(w, `${id} is stuck waiting. ${machine.id} is down and cannot run anything.`, "system");
      return { ok: true, message: `${id} was placed on ${machine.id}, which is down. It is waiting for a machine that is not coming back.` };
    }
    return { ok: true, message: `${id} is starting on ${machine.id}.` };
  }

  const target = serverOf(w, move.target ?? w.selected);
  if (!target) {
    return { ok: false, message: "Pick a server first. Click one in the list on the right." };
  }

  if (move.kind === "delete") {
    w.servers = w.servers.filter((s) => s.id !== target.id);
    w.moves += 1;
    if (w.selected === target.id) w.selected = null;
    record(w, `${w.actor} deleted ${target.id}`);
    return { ok: true, message: `${target.id} is gone.` };
  }

  // restart
  w.moves += 1;
  record(w, `${w.actor} restarted ${target.id}`);
  if (target.status === "running") {
    target.status = "starting";
    target.uptime = 0;
    return { ok: true, message: `${target.id} was running. You restarted it anyway, so it is briefly not running.` };
  }
  if (target.restartRecovers) {
    target.status = "starting";
    target.uptime = 0;
    return { ok: true, message: `${target.id} is coming back up.` };
  }
  note(w, `${target.id} did not come back.`, "system");
  return { ok: true, message: `${target.id} did not come back. Whatever it was running on is not answering.` };
}

/** Finishes anything the last move set in motion, then hands over to the scenario. */
export function settle(w: World, after?: (w: World) => void): void {
  w.clock += 2;
  for (const s of w.servers) {
    if (s.status === "starting") {
      s.status = "running";
      s.uptime = 0;
      s.cpu = 4 + ((w.seq * 7 + s.id.length * 3) % 22);
      note(w, `${s.id} is ready.`, "world");
    } else if (s.status === "running") {
      s.uptime += 6;
    }
  }
  if (after) after(w);
}

export function fail(w: World, id: string, reason: string): void {
  const s = serverOf(w, id);
  if (!s) return;
  s.status = "failed";
  s.cpu = 0;
  note(w, reason, "world");
}
