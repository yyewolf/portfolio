// The six playable levels, plus the world the automatic finale runs on.
//
// A scenario is data wherever it can be, and a function only where the world
// has to do something the engine cannot guess: an opening failure, a machine
// dying, a server that comes back at the worst possible moment. Adding a level
// means adding an entry here and nothing else.

import type { ActionKind, Machine, Server, Spec, World } from "./engine";
import { fail, note, serverOf } from "./engine";

export interface Question {
  prompt: string;
  options: { text: string; reply: string; right: boolean }[];
}

/** A world change the level plays on its own, so the player watches it land. */
export interface Beat {
  delay: number;
  run: (w: World) => void;
}

export interface Scenario {
  id: string;
  title: string;
  brief: string;
  desired: Spec;
  machines: Machine[];
  servers: Server[];
  seq: number;
  actions: ActionKind[];
  chooseMachine: boolean;
  showMachines: boolean;
  script: Beat[];
  /** Runs after every settled move. Where a level gets to be unfair. */
  onSettle?: (w: World) => void;
  debrief: string[];
  question?: Question;
}

const server = (id: string, machine: string, extra: Partial<Server> = {}): Server => ({
  id,
  machine,
  status: "running",
  uptime: 60 * (17 + id.charCodeAt(id.length - 1) % 7),
  cpu: 9 + (id.charCodeAt(id.length - 1) % 5) * 4,
  restartRecovers: true,
  ...extra,
});

const oneMachine: Machine[] = [{ id: "node-a", status: "ready", capacity: 8 }];

const web: Spec = { label: "Web servers", replicas: 3 };

export const scenarios: Scenario[] = [
  {
    id: "missing",
    title: "Something went away",
    brief: "Three web servers, all healthy. Keep it that way.",
    desired: web,
    machines: oneMachine,
    servers: [server("server-01", "node-a"), server("server-02", "node-a"), server("server-03", "node-a")],
    seq: 3,
    actions: ["create", "restart", "observe", "wait"],
    chooseMachine: false,
    showMachines: false,
    script: [
      {
        delay: 1600,
        run: (w) => {
          const s = serverOf(w, "server-02");
          if (s) s.restartRecovers = false;
          fail(w, "server-02", "server-02 stopped responding.");
        },
      },
    ],
    debrief: [
      "Three running again.",
      "You did not repair server-02. You replaced what it was doing, which is a different move, and on most days a cheaper one.",
    ],
  },
  {
    id: "surplus",
    title: "One too many",
    brief: "Same specification. Three web servers.",
    desired: web,
    machines: oneMachine,
    servers: [server("server-01", "node-a"), server("server-02", "node-a"), server("server-03", "node-a")],
    seq: 3,
    actions: ["create", "delete", "observe", "wait"],
    chooseMachine: false,
    showMachines: false,
    script: [
      {
        delay: 1600,
        run: (w) => {
          w.seq += 1;
          w.servers.push(server("server-04", "node-a", { uptime: 0, cpu: 6 }));
          note(w, "server-04 was started by hand.", "world");
        },
      },
    ],
    debrief: [
      "The specification is a number, not a minimum.",
      "Four is as wrong as two. The interesting part is that the fix ran in the opposite direction and you worked that out from the same two panels.",
    ],
  },
  {
    id: "quiet",
    title: "An event arrives",
    brief: "Three web servers. An event is on its way.",
    desired: web,
    machines: oneMachine,
    servers: [server("server-01", "node-a"), server("server-02", "node-a"), server("server-03", "node-a")],
    seq: 3,
    actions: ["create", "delete", "restart", "observe", "wait"],
    chooseMachine: false,
    showMachines: false,
    script: [
      { delay: 1500, run: (w) => note(w, "server-02 restarted successfully.", "world") },
    ],
    debrief: [
      "Nothing was broken, so nothing needed doing.",
      "The event was true and useless at the same time. It told you about a restart that had already finished.",
    ],
    question: {
      prompt: "What were you actually doing in that level?",
      options: [
        {
          text: "Answering the event",
          right: false,
          reply: "That is what an event invites you to do. This one reported a restart that had already succeeded, so answering it would have meant breaking something that worked.",
        },
        {
          text: "Making the list match the number",
          right: true,
          reply: "Yes. The event was a notification. The number was the job.",
        },
        {
          text: "Waiting for a clearer signal",
          right: false,
          reply: "No clearer signal was coming. The state was already readable, and already correct.",
        },
        {
          text: "Restarting things until they looked healthy",
          right: false,
          reply: "They were healthy. Restarting a working server takes it out of service for a few seconds and buys nothing.",
        },
      ],
    },
  },
  {
    id: "noise",
    title: "Six events",
    brief: "Three web servers. The feed is about to get busy.",
    desired: web,
    machines: oneMachine,
    servers: [server("server-01", "node-a"), server("server-02", "node-a"), server("server-03", "node-a")],
    seq: 3,
    actions: ["create", "delete", "restart", "observe", "wait"],
    chooseMachine: false,
    showMachines: false,
    script: [
      { delay: 1200, run: (w) => note(w, "server-01 restarted.", "world") },
      { delay: 2400, run: (w) => note(w, "server-03 changed status.", "world") },
      { delay: 3400, run: (w) => note(w, "server-02 reported high CPU.", "world") },
      {
        delay: 4600,
        run: (w) => {
          w.seq += 1;
          w.servers.push(server("server-04", "node-a", { uptime: 0, cpu: 3 }));
          note(w, "server-04 was started.", "world");
        },
      },
      {
        delay: 6200,
        run: (w) => {
          w.servers = w.servers.filter((s) => s.id !== "server-04");
          note(w, "server-04 was stopped.", "world");
        },
      },
      { delay: 7400, run: (w) => note(w, "server-03 restarted.", "world") },
    ],
    debrief: [
      "Six events, no problem to solve.",
      "One of them even took the count to four for about a second and a half. If you had answered each event as it arrived you would have spent the level making the system worse than you found it.",
    ],
  },
  {
    id: "race",
    title: "While you were working",
    brief: "Three web servers. Something is about to give.",
    desired: web,
    machines: oneMachine,
    servers: [server("server-01", "node-a"), server("server-02", "node-a"), server("server-03", "node-a")],
    seq: 3,
    actions: ["create", "delete", "observe", "wait"],
    chooseMachine: false,
    showMachines: false,
    script: [{ delay: 1400, run: (w) => fail(w, "server-03", "server-03 stopped responding.") }],
    onSettle: (w) => {
      const old = serverOf(w, "server-03");
      if (!w.flags.recovered && old && old.status === "failed" && w.servers.length > 3) {
        old.status = "running";
        old.uptime = 0;
        old.cpu = 12;
        w.flags.recovered = 1;
        note(w, "server-03 recovered on its own.", "world");
      }
    },
    debrief: [
      "You acted on a count that stopped being true while you were acting on it.",
      "The answer is not to move faster. server-03 was coming back whether you were quick or not. The answer is to look again after every change you make.",
    ],
    question: {
      prompt: "Your reading said two running. Why did it stop being true?",
      options: [
        {
          text: "The world kept moving while you acted",
          right: true,
          reply: "Yes. Your observation was a snapshot, and it expired the moment you looked away.",
        },
        { text: "You misread the panel", right: false, reply: "You read it correctly. It was correct when you read it." },
        {
          text: "The system reported the wrong thing",
          right: false,
          reply: "Nothing reported wrongly. server-03 came back on its own, which is an ordinary thing for a machine to do.",
        },
        {
          text: "You were too slow",
          right: false,
          reply: "Speed was not the problem. Starting a server takes time, and things happen during that time.",
        },
      ],
    },
  },
  {
    id: "machine",
    title: "A machine goes down",
    brief: "Three web servers, spread across two machines. Servers live on machines, and machines fail too.",
    desired: web,
    machines: [
      { id: "node-a", status: "ready", capacity: 2 },
      { id: "node-b", status: "ready", capacity: 3 },
    ],
    servers: [server("server-01", "node-a"), server("server-02", "node-a"), server("server-03", "node-b")],
    seq: 3,
    actions: ["create", "delete", "observe", "wait"],
    chooseMachine: true,
    showMachines: true,
    script: [
      {
        delay: 1800,
        run: (w) => {
          const m = w.machines.find((x) => x.id === "node-a");
          if (m) m.status = "failed";
          for (const s of w.servers) {
            if (s.machine === "node-a" && s.status === "running") {
              s.status = "unavailable";
              s.cpu = 0;
            }
          }
          note(w, "node-a stopped answering. Everything on it is unreachable.", "world");
        },
      },
    ],
    debrief: [
      "One machine took two servers with it.",
      "You could not fix node-a from here, and nothing you did to those two servers would have helped. What you could do was put the same work somewhere that still had room.",
    ],
  },
];

/** The world the automatic finale runs on. Same rules, no player. */
export const autoScenario: Scenario = {
  id: "auto",
  title: "Automatic",
  brief: "Three web servers, all healthy, and you are no longer the one fixing them.",
  desired: web,
  machines: oneMachine,
  servers: [server("server-01", "node-a"), server("server-02", "node-a"), server("server-03", "node-a")],
  seq: 3,
  actions: [],
  chooseMachine: false,
  showMachines: false,
  script: [],
  debrief: [],
};
