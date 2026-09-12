// Lesson 10's change desk, as data.
//
// Five change requests against one Deployment that keeps its history across the
// rounds: the spec each round starts from is the spec the round before it was
// asked to arrive at. The reader switches edits on and off, applies them, and
// is told what happened to the running pods.
//
// Nothing here records which edits are the right ones. A round says what the
// team asked for, as a state the spec has to end up in, and engine.ts works out
// the consequences from which fields were touched. So an edit nobody pictured
// still comes back with a truthful answer, and a round is cleared by leaving no
// bad consequence behind rather than by matching a key.
//
// Vocabulary: lesson 10 owns Deployment and rollout. It may not say ReplicaSet,
// which is lesson 11, so the middle segment of a pod name is shown changing and
// never named. Selectors are lesson 15, so `selector` is rendered in the
// manifest as part of the given and never discussed.

/**
 * A Deployment spec, flattened to one field per dotted path. Flat because the
 * only question the panel ever asks of a field is whether its path starts with
 * `template.`, and a tree would bury that behind plumbing.
 */
export type Spec = Record<string, string>;

/** One change the reader can switch on. */
export interface Edit {
  id: string;
  /**
   * The field it writes. Whether this starts with `template.` is the entire
   * lesson, and it is the only thing that decides what happens to the pods.
   */
  field: string;
  /** The value after. `null` removes the field. */
  to: string | null;
  /** Written as the change, the way the person making it would say it. */
  label: string;
}

/**
 * What the request is asking for. A state to arrive at, never an edit to pick,
 * so two routes to the same spec are both right.
 */
export type Want =
  | { kind: "field"; field: string; value: string; said: string }
  | { kind: "replaced"; said: string };

export interface Round {
  n: number;
  title: string;
  /** The request, as it would arrive in a message. */
  brief: string;
  spec: Spec;
  wants: Want[];
  edits: Edit[];
  /** One line once the round is cleared. The only editorial in the panel. */
  note: string;
}

const APP = "web";

export const deploymentName = APP;

export const rounds: Round[] = [
  {
    n: 1,
    title: "More of it",
    brief:
      "Friday's sale is going to hurt. Marketing wants five of the front end up before Thursday evening.",
    spec: {
      replicas: "3",
      "template.labels.app": APP,
      "template.image": "shop/web:2.8",
      "template.env.LOG_LEVEL": "info",
    },
    wants: [{ kind: "field", field: "replicas", value: "5", said: "five of the front end" }],
    edits: [
      { id: "r5", field: "replicas", to: "5", label: "Ask for five instead of three" },
      { id: "r10", field: "replicas", to: "10", label: "Ask for ten, to be safe" },
      {
        id: "img29",
        field: "template.image",
        to: "shop/web:2.9",
        label: "Move to shop/web:2.9 while you're in here",
      },
    ],
    note: "The count isn't part of the pod, so nothing you already had was touched. Two showed up and the other three never noticed.",
  },

  {
    n: 2,
    title: "Ship 2.9",
    brief: "2.9 passed review this morning. Get it serving.",
    spec: {
      replicas: "5",
      "template.labels.app": APP,
      "template.image": "shop/web:2.8",
      "template.env.LOG_LEVEL": "info",
    },
    wants: [
      {
        kind: "field",
        field: "template.image",
        value: "shop/web:2.9",
        said: "2.9 serving",
      },
    ],
    edits: [
      { id: "img29", field: "template.image", to: "shop/web:2.9", label: "Point it at shop/web:2.9" },
      { id: "img27", field: "template.image", to: "shop/web:2.7", label: "Point it at shop/web:2.7" },
      { id: "r3", field: "replicas", to: "3", label: "Drop back to three" },
    ],
    note: "Five pods gone and five different ones serving, for one character. That's a rollout, and it's the only way a Deployment knows how to change something that's already running.",
  },

  {
    n: 3,
    title: "Two things at once",
    brief:
      "There's a bug nobody can reproduce, so turn the logging up to debug. And the sale's over, take it back down to three while you're in there.",
    spec: {
      replicas: "5",
      "template.labels.app": APP,
      "template.image": "shop/web:2.9",
      "template.env.LOG_LEVEL": "info",
    },
    wants: [
      {
        kind: "field",
        field: "template.env.LOG_LEVEL",
        value: "debug",
        said: "debug logging",
      },
      { kind: "field", field: "replicas", value: "3", said: "back down to three" },
    ],
    edits: [
      {
        id: "debug",
        field: "template.env.LOG_LEVEL",
        to: "debug",
        label: "Set LOG_LEVEL to debug",
      },
      { id: "r3", field: "replicas", to: "3", label: "Drop back to three" },
      { id: "img30", field: "template.image", to: "shop/web:3.0", label: "Take 3.0 while you're here" },
    ],
    note: "Two changes in one apply and only one of them had anything to do with the pods that were running. Nothing in there weighed them up, it just noticed the template reads differently.",
  },

  {
    n: 4,
    title: "A label for the dashboard",
    brief:
      "Billing can't find this service on their dashboard. It groups by a team label on the pods, and ours don't have one. They want team=payments.",
    spec: {
      replicas: "3",
      "template.labels.app": APP,
      "template.image": "shop/web:2.9",
      "template.env.LOG_LEVEL": "debug",
    },
    wants: [
      {
        kind: "field",
        field: "template.labels.team",
        value: "payments",
        said: "team=payments on the pods",
      },
    ],
    edits: [
      {
        id: "own",
        field: "metadata.labels.team",
        to: "payments",
        label: "Label the Deployment team=payments",
      },
      {
        id: "tpl",
        field: "template.labels.team",
        to: "payments",
        label: "Label the pods team=payments",
      },
      { id: "r4", field: "replicas", to: "4", label: "Add a fourth pod" },
    ],
    note: "A label no code anywhere reads, and it cost you every pod you had. Nothing in a Deployment knows that a label is cosmetic and an image isn't. Inside the template is inside the template.",
  },

  {
    n: 5,
    title: "Just restart it",
    brief:
      "One of them is serving 500s and the logs say nothing useful. The team wants it restarted. There is no restart field in here, so work out what they actually get.",
    spec: {
      replicas: "3",
      "template.labels.app": APP,
      "template.labels.team": "payments",
      "template.image": "shop/web:2.9",
      "template.env.LOG_LEVEL": "debug",
    },
    wants: [
      {
        kind: "replaced",
        said: "the wedged process gone and a fresh one in its place",
      },
    ],
    edits: [
      {
        id: "stamp",
        field: "template.annotations.restartedAt",
        to: "2026-09-12T14:02:11Z",
        label: "Write the current time into the template's annotations",
      },
      {
        id: "note",
        field: "metadata.annotations.note",
        to: "restarted by hand, see INC-4412",
        label: "Leave a note on the Deployment",
      },
      { id: "r4", field: "replicas", to: "4", label: "Add a fourth pod" },
    ],
    note: "That's all `kubectl rollout restart` is. It writes a timestamp into the template, the template reads differently, so you get different pods. Same trick as the last four rounds, with a field picked because nothing runs on it. Note that you couldn't restart the one that was wedged, either. The Deployment only knows about the template, so all three went.",
  },
];
