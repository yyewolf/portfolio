// The world behind lesson 10's stale set.
//
// Small on purpose. There is one ReplicaSet, a list of pods, and one loop that
// does exactly what the real ReplicaSet controller does: count, compare, and
// create or delete one pod to close the gap. It has no idea what image anything
// is running, which is the entire point of the panel, so `reconcile` never looks
// at a pod's image and must not be made to.
//
// A pod records the image it was made with, taken from the template at the
// moment it was created. That is what makes the set and its pods able to
// disagree, and the disagreement is what the lesson is about.

import { IMAGE_OLD } from "./acts";

export interface Pod {
  name: string;
  /** The image this pod was created with. Never updated; pods are not edited. */
  image: string;
  /** Creation order, so the view can say which ones are the originals. */
  born: number;
}

export interface World {
  set: { name: string; replicas: number; image: string };
  pods: Pod[];
  /** Next creation stamp, and the source of the random part of a name. */
  clock: number;
}

const SAFE = "bcdfghjklmnpqrstvwxz2456789";

const fnv = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

/** Five characters from the alphabet Kubernetes itself uses. No vowels. */
const suffix = (seed: string): string => {
  let h = fnv(seed);
  let out = "";
  for (let i = 0; i < 5; i += 1) {
    out += SAFE[h % SAFE.length];
    h = Math.floor(h / SAFE.length) + fnv(out);
  }
  return out;
};

/**
 * The set's name. In a real cluster the hash comes from the pod template, which
 * is lesson 11's to explain. Here it is fixed, and it is the same string lesson
 * 7 put in front of the reader in its owner reference example.
 */
export const SET_NAME = "web-6c8f4b";

export const start = (): World => ({
  set: { name: SET_NAME, replicas: 3, image: IMAGE_OLD },
  pods: [0, 1, 2].map((i) => ({
    name: `${SET_NAME}-${suffix(`${SET_NAME}/${i}`)}`,
    image: IMAGE_OLD,
    born: i,
  })),
  clock: 3,
});

/**
 * One sweep of the ReplicaSet controller. It counts, it compares, and it changes
 * at most one thing, so the reader can watch it converge rather than jump.
 *
 * Note what it does not read. It never compares a pod's image against the
 * template, because the real controller does not either: a pod that exists is a
 * pod that counts, whatever it is running.
 */
export const reconcile = (w: World): { world: World; did: string } | null => {
  const have = w.pods.length;
  if (have === w.set.replicas) return null;

  if (have < w.set.replicas) {
    const pod: Pod = {
      name: `${SET_NAME}-${suffix(`${SET_NAME}/${w.clock}`)}`,
      // Read from the template as it reads now, which is the only moment the
      // template is ever consulted.
      image: w.set.image,
      born: w.clock,
    };
    return {
      world: { ...w, pods: [...w.pods, pod], clock: w.clock + 1 },
      did: `created ${pod.name} on ${pod.image}`,
    };
  }

  // Scaling down picks the newest first here, which keeps the acts legible.
  const victim = [...w.pods].sort((a, b) => b.born - a.born)[0] as Pod;
  return {
    world: { ...w, pods: w.pods.filter((p) => p.name !== victim.name) },
    did: `deleted ${victim.name}`,
  };
};

/** Run the loop to a standstill, collecting what each sweep did. */
export const settle = (w: World): { world: World; log: string[] } => {
  const log: string[] = [];
  let world = w;
  for (let i = 0; i < 50; i += 1) {
    const step = reconcile(world);
    if (!step) break;
    world = step.world;
    log.push(step.did);
  }
  return { world, log };
};

export const deletePods = (w: World, names: string[]): World => ({
  ...w,
  pods: w.pods.filter((p) => !names.includes(p.name)),
});

export const setImage = (w: World, image: string): World => ({
  ...w,
  set: { ...w.set, image },
});

/** Distinct images across the running pods, oldest first. */
export const versions = (w: World): string[] => [
  ...new Set([...w.pods].sort((a, b) => a.born - b.born).map((p) => p.image)),
];
