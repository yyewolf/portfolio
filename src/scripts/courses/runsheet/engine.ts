// The rules behind lesson 12's run sheet.
//
// Everything the reader is told after pressing Run comes out of here, computed
// by simulating the controllers against the round's world. rounds.ts never says
// which settings deliver what the team asked for, so the findings below are
// written about mechanisms (a pod was evicted, two Jobs overlapped, a deadline
// ran out while work was still progressing) and never about which button was
// pressed.
//
// Four simulations, each as faithful as the lesson needs and no more:
//
// - A Deployment's container that exits is restarted in place with the kubelet's
//   crash back-off, 10s doubling to five minutes, whatever its exit code said.
// - A Job replaces a failed pod after its own back-off, 10s doubling to six
//   minutes, until failures exceed `backoffLimit`. An eviction is a failure. A
//   replacement starts the command from the beginning; whether it skips work
//   already done is a property of the command, not of the Job.
//   `activeDeadlineSeconds` is measured from the Job's start and covers retries.
// - A CronJob makes one Job per schedule tick and applies `concurrencyPolicy`
//   against whichever Jobs are still running at that tick. It never looks at how
//   long a run usually takes.
// - The schedule is read in `timeZone` if set, and on the controller's own clock
//   if not. Conversions go through Intl, so daylight saving is the real thing.
//
// Names are real shapes: a Job's pods are the Job name plus five characters, and
// a CronJob's Jobs are its name plus the scheduled minute counted from 1970.

import type {
  Attempt,
  ClockWorld,
  CronWorld,
  FieldId,
  OnceWorld,
  Round,
  Settings,
} from "./rounds";

export type Tone = "bad" | "good" | "flat";

export interface Finding {
  tone: Tone;
  text: string;
}

export interface Bar {
  from: number;
  to: number;
  /** Doing work, or alive and doing nothing. */
  state: "run" | "hung";
  /** How it ended, if it ended badly. */
  end?: "failed" | "killed";
  /** Still going past the right-hand edge of the timeline. */
  open?: boolean;
  title: string;
}

export interface Row {
  label: string;
  sub?: string;
  bars: Bar[];
  /** A tick where a run was due and never started. */
  skipAt?: number;
  tag: string;
  tone: Tone;
}

export interface Timeline {
  caption: string;
  from: number;
  to: number;
  ticks: { at: number; label: string }[];
  rows: Row[];
  /** A dashed line for the moment something was wanted. */
  target?: number;
}

export interface Outcome {
  timeline: Timeline;
  terminal?: { command: string; lines: string[] };
  findings: Finding[];
  cleared: boolean;
}

/* --- words and numbers ---------------------------------------------------- */

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const list = (items: string[]): string =>
  items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

const code = (s: string): string => `\`${s}\``;

const num = (n: number): string => n.toLocaleString("en-US");

/** Minutes, the way a person says them. */
export const spoken = (minutes: number): string => {
  const m = Math.round(minutes);
  if (m < 60) return count(m, "minute", "minutes");
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? count(h, "hour", "hours") : `${count(h, "hour", "hours")} ${count(r, "minute", "minutes")}`;
};

/** Minutes, the way `kubectl` prints an age or a duration. */
export const human = (minutes: number): string => {
  const s = Math.max(0, Math.floor(minutes * 60));
  if (s < 120) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 10) return s % 60 === 0 ? `${m}m` : `${m}m${s % 60}s`;
  if (m < 180) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 8) return m % 60 === 0 ? `${h}h` : `${h}h${m % 60}m`;
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 === 0 ? `${d}d` : `${d}d${h % 24}h`;
};

/** Minutes past midnight as a clock reading. */
export const hhmm = (minutes: number): string => {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

const clock = (s: string): number => {
  const [h, m] = s.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Columns padded the way kubectl pads them: widest cell plus three spaces. */
const table = (rows: string[][]): string[] => {
  const widths: number[] = [];
  for (const row of rows) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, cell.length)));
  return rows.map((row) =>
    row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd((widths[i] ?? 0) + 3))).join(""),
  );
};

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

const encode = (n: number, len: number): string => {
  let h = n;
  let out = "";
  for (let i = 0; i < len; i += 1) {
    out += SAFE[h % SAFE.length];
    h = Math.floor(h / SAFE.length) + fnv(out);
  }
  return out;
};

const podName = (owner: string, slot: number): string => `${owner}-${encode(fnv(`${owner}/${slot}`), 5)}`;

/* --- settings ------------------------------------------------------------- */

const FALLBACK: Record<FieldId, string> = {
  kind: "Job",
  backoffLimit: "6",
  args: "all",
  activeDeadlineSeconds: "none",
  concurrencyPolicy: "Allow",
  schedule: "0 9 * * *",
  timeZone: "none",
};

export const setting = (s: Settings, id: FieldId): string => s[id] ?? FALLBACK[id];

/** Bad findings take the praise out of good ones, so a mixed list never congratulates. */
const settle = (findings: Finding[]): { findings: Finding[]; cleared: boolean } => {
  const bad = findings.some((f) => f.tone === "bad");
  return {
    findings: bad ? findings.map((f) => (f.tone === "good" ? { ...f, tone: "flat" } : f)) : findings,
    cleared: !bad,
  };
};

const onceTicks = (window: number): { at: number; label: string }[] => {
  const step = window <= 30 ? 5 : window <= 60 ? 10 : 60;
  const out: { at: number; label: string }[] = [];
  for (let at = 0; at <= window; at += step) {
    out.push({ at, label: step >= 60 ? `${at / 60}h` : `${at}m` });
  }
  return out;
};

/* --- a Deployment running something that finishes ------------------------ */

const crashLoop = (w: OnceWorld): Outcome => {
  const hash = encode(fnv(`${w.name}/${w.image}`), 6);
  const pod = `${w.name}-${hash}-${encode(fnv(`${w.name}-${hash}/0`), 5)}`;

  const bars: Bar[] = [];
  let t = 0;
  let exits = 0;
  let waiting = false;
  while (t < w.window) {
    const end = t + w.work;
    const open = end > w.window;
    bars.push({
      from: t,
      to: Math.min(end, w.window),
      state: "run",
      open,
      title: open ? `run ${bars.length + 1}, still going` : `run ${bars.length + 1}, exited 0`,
    });
    if (open) break;
    exits += 1;
    t = end + Math.min(10 * 2 ** (exits - 1), 300) / 60;
    waiting = t >= w.window;
  }
  const runs = bars.length;
  const restarts = runs - 1;
  const lastStart = bars[bars.length - 1]?.from ?? 0;
  const status = waiting ? "CrashLoopBackOff" : "Running";

  const findings: Finding[] = [
    {
      tone: "bad",
      text: `The migration ran ${runs} times in ${spoken(w.window)}. Every time it finished and exited 0 the container was started again, and ${code(pod)} has ${count(restarts, "restart", "restarts")} and a ${code(status)} status to show for it.`,
    },
    {
      tone: "flat",
      text: "It isn't going to stop, either. The Deployment wants one pod running, and a migration that's done isn't running.",
    },
  ];

  return {
    timeline: {
      caption: "minutes since it was applied",
      from: 0,
      to: w.window,
      ticks: onceTicks(w.window),
      rows: [{ label: pod, bars, tag: status, tone: "bad" }],
    },
    terminal: {
      command: `kubectl get pods`,
      lines: table([
        ["NAME", "READY", "STATUS", "RESTARTS", "AGE"],
        [pod, waiting ? "0/1" : "1/1", status, `${restarts} (${human(w.window - lastStart)} ago)`, human(w.window)],
      ]),
    },
    ...settle(findings),
  };
};

/* --- a Job ---------------------------------------------------------------- */

interface PodRun {
  name: string;
  start: number;
  end: number;
  ended: "done" | "exit" | "evicted" | "hung" | "deadline";
  why?: string;
  /** Minutes into the pod when it stopped making progress. */
  hungAt?: number;
  /** Fractions of the whole work this pod started and stopped at. */
  from: number;
  to: number;
}

interface JobRun {
  job: string;
  label?: string;
  offset: number;
  pods: PodRun[];
  status: "Complete" | "Failed" | "Running";
  reason?: "BackoffLimitExceeded" | "DeadlineExceeded";
  end: number;
  failures: number;
  /** How many times each item was done, when the work is a list. */
  counts?: number[];
}

export const simulateJob = (
  w: OnceWorld,
  run: OnceWorld["runs"][number],
  s: Settings,
): JobRun => {
  const limit = Number(setting(s, "backoffLimit"));
  const dl = setting(s, "activeDeadlineSeconds");
  const deadline = dl === "none" ? Infinity : Number(dl) / 60;
  const skip = setting(s, "args") === "skip";
  const counts = w.items ? new Array<number>(w.items.total).fill(0) : undefined;

  const pods: PodRun[] = [];
  let t = 0;
  let failures = 0;
  let recorded = 0;

  for (let i = 0; ; i += 1) {
    if (t >= deadline) {
      return { job: run.job, label: run.label, offset: run.offset ?? 0, pods, status: "Failed", reason: "DeadlineExceeded", end: deadline, failures, counts };
    }
    const a: Attempt = run.attempts[i] ?? {};
    const from = skip ? recorded : 0;
    const need = (1 - from) * w.work;

    let stop = need;
    let ended: PodRun["ended"] = "done";
    let hungAt: number | undefined;
    if (a.hangs !== undefined && a.hangs < stop) {
      hungAt = a.hangs;
      stop = Infinity;
      ended = "hung";
    }
    if (a.fails && a.fails.at < Math.min(stop, hungAt ?? Infinity)) {
      stop = a.fails.at;
      ended = a.fails.how;
      hungAt = undefined;
    }
    let end = t + stop;
    if (end > deadline) {
      end = deadline;
      ended = "deadline";
    }

    const worked = Math.min(end - t, hungAt ?? Infinity, need);
    const to = Math.min(1, from + worked / w.work);
    if (counts && w.items) {
      for (let k = Math.round(from * w.items.total); k < Math.round(to * w.items.total); k += 1) {
        counts[k] = (counts[k] ?? 0) + 1;
      }
    }
    recorded = Math.max(recorded, to);
    pods.push({ name: podName(run.job, i), start: t, end, ended, why: a.fails?.why, hungAt, from, to });

    const base = { job: run.job, label: run.label, offset: run.offset ?? 0, pods, end, failures, counts };
    if (ended === "done") return { ...base, status: "Complete" };
    if (ended === "hung") return { ...base, status: "Running", end: Infinity };
    if (ended === "deadline") return { ...base, status: "Failed", reason: "DeadlineExceeded" };

    failures += 1;
    if (failures > limit) {
      return { ...base, failures, status: "Failed", reason: "BackoffLimitExceeded" };
    }
    t = end + Math.min(10 * 2 ** (failures - 1), 360) / 60;
  }
};

const jobFindings = (w: OnceWorld, r: JobRun, s: Settings): Finding[] => {
  const out: Finding[] = [];
  const who = r.label ? `${r.label}'s run` : "It";
  const limit = Number(setting(s, "backoffLimit"));
  const deadline = Number(setting(s, "activeDeadlineSeconds")) / 60;

  r.pods.forEach((p, i) => {
    if (p.ended !== "exit" && p.ended !== "evicted") return;
    const next = r.pods[i + 1];
    out.push({
      tone: "flat",
      text: `${code(p.name)} ${(p.why ?? "exited 1 {t} in").replace("{t}", spoken(p.end - p.start))}, and the Job counted that as a failed pod.${next ? ` It made ${code(next.name)} to take over.` : ""}`,
    });
  });

  const last = r.pods[r.pods.length - 1];
  const items = w.items;

  if (r.status === "Complete") {
    const dupes = r.counts?.filter((c) => c > 1).length ?? 0;
    const first = r.pods[0];
    if (items && dupes > 0 && first && last) {
      out.push({
        tone: "bad",
        text: `${num(dupes)} of the ${num(items.total)} ${items.many} were ${items.done} twice. ${code(last.name)} ran the command from the start, and nothing in it knew what ${code(first.name)} had already done.`,
      });
    } else if (items && last && r.pods.length > 1) {
      out.push({
        tone: "good",
        text: `All ${num(items.total)} ${items.many} ${items.done} exactly once. ${code(last.name)} skipped the ${num(Math.round(last.from * items.total))} already marked and did the rest, and the Job is ${code("Complete")}.`,
      });
    } else {
      const pod = w.show === "pods" && last ? `, ${code(last.name)} stays behind as ${code("Completed")},` : "";
      out.push({
        tone: "good",
        text: `${who} ${r.label ? "" : "ran once and "}finished in ${spoken(r.end)}${pod} and the Job is ${code("Complete")}.`,
      });
    }
  }

  if (r.status === "Failed" && r.reason === "BackoffLimitExceeded") {
    const missing = r.counts?.filter((c) => c === 0).length ?? 0;
    const tail = limit === 0 ? "so there was never going to be a second try" : "so it stopped trying";
    out.push({
      tone: "bad",
      text: `The Job is ${code("Failed")} with ${code("BackoffLimitExceeded")}: ${count(r.failures, "failed pod", "failed pods")} against a ${code("backoffLimit")} of ${limit}, ${tail}.${items && missing > 0 ? ` ${num(missing)} ${items.many} were never ${items.done}.` : ""}`,
    });
  }

  if (r.status === "Failed" && r.reason === "DeadlineExceeded") {
    if (last && last.hungAt !== undefined) {
      out.push({
        tone: "good",
        text: `${who} hung ${spoken(last.hungAt)} in. The deadline killed it at ${spoken(deadline)}, and the Job is ${code("Failed")} with ${code("DeadlineExceeded")}, which is a status something can alert on.`,
      });
    } else {
      const pct = last ? Math.round(last.to * 100) : 0;
      out.push({
        tone: "bad",
        text: `${who} was ${pct}% done when the deadline killed it at ${spoken(deadline)}. Nothing was wrong with it, a good run just takes ${spoken(w.work)}. The Job is ${code("Failed")} with ${code("DeadlineExceeded")}.`,
      });
    }
  }

  if (r.status === "Running" && last) {
    out.push({
      tone: "bad",
      text: `${who} hung ${spoken(last.hungAt ?? 0)} in and it's still ${code("Running")} ${spoken(w.window)} after it started. Nothing failed, so nothing retried it, and with no deadline the Job will wait on it forever.`,
    });
  }

  return out;
};

const podBars = (p: PodRun, window: number): Bar[] => {
  const bars: Bar[] = [];
  const endBad = p.ended === "exit" || p.ended === "evicted" ? "failed" : p.ended === "deadline" ? "killed" : undefined;
  const stopWork = p.hungAt !== undefined ? p.start + p.hungAt : p.end;
  const open = p.end > window;
  const what: Record<PodRun["ended"], string> = {
    done: "exited 0",
    exit: "exited 1",
    evicted: "evicted",
    hung: "still hung",
    deadline: "killed by the deadline",
  };
  bars.push({
    from: p.start,
    to: Math.min(stopWork, window),
    state: "run",
    end: p.hungAt === undefined ? endBad : undefined,
    open: p.hungAt === undefined && open,
    title: p.hungAt === undefined ? `${p.name}, ${what[p.ended]}` : `${p.name}, working`,
  });
  if (p.hungAt !== undefined) {
    bars.push({
      from: stopWork,
      to: Math.min(p.end, window),
      state: "hung",
      end: endBad,
      open,
      title: `${p.name}, hung, ${what[p.ended]}`,
    });
  }
  return bars;
};

const onceJob = (w: OnceWorld, s: Settings): Outcome => {
  const runs = w.runs.map((run) => simulateJob(w, run, s));

  const rows: Row[] = [];
  for (const r of runs) {
    r.pods.forEach((p, i) => {
      const last = i === r.pods.length - 1;
      const tag = !last ? (p.ended === "evicted" ? "Evicted" : "Error") : r.status === "Failed" ? "Failed" : r.status;
      const tone: Tone = !last ? "flat" : r.status === "Complete" ? "good" : "bad";
      rows.push({ label: p.name, sub: r.label, bars: podBars(p, w.window), tag, tone });
    });
  }

  const findings = runs.flatMap((r) => jobFindings(w, r, s));

  const terminal =
    w.show === "jobs"
      ? {
          command: "kubectl get jobs",
          lines: table([
            ["NAME", "STATUS", "COMPLETIONS", "DURATION", "AGE"],
            ...runs.map((r) => [
              r.job,
              r.status,
              r.status === "Complete" ? "1/1" : "0/1",
              // kubectl measures a Job with no completion time up to now.
              human(r.status === "Complete" ? r.end : w.window + r.offset),
              human(w.window + r.offset),
            ]),
          ]),
        }
      : {
          command: "kubectl get pods",
          lines: table([
            ["NAME", "READY", "STATUS", "RESTARTS", "AGE"],
            ...runs.flatMap((r) =>
              r.pods
                .filter((p) => p.ended !== "evicted" && p.ended !== "deadline")
                .map((p) => [
                  p.name,
                  p.ended === "hung" ? "1/1" : "0/1",
                  p.ended === "done" ? "Completed" : p.ended === "hung" ? "Running" : "Error",
                  "0",
                  human(w.window + r.offset - p.start),
                ]),
            ),
          ]),
        };

  return {
    timeline: {
      caption: runs.length > 1 ? "minutes since each Job was created" : "minutes since it was applied",
      from: 0,
      to: w.window,
      ticks: onceTicks(w.window),
      rows,
    },
    terminal,
    ...settle(findings),
  };
};

/* --- a CronJob ------------------------------------------------------------ */

interface CronRun {
  tick: number;
  name: string;
  start: number;
  end: number;
  skipped: boolean;
  killed: boolean;
}

const epochMinute = (day: string, minutes: number): number =>
  Date.parse(`${day}T00:00:00Z`) / 60000 + minutes;

/** Minute-of-day ticks for a schedule whose minute is fixed and hour is a number or `*`. */
const cronTicks = (schedule: string, from: number, to: number): number[] => {
  const [mi, ho] = schedule.trim().split(/\s+/);
  const minute = Number(mi);
  const out: number[] = [];
  for (let h = 0; h < 24; h += 1) {
    if (ho !== "*" && Number(ho) !== h) continue;
    const at = h * 60 + minute;
    if (at >= from && at < to) out.push(at);
  }
  return out;
};

export const simulateCron = (w: CronWorld, s: Settings): CronRun[] => {
  const policy = setting(s, "concurrencyPolicy");
  const sf = clock(w.slow.from);
  const st = clock(w.slow.to);

  const finish = (start: number): number => {
    let t = start;
    let left = w.work;
    for (let guard = 0; guard < 8 && left > 1e-9; guard += 1) {
      const slow = t >= sf && t < st;
      const rate = slow ? 1 / w.slow.factor : 1;
      const edge = slow ? st : t < sf ? sf : Infinity;
      const can = (edge - t) * rate;
      if (can >= left) return t + left / rate;
      left -= can;
      t = edge;
    }
    return t;
  };

  const runs: CronRun[] = [];
  for (const tick of cronTicks(w.schedule, clock(w.from), clock(w.to))) {
    const name = `${w.name}-${epochMinute(w.day, tick)}`;
    const active = runs.filter((r) => !r.skipped && r.start < tick && r.end > tick);
    if (active.length > 0 && policy === "Forbid") {
      runs.push({ tick, name, start: tick, end: tick, skipped: true, killed: false });
      continue;
    }
    if (active.length > 0 && policy === "Replace") {
      for (const r of active) {
        r.end = tick;
        r.killed = true;
      }
    }
    runs.push({ tick, name, start: tick, end: finish(tick), skipped: false, killed: false });
  }
  return runs;
};

const cron = (w: CronWorld, s: Settings): Outcome => {
  const policy = setting(s, "concurrencyPolicy");
  const runs = simulateCron(w, s);
  const real = runs.filter((r) => !r.skipped);
  const findings: Finding[] = [];

  const slowest = [...real].filter((r) => !r.killed).sort((a, b) => b.end - b.start - (a.end - a.start))[0];
  if (slowest && slowest.end - slowest.start > w.work + 1) {
    findings.push({
      tone: "flat",
      text: `${code(slowest.name)} took ${spoken(slowest.end - slowest.start)} instead of ${spoken(w.work)}, because ${w.slow.why}.`,
    });
  }

  for (const [i, a] of real.entries()) {
    for (const b of real.slice(i + 1)) {
      if (!(a.start < b.end && b.start < a.end)) continue;
      findings.push({
        tone: "bad",
        text: `${code(a.name)} and ${code(b.name)} were both writing ${w.writes} from ${hhmm(b.start)} to ${hhmm(Math.min(a.end, b.end))}. With ${code(`concurrencyPolicy: ${policy}`)} nothing stopped the second one starting while the first was still going.`,
      });
    }
  }

  for (const r of real.filter((x) => x.killed)) {
    const successor = real.find((x) => x.tick === r.end);
    findings.push({
      tone: "bad",
      text: `${code(r.name)} was killed at ${hhmm(r.end)} partway through rewriting ${w.writes}, and the file stayed half-written${successor ? ` until ${code(successor.name)} finished at ${hhmm(successor.end)}` : ""}.`,
    });
  }

  for (const r of runs.filter((x) => x.skipped)) {
    const blocker = real.find((x) => x.start < r.tick && x.end > r.tick);
    findings.push({
      tone: "flat",
      text: `The ${hhmm(r.tick)} run never happened, because ${blocker ? code(blocker.name) : "the last run"} was still going. It isn't queued for later, it's skipped.`,
    });
  }

  if (!findings.some((f) => f.tone === "bad")) {
    findings.push({
      tone: "good",
      text: `No two runs overlapped and nothing was killed partway, so ${w.writes} was only ever written by one sync at a time, start to finish.`,
    });
  }

  const overlapping = new Set<string>();
  for (const [i, a] of real.entries()) {
    for (const b of real.slice(i + 1)) {
      if (a.start < b.end && b.start < a.end) {
        overlapping.add(a.name);
        overlapping.add(b.name);
      }
    }
  }

  const from = clock(w.from);
  const to = clock(w.to);
  const ticks: { at: number; label: string }[] = [];
  for (let at = Math.ceil(from / 60) * 60; at <= to; at += 60) ticks.push({ at, label: hhmm(at) });

  const rows: Row[] = runs.map((r) => {
    if (r.skipped) {
      return { label: "no Job", sub: hhmm(r.tick), bars: [], skipAt: r.tick, tag: "skipped", tone: "flat" };
    }
    const tag = r.killed ? "killed" : overlapping.has(r.name) ? "overlapped" : "Complete";
    return {
      label: r.name,
      sub: hhmm(r.tick),
      bars: [
        {
          from: r.start,
          to: Math.min(r.end, to),
          state: "run",
          end: r.killed ? "killed" : undefined,
          open: r.end > to,
          title: `${r.name}, ${hhmm(r.start)} to ${hhmm(r.end)}${r.killed ? ", killed" : ""}`,
        },
      ],
      tag,
      tone: r.killed || overlapping.has(r.name) ? "bad" : "good",
    };
  });

  return {
    timeline: { caption: `${w.day}, UTC`, from, to, ticks, rows },
    ...settle(findings),
  };
};

/* --- the clock ------------------------------------------------------------ */

const partsIn = (ms: number, zone: string): { y: number; mo: number; d: number; h: number; mi: number } => {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(ms))) p[part.type] = part.value;
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute) };
};

/** Minutes the zone is ahead of UTC at an instant. */
const offsetAt = (ms: number, zone: string): number => {
  const p = partsIn(ms, zone);
  return (Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - Math.floor(ms / 60000) * 60000) / 60000;
};

/** The instant a wall-clock time happens in a zone on a date. */
const wallToInstant = (date: string, minutes: number, zone: string): number => {
  const naive = Date.parse(`${date}T00:00:00Z`) + minutes * 60000;
  const guess = naive - offsetAt(naive, zone) * 60000;
  return naive - offsetAt(guess, zone) * 60000;
};

export const simulateClock = (w: ClockWorld, s: Settings): { label: string; local: number }[] => {
  const [mi, ho] = setting(s, "schedule").trim().split(/\s+/);
  const minutes = Number(ho) * 60 + Number(mi);
  const tz = setting(s, "timeZone");
  const zone = tz === "none" ? w.controllerZone : tz;
  return w.days.map((day) => {
    const p = partsIn(wallToInstant(day.date, minutes, zone), w.zone);
    return { label: day.label, local: p.h * 60 + p.mi };
  });
};

const clockRound = (w: ClockWorld, s: Settings): Outcome => {
  const schedule = setting(s, "schedule");
  const tz = setting(s, "timeZone");
  const target = clock(w.at);
  const times = simulateClock(w, s);
  const findings: Finding[] = [];

  if (times.every((t) => t.local === target)) {
    findings.push({
      tone: "good",
      text: `It went out at ${w.at} ${w.place} time on both days, before and after the clocks went back on ${w.clocksChange}.`,
    });
  } else {
    const said =
      new Set(times.map((t) => t.local)).size === 1
        ? `${hhmm(times[0]?.local ?? 0)} on both days`
        : list(times.map((t) => `${hhmm(t.local)} on ${t.label}`));
    const [mi, ho] = schedule.split(/\s+/);
    const why =
      tz === "none"
        ? `${code(schedule)} is read on the controller's clock, and that's ${w.controllerZone}.${
            new Set(times.map((t) => t.local)).size > 1
              ? ` ${w.place} changed its clocks on ${w.clocksChange} and ${w.controllerZone} doesn't have clocks to change.`
              : ""
          }`
        : `With ${code(`timeZone: ${tz}`)} the schedule is already ${w.place} time, so ${code(schedule)} means ${hhmm(Number(ho) * 60 + Number(mi))} there.`;
    findings.push({ tone: "bad", text: `It went out at ${said}, ${w.place} time. ${why}` });
  }

  const from = target - 180;
  const to = target + 180;
  const ticks: { at: number; label: string }[] = [];
  for (let at = from; at <= to; at += 60) ticks.push({ at, label: hhmm(at) });

  return {
    timeline: {
      caption: `${w.place} time`,
      from,
      to,
      target,
      ticks,
      rows: times.map((t) => ({
        label: t.label,
        bars: [{ from: t.local, to: t.local + w.work, state: "run", title: `sent at ${hhmm(t.local)}` }],
        tag: hhmm(t.local),
        tone: t.local === target ? "good" : "bad",
      })),
    },
    ...settle(findings),
  };
};

/* --- the account ---------------------------------------------------------- */

export const run = (round: Round, s: Settings): Outcome => {
  const w = round.world;
  if (w.type === "cron") return cron(w, s);
  if (w.type === "clock") return clockRound(w, s);
  return setting(s, "kind") === "Deployment" ? crashLoop(w) : onceJob(w, s);
};

/* --- the manifest --------------------------------------------------------- */

export interface Line {
  text: string;
  /** The field this line renders, so the view can mark what the reader controls. */
  field?: FieldId;
}

const containers = (lines: Line[], indent: string, name: string, image: string, args?: string[]): void => {
  lines.push({ text: `${indent}containers:` });
  lines.push({ text: `${indent}  - name: ${name}` });
  lines.push({ text: `${indent}    image: ${image}` });
  if (args) lines.push({ text: `${indent}    args: [${args.join(", ")}]`, field: "args" });
};

/**
 * The spec as real YAML. Hand-written per kind, because the nesting is part of
 * what the reader is learning: a CronJob holds a Job template which holds a pod
 * template, and `concurrencyPolicy` sits two levels above anything a pod reads.
 */
export const manifest = (round: Round, s: Settings): Line[] => {
  const w = round.world;
  const lines: Line[] = [];
  const put = (text: string, field?: FieldId): void => {
    lines.push({ text, field });
  };

  if (w.type === "once") {
    const kind = setting(s, "kind");
    const knob = round.fields.some((f) => f.id === "kind") ? "kind" : undefined;
    const has = (id: FieldId): boolean => round.fields.some((f) => f.id === id);
    put(`kind: ${kind}`, knob);
    put(`metadata:`);
    put(`  name: ${w.name}`);
    put(`spec:`);
    if (kind === "Deployment") {
      put(`  replicas: 1`);
      put(`  selector:`);
      put(`    matchLabels:`);
      put(`      app: ${w.name}`);
      put(`  template:`);
      put(`    metadata:`);
      put(`      labels:`);
      put(`        app: ${w.name}`);
      put(`    spec:`);
      containers(lines, "      ", w.name, w.image);
      return lines;
    }
    if (has("backoffLimit")) put(`  backoffLimit: ${setting(s, "backoffLimit")}`, "backoffLimit");
    if (has("activeDeadlineSeconds")) {
      const dl = setting(s, "activeDeadlineSeconds");
      put(dl === "none" ? `  # no activeDeadlineSeconds` : `  activeDeadlineSeconds: ${dl}`, "activeDeadlineSeconds");
    }
    put(`  template:`);
    put(`    spec:`);
    put(`      restartPolicy: Never`, knob);
    const args = w.args ? [...w.args.base, ...(setting(s, "args") === "skip" ? [w.args.skip] : [])] : undefined;
    containers(lines, "      ", w.name, w.image, args);
    return lines;
  }

  put(`kind: CronJob`);
  put(`metadata:`);
  put(`  name: ${w.name}`);
  put(`spec:`);
  if (w.type === "cron") {
    put(`  schedule: "${w.schedule}"`);
    put(`  concurrencyPolicy: ${setting(s, "concurrencyPolicy")}`, "concurrencyPolicy");
  } else {
    put(`  schedule: "${setting(s, "schedule")}"`, "schedule");
    const tz = setting(s, "timeZone");
    put(tz === "none" ? `  # no timeZone` : `  timeZone: ${tz}`, "timeZone");
  }
  put(`  jobTemplate:`);
  put(`    spec:`);
  put(`      template:`);
  put(`        spec:`);
  put(`          restartPolicy: Never`);
  containers(lines, "          ", w.name, w.image);
  return lines;
};
