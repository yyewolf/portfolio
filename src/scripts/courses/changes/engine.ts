// The rules behind lesson 10's change desk.
//
// Everything the reader is told after pressing Apply comes out of here,
// computed from the edits they switched on. rounds.ts says what the team asked
// for and never says which edits deliver it, so an arrangement of edits nobody
// pictured still gets a truthful account of what it would have done.
//
// There is really only one rule, and it is `inTemplate` below. A Deployment
// holds a description of a pod and a count of how many. Touch the description
// and every pod is replaced, because creating and deleting pods is the only thing
// a Deployment ever does to one. Touch anything else and the pods that are
// running carry on running. Nothing in here weighs a change by how important it
// looks, which is the whole point: a label and an image are the same kind of
// event.
//
// Note that this is a fact about the Deployment and not about pods being
// immutable. Plenty of a running pod can be changed, and more of it every
// release: the image always could be, metadata always could be, and CPU and
// memory can now be resized in place. The Deployment reaches for none of it, so
// the rule below holds regardless of which fields the API server has opened up.
//
// The pod name carries the proof. Its middle segment is a hash of the template
// fields, computed here rather than written down, so it changes exactly when the
// template changes and the reader can check that against the diff. That segment is
// the ReplicaSet's name, which lesson 10 has already explained by the time this
// panel runs.

import { deploymentName, type Edit, type Round, type Spec, type Want } from "./rounds";

/** The lesson, as one function. */
export const inTemplate = (field: string): boolean => field.startsWith("template.");

export interface Change {
  field: string;
  from: string | null;
  to: string | null;
}

export interface Finding {
  tone: "bad" | "good" | "flat";
  text: string;
}

export interface Outcome {
  changes: Change[];
  /** The spec after the edits. */
  next: Spec;
  before: string[];
  after: string[];
  /** Every running pod was replaced, because the template reads differently. */
  replaced: boolean;
  findings: Finding[];
  cleared: boolean;
}

/* --- names --------------------------------------------------------------- */

const fnv = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

const templateOf = (spec: Spec): string =>
  Object.keys(spec)
    .filter(inTemplate)
    .sort()
    .map((k) => `${k}=${spec[k]}`)
    .join("\n");

/**
 * The alphabet Kubernetes itself uses for the random parts of a generated name.
 * No vowels, so no generated pod is ever accidentally rude, and no `0`/`1`/`o`/
 * `l` either. Worth copying rather than reaching for hex: a reader who has seen
 * real pod names would notice the vowels straight away.
 */
const SAFE = "bcdfghjklmnpqrstvwxz2456789";

const encode = (n: number, len: number): string => {
  let h = n;
  let out = "";
  for (let i = 0; i < len; i += 1) {
    out += SAFE[h % SAFE.length];
    h = Math.floor(h / SAFE.length) + fnv(out);
  }
  return out;
};

/**
 * The middle segment of a pod's name: a hash of the template, which is what
 * makes it change when and only when the template does.
 */
export const templateHash = (spec: Spec): string => encode(fnv(templateOf(spec)), 6);

/** Five characters, the way a real pod name ends. Stable per hash and slot. */
const suffix = (hash: string, slot: number): string => encode(fnv(`${hash}/${slot}`), 5);

export const replicasOf = (spec: Spec): number => Number.parseInt(spec.replicas ?? "0", 10) || 0;

/**
 * The running pods for a spec. Slot is what decides the name, so raising the
 * count leaves the existing names alone and adds new ones on the end.
 */
export const podNames = (spec: Spec): string[] => {
  const hash = templateHash(spec);
  return Array.from(
    { length: replicasOf(spec) },
    (_, i) => `${deploymentName}-${hash}-${suffix(hash, i)}`,
  );
};

/* --- edits --------------------------------------------------------------- */

export const applyEdits = (spec: Spec, edits: Edit[], on: Set<string>): Spec => {
  const next: Spec = { ...spec };
  for (const edit of edits) {
    if (!on.has(edit.id)) continue;
    if (edit.to === null) delete next[edit.field];
    else next[edit.field] = edit.to;
  }
  return next;
};

export const diff = (before: Spec, after: Spec): Change[] =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
    .map((field) => ({ field, from: before[field] ?? null, to: after[field] ?? null }))
    .filter((c) => c.from !== c.to);

/* --- sentences ----------------------------------------------------------- */

const list = (items: string[]): string =>
  items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

const code = (s: string): string => `\`${s}\``;

const count = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`;

const met = (want: Want, spec: Spec, replaced: boolean): boolean =>
  want.kind === "replaced" ? replaced : spec[want.field] === want.value;

/**
 * Whether satisfying the request needs the template touched at all. This is what
 * separates a rollout the reader was asked for from one they caused by accident,
 * and it is read off the request rather than off a list of approved edits.
 */
const needsTemplate = (round: Round): boolean =>
  round.wants.some(
    (w) =>
      w.kind === "replaced" ||
      (inTemplate(w.field) && round.spec[w.field] !== w.value),
  );

/**
 * Whether the request was about this field. A request that can only be met by
 * replacing the pods is about every template field at once, because any of them
 * would do it, which is exactly why `rollout restart` picks one nothing reads.
 */
const asked = (round: Round, field: string): boolean =>
  round.wants.some((w) =>
    w.kind === "replaced" ? inTemplate(field) : w.field === field,
  );

/**
 * Whether a field reaches anything that is running. The template does, because
 * changing it replaces pods, and the count does, because it adds or deletes
 * them. Everything else on a Deployment is a record of itself: real, stored,
 * and inert. An unasked change to an inert field is worth a sentence and is not
 * a mistake, which is the difference between labelling the Deployment and
 * labelling its pods.
 */
const runs = (field: string): boolean => inTemplate(field) || field === "replicas";

/* --- the account --------------------------------------------------------- */

export const run = (round: Round, edits: Edit[], on: Set<string>): Outcome => {
  const before = podNames(round.spec);
  const next = applyEdits(round.spec, edits, on);
  const changes = diff(round.spec, next);
  const after = podNames(next);
  const replaced = templateHash(next) !== templateHash(round.spec);

  const findings: Finding[] = [];
  const bad = (text: string): void => {
    findings.push({ tone: "bad", text });
  };
  const good = (text: string): void => {
    findings.push({ tone: "good", text });
  };
  const flat = (text: string): void => {
    findings.push({ tone: "flat", text });
  };

  if (changes.length === 0) {
    bad(
      `You applied nothing, so nothing happened. The ${count(before.length, "pod", "pods")} running are the ones that were running before.`,
    );
    return { changes, next, before, after, replaced, findings, cleared: false };
  }

  const templateChanges = changes.filter((c) => inTemplate(c.field));
  const outsideChanges = changes.filter((c) => !inTemplate(c.field));
  const required = needsTemplate(round);
  const satisfied = round.wants.every((w) => met(w, next, replaced));

  // What they were asked for, first, because everything after it is cost.
  for (const want of round.wants) {
    if (met(want, next, replaced)) continue;
    if (want.kind === "replaced") {
      bad(
        `They asked for ${want.said}. Every pod is still the one that was there before, same name and same process.`,
      );
    } else {
      const now = next[want.field];
      bad(
        `They asked for ${want.said}. The spec says ${code(`${want.field}: ${now ?? "(not set)"}`)}.`,
      );
    }
  }

  // Changes nobody asked about, and only the ones that reach something running
  // are mistakes. Combined into one finding, because a single click that is both
  // unasked and an accidental rollout is one mistake and not two.
  const unasked = changes.filter((c) => !asked(round, c.field));
  const meddling = unasked.filter((c) => runs(c.field));
  const inert = unasked.filter((c) => !runs(c.field));
  if (meddling.length > 0) {
    const fields = list(meddling.map((c) => code(c.field)));
    if (meddling.some((c) => inTemplate(c.field)) && !required) {
      bad(
        `Nobody asked about ${fields}, it's inside the template, and changing it replaced all ${count(before.length, "pod", "pods")}. Everything that was asked for could have been done without touching a single running pod.`,
      );
    } else {
      bad(`Nobody asked about ${fields}. You changed it anyway, in the same apply.`);
    }
  }
  for (const c of inert) {
    flat(
      `${code(c.field)} is on the Deployment, not on the pods it makes. Nothing running reads it and nothing restarted for it.`,
    );
  }

  // What happened to the pods. An apply with anything bad in it gets the facts
  // without the compliment: a rollout the reader was asked for is still a good
  // thing to have done, but praising it in the same list as a mistake is how a
  // panel ends up congratulating play it did not check.
  const clean = (): boolean => satisfied && !findings.some((f) => f.tone === "bad");
  if (replaced && required) {
    (clean() ? good : flat)(
      `${count(before.length, "pod", "pods")} replaced. ${before[0]} became ${after[0]}, and so did the rest. You changed the pod it's supposed to run, so you got different pods.`,
    );
  } else if (replaced) {
    flat(
      `${before[0]} is gone and ${after[0]} is serving in its place, along with every other pod in the set.`,
    );
  } else if (outsideChanges.length > 0) {
    (clean() ? good : flat)(
      `Nothing was replaced. Every pod that was running is still running, same name, same address, same process, because nothing you changed is inside the template.`,
    );
  }

  // The count, separately, because it is the one change that is about pods
  // without being about the pod.
  const added = after.length - before.length;
  if (added > 0 && !replaced) {
    flat(
      `${count(added, "pod", "pods")} added. The ${count(before.length, "that was", "that were")} already there carried on untouched.`,
    );
  } else if (added > 0) {
    flat(`The set went from ${before.length} to ${after.length}.`);
  } else if (added < 0) {
    flat(`${count(-added, "pod", "pods")} deleted. The set is down to ${after.length}.`);
  }

  // Round 3's job, generated rather than written: when both kinds of change
  // arrive together, say which one did what.
  if (templateChanges.length > 0 && outsideChanges.length > 0) {
    flat(
      `Two kinds of change in one apply. ${list(outsideChanges.map((c) => code(c.field)))} left the running pods alone. ${list(templateChanges.map((c) => code(c.field)))} replaced every one of them. Nothing in there ranked them, it only noticed that the template reads differently.`,
    );
  }

  const cleared = satisfied && !findings.some((f) => f.tone === "bad");
  return { changes, next, before, after, replaced, findings, cleared };
};

/* --- the manifest -------------------------------------------------------- */

export interface Line {
  text: string;
  /** Set when this line renders a field, so the view can mark it changed. */
  field?: string;
  /**
   * Inside `spec.template`. The view tints these, which is the one thing the
   * panel can show that no sentence about it lands as well: the template is a
   * box, and the reader can see where its walls are.
   */
  tmpl?: boolean;
}

const mapEntries = (spec: Spec, prefix: string): [string, string][] =>
  Object.keys(spec)
    .filter((k) => k.startsWith(`${prefix}.`))
    .sort()
    .map((k) => [k.slice(prefix.length + 1), spec[k] as string]);

const quoted = (v: string): string => (/^[\w.:/@+-]+$/.test(v) ? v : `"${v}"`);

/**
 * The spec as real Deployment YAML. Hand-written rather than generic, because
 * the nesting is the argument: the template has its own metadata and its own
 * spec, and the reader has to see how far down `replicas` is not.
 *
 * `selector` is rendered because a Deployment without one is not a Deployment.
 * Nothing in the lesson discusses it; labels and selectors are lesson 15.
 */
export const manifest = (spec: Spec): Line[] => {
  const lines: Line[] = [];
  let tmpl = false;
  const put = (text: string, field?: string): void => {
    lines.push({ text, field, tmpl });
  };
  const block = (prefix: string, key: string, indent: string): void => {
    const entries = mapEntries(spec, prefix);
    if (entries.length === 0) return;
    put(`${indent}${key}:`);
    for (const [k, v] of entries) put(`${indent}  ${k}: ${quoted(v)}`, `${prefix}.${k}`);
  };

  put(`kind: Deployment`);
  put(`metadata:`);
  put(`  name: ${deploymentName}`);
  block("metadata.labels", "labels", "  ");
  block("metadata.annotations", "annotations", "  ");
  put(`spec:`);
  put(`  replicas: ${spec.replicas ?? "0"}`, "replicas");
  put(`  selector:`);
  put(`    matchLabels:`);
  put(`      app: ${spec["template.labels.app"] ?? deploymentName}`);
  put(`  template:`);
  tmpl = true;
  put(`    metadata:`);
  block("template.labels", "labels", "      ");
  block("template.annotations", "annotations", "      ");
  put(`    spec:`);
  put(`      containers:`);
  put(`        - name: ${deploymentName}`);
  put(`          image: ${spec["template.image"] ?? ""}`, "template.image");
  const env = mapEntries(spec, "template.env");
  if (env.length > 0) {
    put(`          env:`);
    for (const [k, v] of env) {
      put(`            - name: ${k}`, `template.env.${k}`);
      put(`              value: ${quoted(v)}`, `template.env.${k}`);
    }
  }
  return lines;
};
