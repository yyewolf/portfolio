// Lesson 12's run sheet, as data.
//
// Five pieces of work the team needs run, and for each one the reader edits a
// spec, runs it against a scripted stretch of time, and reads what happened. Each
// round starts from the spec somebody would write first, so running it untouched
// is always a legitimate first move and usually an instructive one.
//
// Nothing here records which settings are right. A round declares the world (how
// long the work takes, which pod gets evicted, when the partner's server goes
// quiet, when the warehouse is slow) and engine.ts simulates the Job and CronJob
// controllers against it. A round is cleared when the simulation produces no bad
// consequence, so a combination nobody pictured still gets a truthful account.
//
// Each round is decided by one thing:
//
// 1. A Deployment restarts a container that exits, exit 0 included.
// 2. A retry is a new pod running the command from the top.
// 3. A process that hangs hasn't failed, so only a deadline ends it.
// 4. A CronJob doesn't know how long the last run is taking.
// 5. The schedule is read on the controller's clock.
//
// Vocabulary: lesson 12 owns Job and CronJob. Labels and selectors are lesson 15,
// so the Deployment in round 1 renders a selector and nothing discusses it.

export type FieldId =
  | "kind"
  | "backoffLimit"
  | "args"
  | "activeDeadlineSeconds"
  | "concurrencyPolicy"
  | "schedule"
  | "timeZone";

export type Settings = Partial<Record<FieldId, string>>;

export interface Choice {
  value: string;
  label: string;
}

export interface Field {
  id: FieldId;
  /** Where it lives, spelled the way the manifest spells it. */
  path: string;
  choices: Choice[];
}

/** What the world does to one pod. A pod with neither runs clean. */
export interface Attempt {
  /** Minutes into this pod's run when it's taken out, and why, as a clause. `{t}` becomes the time. */
  fails?: { at: number; how: "exit" | "evicted"; why: string };
  /** Minutes into this pod's run when it stops making progress and never exits. */
  hangs?: number;
}

/** Work that is a list of things, so doing some of them twice can be counted. */
export interface Items {
  total: number;
  one: string;
  many: string;
  /** Past tense of doing one: "sent". */
  done: string;
}

export interface OnceWorld {
  type: "once";
  name: string;
  image: string;
  /** The container's command, and the flag that makes it skip finished work. */
  args?: { base: string[]; skip: string };
  /** Minutes of work in a clean run. */
  work: number;
  items?: Items;
  /** Which `kubectl get` the terminal under the timeline shows. */
  show: "pods" | "jobs";
  /** Minutes of simulated time shown. */
  window: number;
  /** One Job each. `offset` is how many minutes before the window it started. */
  runs: { job: string; label?: string; offset?: number; attempts: Attempt[] }[];
}

export interface CronWorld {
  type: "cron";
  name: string;
  image: string;
  schedule: string;
  work: number;
  /** The day being watched, in UTC, and the stretch of it shown. */
  day: string;
  from: string;
  to: string;
  /** A stretch where the work goes `factor` times slower than usual. */
  slow: { from: string; to: string; factor: number; why: string };
  /** The job rewrites a file in place, so overlap and being killed both hurt. */
  writes: string;
}

export interface ClockWorld {
  type: "clock";
  name: string;
  image: string;
  work: number;
  /** The clock the CronJob controller runs on when `timeZone` is not set. */
  controllerZone: string;
  /** Where the people are, and when they want it. */
  zone: string;
  place: string;
  at: string;
  days: { date: string; label: string }[];
  clocksChange: string;
}

export type World = OnceWorld | CronWorld | ClockWorld;

export interface Round {
  n: number;
  title: string;
  /** The ask, as it would arrive in a message. */
  brief: string;
  fields: Field[];
  /** The spec somebody wrote first. */
  start: Settings;
  world: World;
  /** One paragraph once the round is cleared. The only editorial in the panel. */
  note: string;
}

export const rounds: Round[] = [
  {
    n: 1,
    title: "Run the migration",
    brief:
      "2.9 needs a new column on the orders table before it ships. Someone copied the web Deployment, pointed it at the migration image, and it's ready to apply. The migration takes about four minutes.",
    fields: [
      {
        id: "kind",
        path: "kind",
        choices: [
          { value: "Deployment", label: "Deployment" },
          { value: "Job", label: "Job" },
        ],
      },
    ],
    start: { kind: "Deployment" },
    world: {
      type: "once",
      name: "migrate",
      image: "shop/migrate:2.9",
      work: 4,
      show: "pods",
      window: 30,
      runs: [{ job: "migrate", attempts: [] }],
    },
    note: "A Deployment only accepts `restartPolicy: Always`, so to a Deployment a container that exits has crashed, exit 0 included. A Job is the other way round. Exiting 0 is the whole point, and it's the one thing that makes it stop.",
  },

  {
    n: 2,
    title: "Send the invoices",
    brief:
      "First of the month, so 1,000 customers get an invoice by email. The script walks the list and sends them one at a time, about 20 minutes end to end. Platform is upgrading nodes today, so expect drains.",
    fields: [
      {
        id: "backoffLimit",
        path: "spec.backoffLimit",
        choices: [
          { value: "6", label: "6, the default" },
          { value: "0", label: "0, never retry" },
        ],
      },
      {
        id: "args",
        path: "containers[0].args",
        choices: [
          { value: "all", label: "Send every invoice in the list" },
          { value: "skip", label: "Skip invoices already marked sent" },
        ],
      },
    ],
    start: { backoffLimit: "6", args: "all" },
    world: {
      type: "once",
      name: "invoices",
      image: "shop/invoices:1.4",
      args: { base: ["send-invoices"], skip: "--skip-sent" },
      work: 20,
      items: { total: 1000, one: "invoice", many: "invoices", done: "sent" },
      show: "jobs",
      window: 40,
      runs: [
        {
          job: "invoices",
          attempts: [
            { fails: { at: 12, how: "evicted", why: "was evicted {t} in, when its node was drained" } },
          ],
        },
      ],
    },
    note: "A retry is a new pod running your command from the start. It doesn't resume anything, and it has no idea what the last pod got through. Kubernetes can make sure the work finishes, but only your code can make running it twice safe, and anything a Job runs will run twice sooner or later.",
  },

  {
    n: 3,
    title: "Push the orders export",
    brief:
      "Every night a Job uploads the day's orders to a partner's SFTP server, which takes about 40 minutes. Last Tuesday their server accepted the connection and then went quiet. Make sure that can't turn into a Job nobody hears about.",
    fields: [
      {
        id: "activeDeadlineSeconds",
        path: "spec.activeDeadlineSeconds",
        choices: [
          { value: "none", label: "Not set" },
          { value: "600", label: "600, ten minutes" },
          { value: "7200", label: "7200, two hours" },
        ],
      },
    ],
    start: { activeDeadlineSeconds: "none" },
    world: {
      type: "once",
      name: "export",
      image: "shop/export:3.0",
      work: 40,
      show: "jobs",
      window: 360,
      runs: [
        { job: "export-monday", label: "Monday", offset: 1440, attempts: [] },
        { job: "export-tuesday", label: "Tuesday", attempts: [{ hangs: 5 }] },
      ],
    },
    note: "A process that's stuck waiting hasn't failed, so `backoffLimit` never comes into it. `activeDeadlineSeconds` is a clock on the whole Job, retries included, and when it runs out the Job is Failed however well things were going. Set it comfortably above a good run, and short enough that a hang gets noticed the same night.",
  },

  {
    n: 4,
    title: "Sync the stock every hour",
    brief:
      "A CronJob pulls stock levels from the warehouse at the top of every hour and rewrites the stock file the shop reads. A sync takes 15 minutes. Missing an hour now and then is fine. Two syncs writing the file at once isn't, and neither is one that stops halfway.",
    fields: [
      {
        id: "concurrencyPolicy",
        path: "spec.concurrencyPolicy",
        choices: [
          { value: "Allow", label: "Allow, the default" },
          { value: "Forbid", label: "Forbid" },
          { value: "Replace", label: "Replace" },
        ],
      },
    ],
    start: { concurrencyPolicy: "Allow" },
    world: {
      type: "cron",
      name: "stock-sync",
      image: "shop/stock-sync:1.2",
      schedule: "0 * * * *",
      work: 15,
      day: "2026-09-14",
      from: "13:30",
      to: "18:30",
      slow: {
        from: "14:00",
        to: "15:40",
        factor: 6,
        why: "the warehouse API was six times slower than usual",
      },
      writes: "the stock file",
    },
    note: "A CronJob starts a Job when the clock says so, and it has no idea how long the last one is taking. `Allow` is the default and lets them pile up. `Forbid` skips a run while the last one's still going, and `Replace` kills the old one to start the new one, which is only the right call when being stopped halfway is harmless.",
  },

  {
    n: 5,
    title: "The morning digest",
    brief:
      "The team in Paris wants the daily digest in their inbox at 9:00, their time, all year round.",
    fields: [
      {
        id: "schedule",
        path: "spec.schedule",
        choices: [
          { value: "0 9 * * *", label: "0 9 * * *" },
          { value: "0 7 * * *", label: "0 7 * * *" },
        ],
      },
      {
        id: "timeZone",
        path: "spec.timeZone",
        choices: [
          { value: "none", label: "Not set" },
          { value: "Europe/Paris", label: "Europe/Paris" },
        ],
      },
    ],
    start: { schedule: "0 9 * * *", timeZone: "none" },
    world: {
      type: "clock",
      name: "digest",
      image: "shop/digest:1.0",
      work: 10,
      controllerZone: "UTC",
      zone: "Europe/Paris",
      place: "Paris",
      at: "09:00",
      days: [
        { date: "2026-09-14", label: "14 September" },
        { date: "2026-11-02", label: "2 November" },
      ],
      clocksChange: "25 October",
    },
    note: "The schedule is read on the controller's clock, and on nearly every cluster that clock is UTC. Setting `timeZone` is the only version that stays right across a clock change, because it's the only one that knows there is a clock change.",
  },
];
