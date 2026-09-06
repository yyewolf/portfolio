// The five breakages of lesson 1, as data.
//
// This is not the lesson 2 engine and deliberately does not reuse it. There,
// the player operates a live world and the whole point is that they cannot see
// it without asking. Here the world is always visible and the player is not
// operating anything: they are choosing what to build after each outage. Three
// fixed snapshots per stage (calm, broken, repaired) is the entire model, so
// there is no simulation to get wrong.
//
// **Vocabulary is constrained on purpose.** This lesson runs before the game,
// so nothing here may say "Kubernetes", "cluster", "reconciliation", "control
// loop", "desired state" or "actual state", and nothing may describe the
// observe/compare/act/look-again discipline. Naming the *job* is fine and the
// lesson prose already does; naming the *method* would spoil what lesson 2
// makes the player work out. See AGENTS.md, "Phase 1 withholds the answer".

export type ChipState = "ok" | "gone" | "old" | "new" | "bad" | "starting";

export interface Chip {
  id: string;
  state: ChipState;
}

export interface Box {
  id: string;
  state: "up" | "down";
  chips: Chip[];
}

/** A caller holding an address, drawn under the machines when a stage needs it. */
export interface Caller {
  label: string;
  target: string;
  state: "ok" | "lost";
}

export interface Snapshot {
  boxes: Box[];
  caller?: Caller;
  /** Compact chips once a stage has more of them than labels can fit. */
  dense?: boolean;
}

export interface Option {
  text: string;
  right: boolean;
  /**
   * What actually happens if you pick this. Wrong answers describe a real
   * consequence rather than saying "wrong", because every wrong answer here is
   * something a reasonable person would try.
   */
  reply: string;
}

/** A card added to the running tally. `scope` is what stage two gets to kill. */
export interface Built {
  id: string;
  label: string;
  sub: string;
  scope: "machine" | "fleet";
}

export interface Stage {
  n: number;
  title: string;
  /** One line of setup, shown above the diagram before anything breaks. */
  setup: string;
  calm: Snapshot;
  broken: Snapshot;
  fixed: Snapshot;
  /** Headline of the outage, shown when the breakage lands. */
  event: string;
  detail: string;
  /** Ids of already-built cards this outage destroys. */
  defeats?: string[];
  options: Option[];
  built: Built[];
}

const chips = (n: number, state: ChipState = "ok", from = 1): Chip[] =>
  Array.from({ length: n }, (_, i) => ({ id: `web-${from + i}`, state }));

export const stages: Stage[] = [
  {
    n: 1,
    title: "The container dies",
    setup: "One machine, one container, serving traffic.",
    calm: { boxes: [{ id: "node-a", state: "up", chips: chips(1) }] },
    broken: {
      boxes: [{ id: "node-a", state: "up", chips: [{ id: "web-1", state: "gone" }] }],
    },
    fixed: { boxes: [{ id: "node-a", state: "up", chips: chips(1) }] },
    event: "web-1 exited",
    detail:
      "The process inside it crashed. The machine is fine, Docker is fine, and there is nothing running.",
    options: [
      {
        text: "Start it again yourself, and keep an eye on it.",
        right: false,
        reply:
          "It comes back. It also crashes again at three in the morning, and you are asleep. Something on that machine has to do this without you.",
      },
      {
        text: "Tell Docker to always restart it.",
        right: true,
        reply:
          "`--restart=always`, and the Docker daemon notices the exit and starts it again. This one is free: you did not build it, and it was already there.",
      },
      {
        text: "Run a second copy, so there is always a spare.",
        right: false,
        reply:
          "Now two containers can crash instead of one, and nothing restarts either of them. You doubled the thing that breaks without adding anything that fixes it.",
      },
    ],
    built: [
      {
        id: "restart",
        label: "A restart policy",
        sub: "Docker's daemon watches the container and starts it again.",
        scope: "machine",
      },
    ],
  },

  {
    n: 2,
    title: "The machine dies",
    setup: "Same machine, now with the restart policy on it.",
    calm: { boxes: [{ id: "node-a", state: "up", chips: chips(1) }] },
    broken: { boxes: [{ id: "node-a", state: "down", chips: [{ id: "web-1", state: "gone" }] }] },
    fixed: {
      boxes: [
        { id: "node-a", state: "down", chips: [] },
        { id: "node-b", state: "up", chips: chips(1) },
      ],
    },
    event: "node-a stopped responding",
    detail:
      "Not the container this time. The whole machine. The daemon that was going to restart anything died with it.",
    defeats: ["restart"],
    options: [
      {
        text: "Wait. It will probably come back.",
        right: false,
        reply:
          "It might. It might also be gone for six hours, and you have no way to tell which from here. Either way you are down for the length of it.",
      },
      {
        text: "Add a second machine, and let each one restart its own containers.",
        right: false,
        reply:
          "Closer, but nothing tells the second machine to pick up what the first one was running. Each machine only knows about itself, and neither of them knows what the pair is supposed to add up to.",
      },
      {
        text: "Write down what should be running, off both machines, and have something act on it.",
        right: true,
        reply:
          "Now the note survives any single machine, and something outside them both can act on it: it can see that web-1 is missing and start it on the machine still standing.",
      },
    ],
    built: [
      {
        id: "note",
        label: "A note of what should be running",
        sub: "Kept off any single machine, so losing one does not lose the plan.",
        scope: "fleet",
      },
      {
        id: "fixer",
        label: "Something that checks the note and fixes gaps",
        sub: "Runs outside the machines, because it has to outlive any one of them.",
        scope: "fleet",
      },
    ],
  },

  {
    n: 3,
    title: "One is not enough",
    setup: "Two machines, one container, and a third machine you just added.",
    calm: {
      boxes: [
        { id: "node-a", state: "up", chips: chips(1) },
        { id: "node-b", state: "up", chips: [] },
        { id: "node-c", state: "up", chips: [] },
      ],
    },
    broken: {
      boxes: [
        { id: "node-a", state: "up", chips: chips(1) },
        { id: "node-b", state: "up", chips: [] },
        { id: "node-c", state: "up", chips: [] },
      ],
    },
    fixed: {
      dense: true,
      boxes: [
        { id: "node-a", state: "up", chips: chips(3) },
        { id: "node-b", state: "up", chips: chips(4, "ok", 4) },
        { id: "node-c", state: "up", chips: chips(3, "ok", 8) },
      ],
    },
    event: "Traffic tripled",
    detail:
      "One copy cannot carry it. You need ten, and they cannot all sit on one machine or losing that machine costs you everything again.",
    options: [
      {
        text: "Put all ten on node-a. It is the biggest.",
        right: false,
        reply:
          "Ten copies, one machine, and you have walked straight back into the last outage with ten times as much to lose.",
      },
      {
        text: "Spread them evenly. Three, three, four.",
        right: false,
        reply:
          "Even works until node-c fills up with something else, or the copies stop being the same size, or a machine dies and its share has to go somewhere. Even is a rule about the copies. What you need is a rule about the room.",
      },
      {
        text: "Track what room each machine has left, and put each copy where it fits.",
        right: true,
        reply:
          "That is a scheduler, and you are the one writing it. It runs when a copy is added, and again every time a machine dies and everything it held needs somewhere new to go.",
      },
    ],
    built: [
      {
        id: "sched",
        label: "A scheduler",
        sub: "Places each copy on a machine with room, and places them again when one dies.",
        scope: "fleet",
      },
    ],
  },

  {
    n: 4,
    title: "They need updating",
    setup: "Ten copies across three machines, all running the same image.",
    calm: {
      dense: true,
      boxes: [
        { id: "node-a", state: "up", chips: chips(3, "old") },
        { id: "node-b", state: "up", chips: chips(4, "old", 4) },
        { id: "node-c", state: "up", chips: chips(3, "old", 8) },
      ],
    },
    broken: {
      dense: true,
      boxes: [
        { id: "node-a", state: "up", chips: chips(3, "old") },
        { id: "node-b", state: "up", chips: chips(4, "old", 4) },
        { id: "node-c", state: "up", chips: chips(3, "old", 8) },
      ],
    },
    fixed: {
      dense: true,
      boxes: [
        { id: "node-a", state: "up", chips: [...chips(2, "new"), { id: "web-3", state: "old" }] },
        { id: "node-b", state: "up", chips: chips(4, "old", 4) },
        { id: "node-c", state: "up", chips: chips(3, "old", 8) },
      ],
    },
    event: "A new image is ready",
    detail: "Ten copies are running the old one. All ten have to become the new one.",
    options: [
      {
        text: "Stop all ten, then start ten new ones.",
        right: false,
        reply:
          "That is an outage, and you scheduled it yourself. Between the stop and the start there is nothing serving anybody.",
      },
      {
        text: "Replace them one at a time, as fast as it will go.",
        right: false,
        reply:
          "No outage, and still bad. Nothing is checking, so if the new image is broken you will calmly and efficiently replace all ten working copies with ten that do not work.",
      },
      {
        text: "Replace a few at a time, and only keep going while the new ones look healthy.",
        right: true,
        reply:
          "Which means the containers now need some way to say whether they are healthy, and you need a point where you stop. Stopped half-updated is worse than either end, so you also need a way back to the old image.",
      },
    ],
    built: [
      {
        id: "rollout",
        label: "A rollout",
        sub: "Replaces copies gradually, checks that the new ones work, stops if they do not.",
        scope: "fleet",
      },
    ],
  },

  {
    n: 5,
    title: "Callers have to find them",
    setup: "Ten copies, mid-rollout, moving between machines as they are replaced.",
    calm: {
      dense: true,
      boxes: [
        { id: "node-a", state: "up", chips: chips(3, "new") },
        { id: "node-b", state: "up", chips: chips(4, "new", 4) },
        { id: "node-c", state: "up", chips: chips(3, "new", 8) },
      ],
      caller: { label: "billing", target: "10.0.3.7", state: "ok" },
    },
    broken: {
      dense: true,
      boxes: [
        { id: "node-a", state: "up", chips: chips(3, "new") },
        { id: "node-b", state: "up", chips: chips(4, "new", 4) },
        { id: "node-c", state: "up", chips: chips(3, "new", 8) },
      ],
      caller: { label: "billing", target: "10.0.3.7", state: "lost" },
    },
    fixed: {
      dense: true,
      boxes: [
        { id: "node-a", state: "up", chips: chips(3, "new") },
        { id: "node-b", state: "up", chips: chips(4, "new", 4) },
        { id: "node-c", state: "up", chips: chips(3, "new", 8) },
      ],
      caller: { label: "billing", target: "web", state: "ok" },
    },
    event: "billing is calling an address that is gone",
    detail:
      "10.0.3.7 was one of the copies your rollout replaced. Its address went with it, and billing had written that address down.",
    options: [
      {
        text: "Give every copy a permanent address.",
        right: false,
        reply:
          "Copies are created and destroyed constantly, on whichever machine had room at the time. A permanent address is not something a temporary copy can own.",
      },
      {
        text: "Have each caller keep a list of the copies and retry the ones that fail.",
        right: false,
        reply:
          "Now every caller in your system implements the same list, and each one is stale at a different moment in a different way. You have moved the problem into code you do not control.",
      },
      {
        text: "One name, resolved when it is used, to whichever copies are alive right now.",
        right: true,
        reply:
          "And resolving it has to leave out the copies that are starting, dying, or failing the health check you added in the last step.",
      },
    ],
    built: [
      {
        id: "naming",
        label: "A name that resolves to live copies",
        sub: "Stable for callers, while everything behind it keeps changing.",
        scope: "fleet",
      },
    ],
  },
];
