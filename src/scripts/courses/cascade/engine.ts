// The world for lesson 7's controller cascade, and the five loops that act on
// it. No DOM in here, and no rendering: cascade.ts owns all of that.
//
// The rule that makes the whole thing legible: **a controller does at most one
// thing per tick, and it decides by reading the world rather than by being
// told**. Every reconcile below takes the world, looks at it, and either
// performs one change or reports that there was nothing to do. None of them
// knows that another one exists, none of them is called by another one, and
// none of them is handed a description of what just changed.
//
// The deployment controller replaces one ReplicaSet with another one pod at a
// time: add a new one, wait for it to actually run, then remove an old one. The
// panel is not about rollouts, but getting this wrong makes it lie — a naive
// version that zeroes the old ReplicaSet in one move lets deletions outrun
// creations, and the reader watches availability collapse during what is
// supposed to be a safe operation. The knobs that control this are lesson 11's;
// the two used here are not configurable in the panel.

export type Phase = "Pending" | "Scheduled" | "Running";

export interface Pod {
  name: string;
  /** Name of the owning ReplicaSet. An orphan is a pod whose owner is gone. */
  rs: string;
  node: string | null;
  phase: Phase;
}

export interface ReplicaSet {
  name: string;
  image: string;
  /** Spec, written by the deployment controller. */
  replicas: number;
  /** The Deployment it was made for. */
  owner: string;
}

export interface Deployment {
  name: string;
  replicas: number;
  image: string;
}

export interface World {
  /** Null once the reader deletes it, which is what makes garbage collection visible. */
  deployment: Deployment | null;
  replicaSets: ReplicaSet[];
  pods: Pod[];
  nodes: string[];
  /** Bumped by every change, exactly like the store's revision in lesson 6. */
  rev: number;
  /** Suffix source for generated names. */
  seq: number;
}

export const NODES = ["node-1", "node-2", "node-3"];

export const initialWorld = (): World => ({
  deployment: { name: "web", replicas: 3, image: "web:1.4" },
  replicaSets: [],
  pods: [],
  nodes: [...NODES],
  rev: 41_822,
  seq: 0,
});

/** Short, stable-looking suffixes so pod names read like real ones. */
const suffix = (w: World): string => {
  w.seq += 1;
  return (w.seq * 7919).toString(36).slice(-4);
};

const podsOf = (w: World, rs: string): Pod[] => w.pods.filter((p) => p.rs === rs);

export interface Controller {
  id: string;
  name: string;
  /** What it has a watch on, in the terms lesson 5 established. */
  watches: string;
  /**
   * One pass. Returns a line describing the single change it made, or null if
   * it looked and there was nothing to do — which is the common case and is not
   * a failure.
   */
  reconcile(w: World): string | null;
}

/**
 * How far over and under the requested count a replacement may go. These are
 * what the real defaults (25% surge, 25% unavailable) work out to for three
 * replicas: round the surge up to one, round the unavailable down to zero. So a
 * rollout of three is allowed a fourth pod and is allowed no missing ones,
 * which is what forces add-then-remove rather than remove-then-add.
 */
const MAX_SURGE = 1;
const MAX_UNAVAILABLE = 0;

export const controllers: Controller[] = [
  {
    id: "deployment",
    name: "Deployment controller",
    watches: "Deployments, ReplicaSets",
    reconcile(w) {
      const d = w.deployment;
      if (!d) return null;

      const current = w.replicaSets.find(
        (r) => r.owner === d.name && r.image === d.image,
      );

      if (!current) {
        const name = `${d.name}-${suffix(w)}`;
        // Created empty. Whether it gets filled in one move or one pod at a
        // time is decided below, by whether anything is being replaced.
        w.replicaSets.push({ name, image: d.image, replicas: 0, owner: d.name });
        w.rev += 1;
        return `created ReplicaSet ${name} for ${d.image}`;
      }

      const others = w.replicaSets.filter(
        (r) => r.owner === d.name && r !== current,
      );
      const outgoing = others.reduce((n, r) => n + r.replicas, 0);

      // Nothing to replace, so this is not a rollout. A first deploy, or a
      // plain scale, goes straight to the number asked for.
      if (outgoing === 0) {
        if (current.replicas === d.replicas) return null;
        const was = current.replicas;
        current.replicas = d.replicas;
        w.rev += 1;
        return `set ${current.name} to ${d.replicas} (was ${was}); the Deployment asks for ${d.replicas}`;
      }

      // A replacement is under way. Add first, and only remove once the
      // addition is genuinely running — `running`, not merely created, is what
      // makes the wait a wait.
      const spec = current.replicas + outgoing;
      const running = w.pods.filter((p) => p.phase === "Running").length;

      if (current.replicas < d.replicas && spec < d.replicas + MAX_SURGE) {
        current.replicas += 1;
        w.rev += 1;
        return `set ${current.name} to ${current.replicas}; one over ${d.replicas} is allowed while replacing`;
      }

      if (running > d.replicas - MAX_UNAVAILABLE) {
        const victim = others.find((r) => r.replicas > 0);
        if (victim) {
          victim.replicas -= 1;
          w.rev += 1;
          return `set ${victim.name} to ${victim.replicas}; ${running} are running and ${d.replicas} are wanted, so an old one can go`;
        }
      }

      return null;
    },
  },

  {
    id: "replicaset",
    name: "ReplicaSet controller",
    watches: "ReplicaSets, Pods",
    reconcile(w) {
      for (const rs of w.replicaSets) {
        const mine = podsOf(w, rs.name);

        if (mine.length < rs.replicas) {
          const name = `${rs.name}-${suffix(w)}`;
          w.pods.push({ name, rs: rs.name, node: null, phase: "Pending" });
          w.rev += 1;
          return `created pod ${name}; ${rs.name} wants ${rs.replicas} and I count ${mine.length}`;
        }

        if (mine.length > rs.replicas) {
          // Newest first, so a scale-down does not churn the pods that have
          // been serving longest.
          const doomed = mine[mine.length - 1];
          w.pods = w.pods.filter((p) => p !== doomed);
          w.rev += 1;
          return `deleted pod ${doomed.name}; ${rs.name} wants ${rs.replicas} and I count ${mine.length}`;
        }
      }
      return null;
    },
  },

  {
    id: "scheduler",
    name: "Scheduler",
    watches: "Pods with no node",
    reconcile(w) {
      const waiting = w.pods.find((p) => p.node === null);
      if (!waiting) return null;

      // Fewest pods wins. The real thing scores a lot more than this, and gets
      // its own lesson in the scheduling phase.
      const load = (n: string): number =>
        w.pods.filter((p) => p.node === n).length;
      const node = [...w.nodes].sort((a, b) => load(a) - load(b))[0];

      waiting.node = node;
      waiting.phase = "Scheduled";
      w.rev += 1;
      return `assigned ${waiting.name} to ${node}; it had the most room`;
    },
  },

  {
    id: "kubelet",
    name: "kubelet",
    watches: "Pods assigned to my node",
    reconcile(w) {
      const assigned = w.pods.find((p) => p.phase === "Scheduled");
      if (!assigned) return null;
      assigned.phase = "Running";
      w.rev += 1;
      return `started ${assigned.name} on ${assigned.node} and wrote Running into its status`;
    },
  },

  {
    id: "gc",
    name: "Garbage collector",
    watches: "everything with an owner",
    reconcile(w) {
      const d = w.deployment;

      const orphanRs = w.replicaSets.find((r) => !d || r.owner !== d.name);
      if (orphanRs) {
        w.replicaSets = w.replicaSets.filter((r) => r !== orphanRs);
        w.rev += 1;
        return `deleted ReplicaSet ${orphanRs.name}; the Deployment it belonged to is gone`;
      }

      const orphanPod = w.pods.find(
        (p) => !w.replicaSets.some((r) => r.name === p.rs),
      );
      if (orphanPod) {
        w.pods = w.pods.filter((p) => p !== orphanPod);
        w.rev += 1;
        return `deleted pod ${orphanPod.name}; the ReplicaSet it belonged to is gone`;
      }

      return null;
    },
  },
];

// --- what the reader can do ------------------------------------------------
//
// Every one of these is a write to an object and nothing more. None of them
// tells a controller anything, and none of them starts or stops a container.
// That is the point being made: the reader edits records, and the loops above
// notice on their own.

export interface Action {
  id: string;
  label: string;
  /** Shown in the log as the reader's own line. */
  describe(w: World): string;
  /** False when the action makes no sense right now, so the button can dim. */
  enabled(w: World): boolean;
  apply(w: World): void;
}

const IMAGES = ["web:1.4", "web:1.5", "web:1.6"];

export const actions: Action[] = [
  {
    id: "scale-up",
    label: "Scale to 5",
    describe: () => "edited the Deployment: replicas 5",
    enabled: (w) => w.deployment !== null && w.deployment.replicas !== 5,
    apply: (w) => {
      if (w.deployment) w.deployment.replicas = 5;
      w.rev += 1;
    },
  },
  {
    id: "scale-down",
    label: "Scale to 2",
    describe: () => "edited the Deployment: replicas 2",
    enabled: (w) => w.deployment !== null && w.deployment.replicas !== 2,
    apply: (w) => {
      if (w.deployment) w.deployment.replicas = 2;
      w.rev += 1;
    },
  },
  {
    id: "new-image",
    label: "Ship a new image",
    describe: (w) => `edited the Deployment: image ${w.deployment?.image}`,
    enabled: (w) => w.deployment !== null,
    apply: (w) => {
      if (!w.deployment) return;
      const i = IMAGES.indexOf(w.deployment.image);
      w.deployment.image = IMAGES[(i + 1) % IMAGES.length];
      w.rev += 1;
    },
  },
  {
    id: "kill-pod",
    label: "Delete a running pod",
    describe: () => "deleted a pod",
    enabled: (w) => w.pods.some((p) => p.phase === "Running"),
    apply: (w) => {
      const victim = w.pods.find((p) => p.phase === "Running");
      if (victim) w.pods = w.pods.filter((p) => p !== victim);
      w.rev += 1;
    },
  },
  {
    id: "kill-rs",
    label: "Delete the ReplicaSet",
    describe: () => "deleted the ReplicaSet",
    enabled: (w) => w.replicaSets.length > 0,
    apply: (w) => {
      // The one the Deployment currently points at, so the reader watches the
      // live set vanish rather than a leftover from a previous image.
      const live =
        w.replicaSets.find((r) => r.image === w.deployment?.image) ??
        w.replicaSets[0];
      w.replicaSets = w.replicaSets.filter((r) => r !== live);
      w.rev += 1;
    },
  },
  {
    id: "kill-deployment",
    label: "Delete the Deployment",
    describe: () => "deleted the Deployment",
    enabled: (w) => w.deployment !== null,
    apply: (w) => {
      w.deployment = null;
      w.rev += 1;
    },
  },
];
