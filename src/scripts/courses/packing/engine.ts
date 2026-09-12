// The rules behind lesson 9's packing rounds.
//
// Everything the reader is told after pressing Run comes out of here, computed
// from the arrangement they built. Nothing in rounds.ts says what a good answer
// looks like and nothing here knows what the intended answer is, which is the
// property that matters: an arrangement the author never pictured still gets a
// sentence about what it would actually do, and a round is cleared by producing
// no bad consequences rather than by matching a key.
//
// Each rule is one real property of a pod:
//
//   - a pod is copied whole, so every container in it runs the same number of
//     times;
//   - a pod is one network namespace, so its containers share an address and a
//     port space;
//   - a volume belongs to a pod, so a directory cannot be shared out of one;
//   - a pod's containers are meant to stay up, and the ones that are not go in
//     front of them instead.
//
// Adding a fifth rule means adding a check here, not a string to a round.

import type { Proc, Round, Share } from "./rounds";

/** Where the reader put a process, or null while it is still unplaced. */
export interface Where {
  pod: string;
  init: boolean;
}

export type Placement = Record<string, Where | null>;

export interface Finding {
  tone: "bad" | "good";
  text: string;
}

export interface PodView {
  id: string;
  label: string;
  init: Proc[];
  main: Proc[];
  /** Name the pod would be given: its first lasting container. */
  name: string;
}

export const podLabel = (id: string): string => `Pod ${id.toUpperCase()}`;

const list = (names: string[]): string =>
  names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** The reader's arrangement, grouped. Empty pods are dropped. */
export const pods = (round: Round, placement: Placement): PodView[] =>
  round.pods
    .map((id) => {
      const at = (init: boolean): Proc[] =>
        round.procs.filter((p) => placement[p.id]?.pod === id && placement[p.id]?.init === init);
      const init = at(true);
      const main = at(false);
      return { id, label: podLabel(id), init, main, name: main[0]?.name ?? init[0]?.name ?? id };
    })
    .filter((p) => p.init.length > 0 || p.main.length > 0);

const podOf = (placement: Placement, id: string): string | undefined => placement[id]?.pod;

/** A share is satisfied when every member of it sits in one pod. */
const shareSplit = (placement: Placement, share: Share): boolean =>
  new Set(share.members.map((m) => podOf(placement, m))).size > 1;

export const evaluate = (round: Round, placement: Placement): Finding[] => {
  const bad: Finding[] = [];
  const good: Finding[] = [];
  const proc = (id: string): Proc | undefined => round.procs.find((p) => p.id === id);

  /**
   * Whether this process is reaching out of its own pod for something. A pod
   * with one container in it only gets called self-contained when it is: a
   * shipper tailing a directory that lives in somebody else's pod is a pod with
   * one container and a broken dependency, and calling it tidy would be praise
   * the arrangement has not earned.
   */
  const entangled = (id: string): boolean => {
    const home = placement[id]?.pod;
    if (home === undefined) return false;
    const reaching = (proc(id)?.localhost ?? []).some((t) => placement[t]?.pod !== home);
    const reachedFor = round.procs.some(
      (p) => (p.localhost ?? []).includes(id) && placement[p.id]?.pod !== home,
    );
    const shared = (round.shares ?? []).some(
      (s) => s.members.includes(id) && s.members.some((m) => placement[m]?.pod !== home),
    );
    return reaching || reachedFor || shared;
  };
  // Said once per run. Two pods with one container each is the commonest thing
  // in the track, and saying so twice in the same breath reads as a template.
  let saidCommon = false;

  for (const pod of pods(round, placement)) {
    const all = [...pod.init, ...pod.main];
    const lasting = pod.main.filter((p) => !p.oneshot);

    // A pod that is all preamble. The API server refuses this one outright.
    if (pod.main.length === 0) {
      bad.push({
        tone: "bad",
        text: `${pod.label} is only containers that run before the pod starts, and there's nothing for them to run before. A pod needs at least one ordinary container, so the API server just rejects this one and never schedules it.`,
      });
    }

    // Something that never exits, placed in front of everything that does.
    for (const p of pod.init.filter((x) => !x.oneshot)) {
      bad.push({
        tone: "bad",
        text: `${p.name} never exits, and everything in front of the pod has to finish before the rest of it starts. So ${pod.label} just sits in Init: 0/${pod.init.length} for as long as ${p.name} keeps running, which is forever.`,
      });
    }

    // The pod is the copy. Two different appetites in one pod is a contradiction.
    const counts = [...new Set(all.map((p) => p.copies))].sort((x, y) => y - x);
    if (counts.length > 1) {
      const most = all.find((p) => p.copies === counts[0]);
      const least = all.find((p) => p.copies === counts[counts.length - 1]);
      if (most && least) {
        bad.push({
          tone: "bad",
          text: `${most.name} needs ${most.copies} and ${least.name} needs ${least.copies}, and a pod gets copied whole. Run ${pod.label} ${most.copies} times and you've got ${most.copies} of ${least.name} instead of ${least.copies}. ${least.copies === 1 ? "Run it once" : `Run it ${least.copies} times`} and ${most.name} is short by ${most.copies - least.copies}.`,
        });
      }
    }

    // One network namespace means one port space.
    const ports = new Map<number, string[]>();
    for (const p of pod.main) {
      if (p.port === undefined) continue;
      ports.set(p.port, [...(ports.get(p.port) ?? []), p.name]);
    }
    for (const [port, names] of ports) {
      if (names.length < 2) continue;
      bad.push({
        tone: "bad",
        text: `${list(names)} ${names.length === 2 ? "both" : "all"} bind ${port}. Containers in a pod share one network namespace, so that's one address and one set of ports between them, and whichever starts second just gets "address already in use" and crash-loops.`,
      });
    }

    // Something that finishes, sitting among things that are supposed to last.
    if (lasting.length > 0) {
      for (const p of pod.main.filter((x) => x.oneshot)) {
        bad.push({
          tone: "bad",
          text: `${p.name} exits when it's done, and it's an ordinary container in a pod that's meant to stay up, so it just gets started again. And again. Meanwhile ${list(lasting.map((x) => x.name))} started at the same moment it did and never waited for it.`,
        });
      }
    }

    // A pod whose only job finishes is a legitimate shape, and worth saying so.
    if (lasting.length === 0 && pod.main.length === 1 && pod.main[0]?.oneshot) {
      good.push({
        tone: "good",
        text: `${pod.main[0].name} has ${pod.label} to itself and nothing in there outlives the work. It runs, it exits, the pod reaches Succeeded and that's it.`,
      });
    }

    if (lasting.length === 1 && pod.main.length === 1 && pod.init.length === 0) {
      const only = lasting[0];
      if (only && !entangled(only.id)) {
        const tail = saidCommon ? "" : " That's what most pods actually look like.";
        saidCommon = true;
        good.push({
          tone: "good",
          text: `${only.name} on its own: ${only.copies} ${plural(only.copies, "copy", "copies")} of a pod with one container in it, and nothing else's lifetime tied to them.${tail}`,
        });
      }
    }
  }

  // 127.0.0.1 is a claim about the pod, not about the application.
  for (const p of round.procs) {
    for (const id of p.localhost ?? []) {
      const target = proc(id);
      if (!target) continue;
      const here = podOf(placement, p.id);
      const there = podOf(placement, id);
      if (here === undefined || there === undefined) continue;
      if (here === there) {
        good.push({
          tone: "good",
          text: `${p.name} reaches ${target.name} on 127.0.0.1 because they're the same network namespace. Nothing to configure, nothing to discover, and ${target.name} can keep refusing every address that isn't local.`,
        });
      } else {
        bad.push({
          tone: "bad",
          text: `${p.name} forwards to 127.0.0.1:${target.port}, but ${target.name} is in ${podLabel(there)}. Two pods means two network namespaces with two addresses, so 127.0.0.1 inside ${p.name} is just ${p.name}. Connection refused, on every request.`,
        });
      }
    }
  }

  // A directory is a thing a pod has, and nothing outside the pod can reach it.
  for (const share of round.shares ?? []) {
    const members = share.members.map(proc).filter((p): p is Proc => p !== undefined);
    if (members.length < 2) continue;
    if (members.some((m) => podOf(placement, m.id) === undefined)) continue;
    if (shareSplit(placement, share)) {
      const grouped = members.map((m) => `${m.name} in ${podLabel(podOf(placement, m.id) ?? "")}`);
      bad.push({
        tone: "bad",
        text: `${share.path} is a directory the pod makes, not something the cluster has. With ${list(grouped)}, each pod just makes its own empty one, and they're on different machines anyway.`,
      });
    } else {
      const ordered = members.filter((m) => placement[m.id]?.init);
      const after = members.filter((m) => !placement[m.id]?.init);
      good.push({
        tone: "good",
        text:
          ordered.length > 0 && after.length > 0
            ? `${list(ordered.map((m) => m.name))} finishes writing to ${share.path} before ${list(after.map((m) => m.name))} starts, and they're looking at the same directory. It's created empty when the pod starts and it's gone when the pod is.`
            : `${list(members.map((m) => m.name))} mount ${share.path} and it's the same directory, created when the pod starts and gone when the pod is.`,
      });
    }
  }

  return [...bad, ...good];
};

export const solved = (findings: Finding[]): boolean => findings.every((f) => f.tone !== "bad");

/** The pods the reader built, written out the way they would be submitted. */
export const manifest = (round: Round, pod: PodView): string => {
  const sharesFor = (p: Proc): Share[] =>
    (round.shares ?? []).filter((s) => s.members.includes(p.id));
  const used = new Map<string, Share>();

  const block = (p: Proc, indent: string): string[] => {
    const lines = [`${indent}- name: ${p.name}`, `${indent}  image: ${p.image}`];
    if (p.port !== undefined) {
      lines.push(`${indent}  ports:`, `${indent}    - containerPort: ${p.port}`);
    }
    const mounts = sharesFor(p);
    if (mounts.length > 0) {
      lines.push(`${indent}  volumeMounts:`);
      for (const s of mounts) {
        used.set(s.name, s);
        lines.push(`${indent}    - name: ${s.name}`, `${indent}      mountPath: ${s.path}`);
      }
    }
    return lines;
  };

  const body: string[] = [];
  if (pod.init.length > 0) {
    body.push("  initContainers:");
    for (const p of pod.init) body.push(...block(p, "    "));
  }
  body.push("  containers:");
  for (const p of pod.main) body.push(...block(p, "    "));
  if (used.size > 0) {
    body.push("  volumes:");
    for (const s of used.values()) body.push(`    - name: ${s.name}`, `      emptyDir: {}`);
  }

  return ["kind: Pod", "metadata:", `  name: ${pod.name}`, "spec:", ...body].join("\n");
};
