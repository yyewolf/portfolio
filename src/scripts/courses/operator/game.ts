// Runner and view for the lesson 1 operator game.
//
// Two ideas drive the whole file.
//
// The world is the truth, and the player does not get to see it. What the "what
// we have" panel shows is a `Reading`: a copy of the world taken the last time
// the player asked for one. Events arrive on their own and say that something
// happened, but they never refresh the panel. Only a read does. That is the
// lesson, expressed as a UI rule rather than a paragraph.
//
// The frame is built once and never torn down. Levels, debriefs and the closing
// screens all swap the body of the same shell, under the same progress rail, so
// the whole thing reads as one machine changing contents rather than nine
// separate screens.

import {
  apply,
  converged,
  gap,
  note,
  running,
  serverOf,
  settle,
  stamp,
  type ActionKind,
  type Machine,
  type Server,
  type Status,
  type World,
} from "./engine";
import { autoScenario, scenarios, type Question, type Scenario } from "./scenarios";

type Phase = "intro" | "play" | "debrief" | "quiz" | "loop" | "word" | "map" | "auto" | "eventual" | "done";

/** What the player last saw. Not what is true. */
interface Reading {
  at: number;
  feedAt: number;
  servers: Server[];
  machines: Machine[];
}

interface Refs {
  turn: HTMLElement;
  turnLabel: HTMLElement;
  turnNote: HTMLElement;
  turnCount: HTMLElement;
  readAt: HTMLElement;
  tally: HTMLElement;
  have: HTMLElement;
  count: HTMLElement;
  detail: HTMLElement;
  feed: HTMLElement;
  actions: HTMLElement;
  hint: HTMLElement;
  cards: HTMLElement;
  history: HTMLElement;
}

const STATUS: Record<Status, { label: string; glyph: string }> = {
  running: { label: "Running", glyph: "●" },
  starting: { label: "Starting", glyph: "◍" },
  failed: { label: "Failed", glyph: "✕" },
  unavailable: { label: "Unreachable", glyph: "⊘" },
  pending: { label: "Waiting", glyph: "○" },
};

const ACTION_LABEL: Record<ActionKind, string> = {
  create: "Create server",
  delete: "Delete server",
  restart: "Restart server",
  observe: "Read the state",
  wait: "Do nothing",
};

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const minutes = (sec: number): string => {
  const m = Math.floor(sec / 60);
  return m > 0 ? `${m}m ${sec % 60}s` : `${sec}s`;
};

function seed(scenario: Scenario): World {
  return {
    desired: { ...scenario.desired },
    machines: scenario.machines.map((m) => ({ ...m })),
    servers: scenario.servers.map((s) => ({ ...s })),
    feed: [],
    log: [],
    selected: null,
    clock: 0,
    seq: scenario.seq,
    flags: {},
    moves: 0,
    actor: "You",
  };
}

class Game {
  private stage: HTMLElement;
  private body: HTMLElement | null = null;
  private head: HTMLElement | null = null;
  private rail: HTMLElement | null = null;
  private phase: Phase = "intro";
  private level = 0;
  private scenario: Scenario = scenarios[0];
  private world: World = seed(scenarios[0]);
  private seen: Reading = { at: 0, feedAt: 0, servers: [], machines: [] };
  private refs: Refs | null = null;
  /** What the game said back to the last click. It stands until the next one. */
  private said: { text: string; warn: boolean } | null = null;
  private cleared = new Set<number>();
  private timers: number[] = [];
  private pending = 0;
  private busy = false;
  private feedTop = "";
  /** True when the player has acted but has not read the state since. */
  private unseenMove = false;
  private turnSig = "";
  private loopStep = -1;
  private loopNote = "";
  private autoOn = false;
  private autoSig = "";
  private repaired = 0;
  private stats = { moves: 0, reads: 0, needless: 0, worse: 0 };
  private nextHref: string;
  private nextTitle: string;

  constructor(root: HTMLElement) {
    this.nextHref = root.dataset.nextHref ?? "";
    this.nextTitle = root.dataset.nextTitle ?? "the next lesson";
    const stage = root.querySelector<HTMLElement>("[data-op-stage]");
    if (!stage) throw new Error("operator game: no stage element");
    this.stage = stage;
    this.stage.addEventListener("click", (e) => this.onClick(e));
    document.addEventListener("keydown", this.onKey);
  }

  /**
   * R reads the state. The one action worth a shortcut, because it is the one
   * the player takes most and the one the whole lesson is about. Advertised on
   * the button itself, so it is a shortcut rather than a secret.
   */
  private onKey = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key !== "r" && e.key !== "R") return;
    const el = document.activeElement as HTMLElement | null;
    if (el?.isContentEditable || (el && /^(input|textarea|select)$/i.test(el.tagName))) return;
    if (this.phase !== "play" || this.busy || !this.scenario.actions.includes("observe")) return;
    e.preventDefault();
    this.observe();
  };

  // --- scheduling ------------------------------------------------------

  private after(ms: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, ms));
  }

  private clearTimers(): void {
    this.timers.forEach((t) => window.clearTimeout(t));
    this.timers = [];
    this.pending = 0;
  }

  destroy(): void {
    this.clearTimers();
    document.removeEventListener("keydown", this.onKey);
  }

  // --- the frame -------------------------------------------------------

  /** Built once, then only its body changes. This is what makes it feel like one thing. */
  private mountShell(): void {
    if (this.body) return;
    this.stage.innerHTML = `
      <div class="op-shell">
        <div class="op-head">
          <ol class="op-rail" data-op-rail aria-label="Lesson progress"></ol>
          <div class="op-headline">
            <span class="op-step" data-op-step></span>
            <h3 class="op-title" data-op-title></h3>
            <p class="op-brief" data-op-brief></p>
          </div>
        </div>
        <div class="op-body" data-op-body></div>
      </div>`;
    this.body = this.stage.querySelector<HTMLElement>("[data-op-body]");
    this.head = this.stage.querySelector<HTMLElement>(".op-headline");
    this.rail = this.stage.querySelector<HTMLElement>("[data-op-rail]");
  }

  private paintRail(): void {
    if (!this.rail) return;
    const tail: Partial<Record<Phase, string>> = {
      loop: "What it was",
      word: "What it was",
      map: "What it was",
      auto: "Automatic",
      eventual: "Eventually",
      done: "Done",
    };
    const tailLabel = tail[this.phase];
    const cells = scenarios.map((s, i) => {
      const state = this.cleared.has(i)
        ? "done"
        : i === this.level && (this.phase === "play" || this.phase === "debrief" || this.phase === "quiz")
          ? "current"
          : "todo";
      return `<li data-state="${state}"><span aria-hidden="true">${state === "done" ? "✓" : i + 1}</span><span class="op-sr">Level ${i + 1}, ${esc(s.title)}, ${state === "done" ? "done" : state === "current" ? "in progress" : "not started"}</span></li>`;
    });
    cells.push(
      `<li data-state="${tailLabel ? "current" : "todo"}" data-wide><span>${tailLabel ?? "What it was"}</span></li>`
    );
    this.rail.innerHTML = cells.join("");
  }

  private setHead(step: string, title: string, brief: string): void {
    if (!this.head) return;
    const q = <T extends HTMLElement>(sel: string): T | null => this.head?.querySelector<T>(sel) ?? null;
    const stepEl = q("[data-op-step]");
    const titleEl = q("[data-op-title]");
    const briefEl = q("[data-op-brief]");
    if (stepEl) stepEl.textContent = step;
    if (titleEl) titleEl.textContent = title;
    if (briefEl) briefEl.textContent = brief;
    this.paintRail();
  }

  /**
   * Swaps the body contents with an enter animation, keeping the frame put.
   * The mode drives the body's padding: a board is a grid of panels that carry
   * their own edges, a screen is prose that needs room around it.
   */
  private setBody(html: string, mode: "board" | "screen"): void {
    if (!this.body) return;
    this.refs = null;
    this.body.dataset.mode = mode;
    this.body.innerHTML = html;
    this.body.classList.remove("op-entering");
    void this.body.offsetWidth;
    this.body.classList.add("op-entering");
    this.frameIntoView();
  }

  /**
   * Puts the top of the shell just under the site header after a swap, so a new
   * level starts with the rail, the title and the panels all in view rather
   * than wherever the previous level's scroll position left the page.
   *
   * The site header is `position: fixed`, so its height has to come off the
   * target or the rail ends up behind it. Measured rather than hardcoded.
   */
  private frameIntoView(): void {
    const shell = this.stage.querySelector<HTMLElement>(".op-shell");
    if (!shell) return;
    const chrome =
      document.querySelector<HTMLElement>("body > header") ?? document.querySelector<HTMLElement>("header");
    const offset = (chrome?.offsetHeight ?? 0) + 16;
    const top = shell.getBoundingClientRect().top;
    // Already where we would put it. Moving the page a few pixels reads as a glitch.
    if (Math.abs(top - offset) < 8) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
      top: Math.max(0, top + window.scrollY - offset),
      behavior: reduced ? "auto" : "smooth",
    });
  }

  private screen(html: string): void {
    this.clearTimers();
    this.setBody(`<div class="op-screen">${html}</div>`, "screen");
  }

  // --- level lifecycle -------------------------------------------------

  private startLevel(index: number): void {
    this.clearTimers();
    this.mountShell();
    this.level = index;
    this.scenario = scenarios[index];
    this.world = seed(this.scenario);
    this.seen = this.read();
    this.said = null;
    this.busy = false;
    this.phase = "play";
    this.feedTop = "";
    this.unseenMove = false;
    this.turnSig = "";
    this.setHead(`Level ${index + 1} of ${scenarios.length}`, this.scenario.title, this.scenario.brief);
    this.mountBoard();
    this.pending = this.scenario.script.length;
    for (const beat of this.scenario.script) {
      this.after(beat.delay, () => {
        beat.run(this.world);
        this.pending -= 1;
        this.paint();
      });
    }
  }

  /** A copy of the world as it is right now. The player only gets these on request. */
  private read(): Reading {
    return {
      at: this.world.clock,
      feedAt: this.world.feed.length,
      servers: this.world.servers.map((s) => ({ ...s })),
      machines: this.world.machines.map((m) => ({ ...m })),
    };
  }

  private staleness(): number {
    return this.world.feed.length - this.seen.feedAt;
  }

  private seenRunning(): number {
    return this.seen.servers.filter((s) => s.status === "running").length;
  }

  private seenGap(): number {
    return this.seenRunning() - this.world.desired.replicas;
  }

  // --- input -----------------------------------------------------------

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement | null;
    const hit = target?.closest<HTMLElement>("[data-go],[data-act],[data-server],[data-pick]");
    if (!hit) return;

    if (hit.dataset.server) {
      // A solved level leaves its last reading on the board under the debrief.
      // Selecting is a play-time and finale-time move only, so that reading is
      // still the one that closed the level.
      if (this.phase !== "play" && this.phase !== "auto") return;
      this.world.selected = this.world.selected === hit.dataset.server ? null : hit.dataset.server;
      this.paint();
      return;
    }
    if (hit.dataset.act) {
      this.move(hit.dataset.act as ActionKind, hit.dataset.machine);
      return;
    }
    if (hit.dataset.pick) {
      this.answer(Number(hit.dataset.pick));
      return;
    }
    this.go(hit.dataset.go ?? "");
  }

  private go(where: string): void {
    switch (where) {
      case "start":
        this.stats = { moves: 0, reads: 0, needless: 0, worse: 0 };
        this.cleared.clear();
        this.startLevel(0);
        break;
      case "next":
        if (this.level + 1 < scenarios.length) this.startLevel(this.level + 1);
        else this.renderLoop();
        break;
      case "quiz":
        this.renderQuiz();
        break;
      case "retry":
        this.startLevel(this.level);
        break;
      case "loop":
        this.renderLoop();
        break;
      case "word":
        this.renderWord();
        break;
      case "map":
        this.renderMap();
        break;
      case "auto":
        this.startAuto();
        break;
      case "eventual":
        this.renderEventual();
        break;
      case "enable":
        this.enableAuto();
        break;
      case "break":
        this.breakOne();
        break;
      case "done":
        this.renderDone();
        break;
      case "continue":
        // The link navigates on its own. This only makes sure the lesson is
        // recorded as finished on the way out, whatever happened on the way in.
        this.announceDone();
        break;
      default:
        break;
    }
  }

  // --- moves -----------------------------------------------------------

  private move(kind: ActionKind, machine?: string): void {
    if (this.busy || this.phase !== "play") return;
    if (kind === "observe") {
      this.observe();
      return;
    }

    // Acting on something the player saw but that has since gone is the most
    // instructive refusal in the game, so it gets its own message.
    if (kind === "delete" || kind === "restart") {
      const id = this.world.selected;
      if (id && !serverOf(this.world, id)) {
        this.said = { text: `${id} was there when you last looked. It is not there now.`, warn: true };
        this.paint();
        return;
      }
    }

    const result = apply(this.world, { kind, machine });
    if (!result.ok) {
      this.said = { text: result.message, warn: false };
      this.paint();
      return;
    }

    this.busy = true;
    this.stats.moves += 1;
    this.paint();

    this.after(680, () => {
      settle(this.world, this.scenario.onSettle);
      this.busy = false;
      this.unseenMove = true;
      this.said = { text: `${result.message} Read the state to see what it did.`, warn: false };
      this.paint();
    });
  }

  /** The only thing that refreshes the view, and the only thing that can end a level. */
  private observe(): void {
    const previous = this.seen;
    this.world.clock += 3;
    this.world.log.push({ at: stamp(this.world.clock), text: `${this.world.actor} read the state`, kind: "you" });
    this.seen = this.read();
    this.stats.reads += 1;
    this.unseenMove = false;
    this.said = null;

    const wanted = this.world.desired.replicas;
    const after = this.seenRunning();
    const before = previous.servers.filter((s) => s.status === "running").length;
    const d = after - wanted;
    if (d !== 0) {
      if (before === wanted && this.world.moves >= 1) this.stats.needless += 1;
      if (Math.abs(d) > Math.abs(before - wanted)) this.stats.worse += 1;
    }
    this.paint();

    if (d === 0 && this.world.moves >= 1 && this.pending === 0) {
      this.phase = "debrief";
      // Repaint under the new phase so the bar reads "solved" and every action
      // goes quiet with it.
      this.paint();
      this.after(900, () => this.renderDebrief());
    }
  }

  // --- board -----------------------------------------------------------

  private mountBoard(): void {
    // Restarting a level is meaningless once the controller has the board, and
    // the retry it would run drops the player back into level six.
    const retry =
      this.phase === "auto" ? "" : `<button type="button" class="op-link" data-go="retry">Start over</button>`;
    const goal =
      this.phase === "auto"
        ? "Nothing here is waiting on you. Watch what the loop does with the same two numbers."
        : "To clear this level: take an action, then read the state and have it show a match.";
    this.setBody(
      `
      <div class="op-turn" data-op-turn data-state="awaiting" role="status">
        <b class="op-turn-label" data-op-turn-label></b>
        <span class="op-turn-note" data-op-turn-note></span>
        <span class="op-turn-count" data-op-turn-count></span>
      </div>

      <div class="op-grid">
        <div class="op-col">
          <section class="op-panel op-panel-want" aria-labelledby="op-want-h">
            <div class="op-panel-head" id="op-want-h">What we want</div>
            <div class="op-panel-body">
              <p class="op-spec">
                <span class="op-spec-count">${this.world.desired.replicas}</span>
                <span class="op-spec-label">${esc(this.world.desired.label.toLowerCase())}, running</span>
              </p>
              <dl class="op-tally" data-op-tally></dl>
              <p class="op-goal">${esc(goal)}</p>
            </div>
          </section>

          <section class="op-panel op-panel-acts" aria-label="Actions">
            <div class="op-panel-head"><span>Actions</span>${retry}</div>
            <div class="op-panel-body">
              <div class="op-actions" data-op-actions></div>
              <p class="op-hint" data-op-hint></p>
            </div>
          </section>
        </div>

        <div class="op-col">
          <section class="op-panel op-panel-have" data-op-have-panel aria-label="What we have, as last read">
            <div class="op-panel-head">
              <span data-op-read-at></span><span data-op-count></span>
            </div>
            <div class="op-panel-body">
              <div data-op-have></div>
              <div data-op-detail></div>
            </div>
          </section>

          <section class="op-panel op-panel-feed" aria-labelledby="op-feed-h">
            <div class="op-panel-head" id="op-feed-h">
              <span>Events</span><span class="op-panel-note">reports, not instructions</span>
            </div>
            <div class="op-panel-body">
              <ul class="op-feed" data-op-feed></ul>
            </div>
          </section>
        </div>
      </div>

      <div data-op-cards aria-live="polite"></div>

      <details class="op-history">
        <summary>History</summary>
        <ol data-op-history></ol>
      </details>`,
      "board"
    );

    const pick = <T extends HTMLElement>(sel: string): T => this.stage.querySelector<T>(sel) as T;
    this.refs = {
      turn: pick("[data-op-turn]"),
      turnLabel: pick("[data-op-turn-label]"),
      turnNote: pick("[data-op-turn-note]"),
      turnCount: pick("[data-op-turn-count]"),
      tally: pick("[data-op-tally]"),
      have: pick("[data-op-have]"),
      count: pick("[data-op-count]"),
      readAt: pick("[data-op-read-at]"),
      detail: pick("[data-op-detail]"),
      feed: pick("[data-op-feed]"),
      actions: pick("[data-op-actions]"),
      hint: pick("[data-op-hint]"),
      cards: pick("[data-op-cards]"),
      history: pick("[data-op-history]"),
    };
    this.buildActions();
    this.paint();
  }

  private buildActions(): void {
    if (!this.refs) return;
    const s = this.scenario;
    this.refs.actions.innerHTML = s.actions
      .flatMap((kind) => {
        if (kind === "create" && s.chooseMachine) {
          return s.machines.map((m) =>
            this.actionButton("create", `Create server on ${m.id}`, ` data-machine="${m.id}"`)
          );
        }
        return [this.actionButton(kind, ACTION_LABEL[kind], kind === "observe" ? ` data-tone="primary"` : "")];
      })
      .join("");
  }

  /** A verb, and for reading, how far behind the panel has fallen. */
  private actionButton(kind: ActionKind, label: string, extra: string): string {
    const trim =
      kind === "observe"
        ? `<span class="op-act-badge" data-op-unread hidden></span><kbd class="op-kbd">R</kbd>`
        : "";
    return `<button type="button" class="op-btn op-act" data-act="${kind}"${extra}>
      <span data-op-act-label>${esc(label)}</span>${trim}
    </button>`;
  }

  private paint(): void {
    const r = this.refs;
    if (!r) return;
    const live = this.phase === "auto";
    if (live) this.seen = this.read();

    const seenCount = this.seenRunning();
    const d = this.seenGap();
    const state = d === 0 ? "match" : d > 0 ? "over" : "under";

    r.tally.innerHTML = `
      <div><dt>Wanted</dt><dd>${this.world.desired.replicas}</dd></div>
      <div><dt>Running</dt><dd>${seenCount}</dd></div>
      <div class="op-delta" data-state="${state}"><dt>Difference</dt><dd>${d > 0 ? "+" : ""}${d}</dd></div>`;

    this.paintTurn();
    r.count.textContent = `${this.seen.servers.length} listed`;
    this.paintReadAt(live);
    this.paintHave(r.have);
    this.paintDetail(r.detail);
    this.paintFeed(r.feed);
    if (live) {
      this.paintAutoPanel();
      this.paintLoopPanel();
    } else {
      this.paintActions();
    }
    this.paintHistory(r.history);
  }

  /**
   * Whose turn it is, and what the game is waiting for. The board can look
   * identical whether a move is settling, an event is sitting unread, or
   * nothing at all is happening, so the one thing that never looks the same is
   * this bar. It is the game's live region: it repaints only when the sentence
   * changes, so a screen reader hears each turn once.
   */
  private paintTurn(): void {
    const r = this.refs;
    if (!r) return;
    const turn = this.turnStatus();
    const moves = this.world.moves;
    const count = this.phase === "play" ? `${moves} action${moves === 1 ? "" : "s"} taken` : "";
    const sig = `${turn.state}|${turn.label}|${turn.note}|${count}`;
    if (sig === this.turnSig) return;
    this.turnSig = sig;
    r.turn.dataset.state = turn.state;
    r.turnLabel.textContent = turn.label;
    r.turnNote.textContent = turn.note;
    r.turnCount.textContent = count;
  }

  private turnStatus(): { state: string; label: string; note: string } {
    if (this.phase === "auto") {
      return this.autoOn
        ? {
            state: "auto",
            label: "The controller has it",
            note: "It reads, compares and acts on its own. Nothing here is waiting on you.",
          }
        : {
            state: "awaiting",
            label: "Awaiting your action",
            note: "Three running, three wanted. Hand the loop over when you are ready.",
          };
    }
    if (this.phase === "debrief" || this.phase === "quiz") {
      return { state: "solved", label: "Level solved", note: "Your reading matched the specification." };
    }
    if (this.busy) {
      return {
        state: "working",
        label: "Working",
        note: "Your action is landing. The list still shows your last reading.",
      };
    }
    if (this.said) {
      // The reply to the last click outranks the standing advice, but unread
      // events still colour the bar: they are the more urgent of the two.
      return {
        state: this.said.warn || this.staleness() > 0 ? "alert" : "awaiting",
        label: "Awaiting your action",
        note: this.said.text,
      };
    }

    const behind = this.staleness();
    const wanted = this.world.desired.replicas;
    const d = this.seenGap();
    let note: string;
    if (behind > 0) {
      note = `${behind} event${behind === 1 ? "" : "s"} since your last read. Read the state before deciding.`;
    } else if (this.unseenMove) {
      note = "Your last action is not in this list yet. Read the state to see what it did.";
    } else if (d !== 0) {
      note = `Your last read was ${Math.abs(d)} ${d > 0 ? "over" : "short of"} ${wanted}. Close the gap, then read again.`;
    } else if (this.world.moves > 0 && this.pending > 0) {
      note = "Nothing is out of place, but the feed is not finished.";
    } else if (this.world.moves > 0) {
      note = "Your last read matched. Read again to confirm it still does.";
    } else if (this.world.feed.length > 0) {
      note = "Your last read matched. If nothing needs doing, take Do nothing, then read again.";
    } else {
      note = "Your last read matched. Watch the events, and read again when one arrives.";
    }
    return { state: behind > 0 ? "alert" : "awaiting", label: "Awaiting your action", note };
  }

  /**
   * The panel is a reading, so it is headed by when that reading was taken. How
   * far behind it is belongs to the turn bar; all this panel says is that it is
   * old, by going dashed and dimming the list under it.
   */
  private paintReadAt(live: boolean): void {
    if (!this.refs) return;
    const panel = this.stage.querySelector<HTMLElement>("[data-op-have-panel]");
    if (panel) panel.dataset.stale = String(!live && this.staleness() > 0);
    this.refs.readAt.textContent = live
      ? "What we have, read continuously"
      : `What we have, read at ${stamp(this.seen.at)}`;
  }

  private paintHave(host: HTMLElement): void {
    if (this.scenario.showMachines) {
      if (!host.querySelector("[data-machine-box]")) {
        host.innerHTML = this.seen.machines
          .map(
            (m) => `
            <div class="op-machine" data-machine-box="${m.id}">
              <div class="op-machine-head"><span>${m.id}</span><span data-machine-state></span></div>
              <ul class="op-list" data-list="${m.id}"></ul>
            </div>`
          )
          .join("");
      }
      for (const m of this.seen.machines) {
        const box = host.querySelector<HTMLElement>(`[data-machine-box="${m.id}"]`);
        const label = box?.querySelector<HTMLElement>("[data-machine-state]");
        const list = box?.querySelector<HTMLElement>(`[data-list="${m.id}"]`);
        if (!box || !label || !list) continue;
        box.dataset.status = m.status;
        const used = this.seen.servers.filter((s) => s.machine === m.id).length;
        label.textContent = m.status === "failed" ? "down" : `${used} of ${m.capacity} used`;
        this.paintList(list, this.seen.servers.filter((s) => s.machine === m.id), "Nothing here.");
      }
      return;
    }

    let list = host.querySelector<HTMLElement>("[data-list]");
    if (!list) {
      host.innerHTML = `<ul class="op-list" data-list="all"></ul>`;
      list = host.querySelector<HTMLElement>("[data-list]") as HTMLElement;
    }
    this.paintList(list, this.seen.servers, "There is nothing running.");
  }

  /** Keyed against the DOM so a row can animate in when a read reveals it. */
  private paintList(list: HTMLElement, servers: Server[], emptyText: string): void {
    const want = new Set(servers.map((s) => s.id));

    for (const node of Array.from(list.querySelectorAll<HTMLElement>("[data-server]"))) {
      const id = node.dataset.server as string;
      if (!want.has(id) && !node.classList.contains("op-out")) {
        node.classList.add("op-out");
        this.after(260, () => node.parentElement?.remove());
      }
    }

    const empty = list.querySelector<HTMLElement>("[data-empty]");
    if (servers.length === 0) {
      if (!empty) list.insertAdjacentHTML("beforeend", `<li class="op-empty" data-empty>${emptyText}</li>`);
    } else if (empty) {
      empty.remove();
    }

    for (const s of servers) {
      let node = list.querySelector<HTMLElement>(`[data-server="${s.id}"]:not(.op-out)`);
      if (!node) {
        const li = document.createElement("li");
        li.innerHTML = `
          <button type="button" class="op-server op-in" data-server="${s.id}">
            <span class="op-server-id">${s.id}</span>
            <span class="op-status" data-op-status><span class="op-glyph" aria-hidden="true"></span><span data-op-status-text></span></span>
            <span class="op-server-where"></span>
          </button>`;
        list.appendChild(li);
        node = li.querySelector<HTMLElement>("[data-server]") as HTMLElement;
      }
      const pill = node.querySelector<HTMLElement>("[data-op-status]");
      const text = node.querySelector<HTMLElement>("[data-op-status-text]");
      const glyph = node.querySelector<HTMLElement>(".op-glyph");
      const where = node.querySelector<HTMLElement>(".op-server-where");
      if (pill && text && glyph) {
        if (pill.dataset.status && pill.dataset.status !== s.status) {
          node.classList.remove("op-changed");
          void node.offsetWidth;
          node.classList.add("op-changed");
        }
        pill.dataset.status = s.status;
        text.textContent = STATUS[s.status].label;
        glyph.textContent = STATUS[s.status].glyph;
      }
      if (where) where.textContent = this.scenario.showMachines ? "" : s.machine;
      node.setAttribute("aria-pressed", String(this.world.selected === s.id));
      node.setAttribute("aria-label", `${s.id}, ${STATUS[s.status].label}, on ${s.machine}`);
    }
  }

  private paintDetail(host: HTMLElement): void {
    const s = this.seen.servers.find((x) => x.id === this.world.selected);
    if (!s) {
      host.innerHTML = `<p class="op-hint">Select a server to read its details.</p>`;
      return;
    }
    const m = this.seen.machines.find((x) => x.id === s.machine);
    const pair = (label: string, value: string): string => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
    host.innerHTML = `
      <div class="op-detail op-in">
        <b>${s.id}</b>
        <dl>
          ${pair("Status", STATUS[s.status].label)}
          ${pair("Machine", `${s.machine}${m && m.status === "failed" ? " (down)" : ""}`)}
          ${pair("Uptime", s.status === "running" ? minutes(s.uptime) : "not running")}
          ${pair("CPU", s.status === "running" ? `${s.cpu}%` : "no reading")}
        </dl>
      </div>`;
  }

  private paintFeed(host: HTMLElement): void {
    const feed = this.world.feed.slice(0, 6);
    if (feed.length === 0) {
      host.innerHTML = `<li class="op-empty">Quiet so far.</li>`;
      this.feedTop = "";
      return;
    }
    const top = `${feed[0].at}${feed[0].text}`;
    const fresh = top !== this.feedTop;
    this.feedTop = top;
    const unread = this.staleness();
    host.innerHTML = feed
      .map((e, i) => {
        const isNew = i < unread && this.phase !== "auto";
        return `<li${i === 0 && fresh ? ` class="op-in"` : ""}${isNew ? ` data-unread` : ""}>
          <time>${e.at}</time><span>${esc(e.text)}</span></li>`;
      })
      .join("");
  }

  private paintActions(): void {
    if (!this.refs) return;
    const sel = this.seen.servers.find((x) => x.id === this.world.selected);
    const locked = this.busy || this.phase !== "play";
    const behind = this.staleness();
    for (const btn of Array.from(this.refs.actions.querySelectorAll<HTMLButtonElement>("[data-act]"))) {
      const kind = btn.dataset.act as ActionKind;
      const needsTarget = kind === "delete" || kind === "restart";
      btn.disabled = locked || (needsTarget && !sel);
      const label = btn.querySelector<HTMLElement>("[data-op-act-label]");
      if (needsTarget && label) {
        label.textContent = sel ? `${ACTION_LABEL[kind].split(" ")[0]} ${sel.id}` : ACTION_LABEL[kind];
      }
      const badge = btn.querySelector<HTMLElement>("[data-op-unread]");
      if (badge) {
        badge.hidden = behind === 0;
        badge.textContent = behind === 0 ? "" : `${behind} new`;
      }
    }
    // Selection only. Whose turn it is and what is unread belong to the bar at
    // the top of the board, and saying either twice just makes the board taller.
    this.refs.hint.textContent = sel
      ? `${sel.id} is selected. Delete and restart act on it.`
      : "No server is selected. Click one in the list to inspect it.";
  }

  private paintHistory(host: HTMLElement): void {
    host.innerHTML = this.world.log
      .slice(-14)
      .map((e) => `<li data-kind="${e.kind}"><time>${e.at}</time><span>${esc(e.text)}</span></li>`)
      .join("");
  }

  // --- between levels --------------------------------------------------

  /** Stays on the board on purpose. The player should see the state they solved. */
  private renderDebrief(): void {
    this.phase = "debrief";
    this.cleared.add(this.level);
    this.paintRail();
    this.paintActions();
    this.paintTurn();
    const s = this.scenario;
    const last = this.level === scenarios.length - 1;
    const next = s.question ? "quiz" : last ? "loop" : "next";
    const label = s.question || last ? "Continue" : `Level ${this.level + 2}`;
    if (!this.refs) return;
    // The card lands under the board rather than replacing it, so the reading
    // that solved the level is still on screen behind what it is being told.
    this.refs.cards.innerHTML = `
      <div class="op-card op-in">
        <span class="op-step">Level ${this.level + 1} solved</span>
        ${s.debrief.map((p, i) => `<p${i === 0 ? ` class="op-lede"` : ""}>${esc(p)}</p>`).join("")}
        <div class="op-foot">
          <button type="button" class="op-btn" data-tone="primary" data-go="${next}">${label}</button>
          <button type="button" class="op-btn" data-go="retry">Play it again</button>
        </div>
      </div>`;
    this.refs.cards.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  private renderQuiz(): void {
    this.phase = "quiz";
    const q = this.scenario.question as Question;
    if (!this.refs) return;
    this.paintTurn();
    this.refs.cards.innerHTML = `
      <div class="op-card op-in">
        <span class="op-step">One question</span>
        <p class="op-lede">${esc(q.prompt)}</p>
        <div class="op-quiz">
          ${q.options.map((o, i) => `<button type="button" class="op-btn" data-pick="${i}">${esc(o.text)}</button>`).join("")}
        </div>
        <div data-op-reply aria-live="polite"></div>
      </div>`;
  }

  private answer(index: number): void {
    const q = this.scenario.question;
    if (!q) return;
    const option = q.options[index];
    const host = this.stage.querySelector<HTMLElement>("[data-op-reply]");
    for (const b of Array.from(this.stage.querySelectorAll<HTMLButtonElement>("[data-pick]"))) {
      b.dataset.picked = String(Number(b.dataset.pick) === index);
      b.disabled = true;
    }
    const last = this.level === scenarios.length - 1;
    if (!host) return;
    host.innerHTML = `
      <div class="op-feedback op-in" data-tone="${option.right ? "good" : "warn"}"><p>${esc(option.reply)}</p></div>
      <div class="op-foot">
        <button type="button" class="op-btn" data-tone="primary" data-go="${last ? "loop" : "next"}">
          ${last ? "Continue" : `Level ${this.level + 2}`}
        </button>
      </div>`;
  }

  // --- the closing screens ---------------------------------------------

  private renderLoop(): void {
    this.phase = "loop";
    this.setHead("What just happened", "Every level was the same shape", "The failures were different. What you did about them was not.");
    this.screen(`
      ${this.loopDiagram()}
      <p>You never solved a level by answering an event. Events told you to go and look. What
      solved a level was reading the specification, reading the system, and closing the gap between
      them. When there was no gap, the right move was to leave it alone.</p>
      <p>Notice how much of that was reading. Four of the five steps are looking at something. Only
      one of them changes anything.</p>
      <div class="op-foot">
        <button type="button" class="op-btn" data-tone="primary" data-go="word">Continue</button>
      </div>`);
  }

  private loopDiagram(live = -1): string {
    const steps = ["What should exist?", "What actually exists?", "Are they different?", "Take one action", "Look again"];
    return `
      <div class="op-loop" role="img" aria-label="A loop: what should exist, what actually exists, are they different, take one action, look again, and back to the start.">
        ${steps
          .map(
            (s, i) =>
              `<div class="op-loop-step" data-live="${i === live}">${s}</div>` +
              (i < steps.length - 1 ? `<div class="op-loop-arrow" aria-hidden="true">&darr;</div>` : "")
          )
          .join("")}
        <div class="op-loop-arrow" aria-hidden="true">&#8635;</div>
      </div>`;
  }

  private renderWord(): void {
    this.phase = "word";
    this.setHead("What just happened", "The loop has a name", "It is called reconciliation.");
    this.screen(`
      <p class="op-lede">A reconciler watches the current state of a system and takes actions that
      move it toward a desired state.</p>
      <p>It does not run once. It runs again after every change, including its own, because the
      world does not hold still while you work. Level five was that lesson with the timing turned
      against you, and the stale panel was that lesson every single level.</p>
      <p>Kubernetes is built out of these loops. Most of the moving parts inside it are doing what
      you just did by hand: reading a specification, reading reality, closing the difference.</p>
      <div class="op-foot">
        <button type="button" class="op-btn" data-tone="primary" data-go="map">Continue</button>
      </div>`);
  }

  private renderMap(): void {
    this.phase = "map";
    this.setHead("What just happened", "The same game with its real names", "Nothing about the game changes here. Only the vocabulary does.");
    this.screen(`
      <table class="op-map">
        <thead><tr><th>In the game</th><th>In Kubernetes</th></tr></thead>
        <tbody>
          <tr><td>The specification</td><td>Desired state, written down as an object</td></tr>
          <tr><td>A server</td><td>A Pod</td></tr>
          <tr><td>The list of what exists</td><td>Actual state, held by the cluster</td></tr>
          <tr><td>A machine</td><td>A node</td></tr>
          <tr><td>You, reading the panels</td><td>A controller</td></tr>
        </tbody>
      </table>
      <p>A Deployment holds a number. A controller watches that number, counts the Pods that
      actually exist, and creates or deletes Pods until the two agree. Three wanted, two running,
      so it creates one. You already know this part.</p>
      <div class="op-foot">
        <button type="button" class="op-btn" data-tone="primary" data-go="auto">Continue</button>
      </div>`);
  }

  // --- the automatic finale --------------------------------------------

  private startAuto(): void {
    this.clearTimers();
    this.phase = "auto";
    this.scenario = autoScenario;
    this.world = seed(autoScenario);
    this.world.actor = "The controller";
    this.seen = this.read();
    this.said = null;
    this.autoOn = false;
    this.autoSig = "";
    this.repaired = 0;
    this.loopStep = -1;
    this.loopNote = "";
    this.feedTop = "";
    this.busy = false;
    this.unseenMove = false;
    this.turnSig = "";
    this.setHead("Last part", "Hand it over", "Three web servers, all healthy, and you are no longer the one reading the panel.");
    this.mountBoard();
  }

  private paintAutoPanel(): void {
    if (!this.refs) return;
    const r = this.refs;
    const sig = `${this.autoOn}:${this.repaired > 0}`;
    if (sig !== this.autoSig) {
      this.autoSig = sig;
      r.actions.innerHTML = this.autoOn
        ? `<button type="button" class="op-btn" data-go="break">Stop a server</button>
           ${this.repaired > 0 ? `<button type="button" class="op-btn" data-tone="primary" data-go="eventual">Continue</button>` : ""}`
        : `<button type="button" class="op-btn" data-tone="primary" data-go="enable">Enable automatic reconciliation</button>`;
    }
    r.hint.textContent = !this.autoOn
      ? "Turning this on hands the reading and the deciding to something else."
      : this.repaired > 0
        ? "Break it as often as you like. Nobody is coming, and nobody has to."
        : "Break something and watch what happens.";
  }

  private paintLoopPanel(): void {
    if (!this.refs) return;
    const host = this.refs.cards;
    if (!this.autoOn) {
      host.innerHTML = "";
      return;
    }
    if (!host.querySelector("[data-loop]")) {
      host.innerHTML = `
        <div class="op-feedback" data-tone="flat">
          <p data-loop-note></p>
          <div data-loop>${this.loopDiagram(this.loopStep)}</div>
        </div>`;
    }
    const line = host.querySelector<HTMLElement>("[data-loop-note]");
    if (line) line.textContent = this.loopNote;
    Array.from(host.querySelectorAll<HTMLElement>(".op-loop-step")).forEach((el, i) => {
      el.dataset.live = String(i === this.loopStep);
    });
  }

  private enableAuto(): void {
    this.autoOn = true;
    note(this.world, "Automatic reconciliation is on.", "system");
    this.loopNote = "The controller is running the loop you ran by hand.";
    this.paint();
    this.tick();
  }

  /** One pass of the loop, paced so a person can watch each step land. */
  private tick(): void {
    if (!this.autoOn || this.phase !== "auto") return;
    const w = this.world;

    this.loopStep = 0;
    this.loopNote = "Reading the specification.";
    this.paintLoopPanel();

    this.after(650, () => {
      this.loopStep = 2;
      const d = gap(w);
      this.loopNote = `Wanted ${w.desired.replicas}, running ${running(w)}.`;
      this.paintLoopPanel();

      if (d === 0) {
        this.after(900, () => {
          this.loopStep = -1;
          this.loopNote = "No difference. Nothing to do. Checking again.";
          this.paintLoopPanel();
          this.after(900, () => this.tick());
        });
        return;
      }

      this.after(650, () => {
        this.loopStep = 3;
        this.loopNote = d < 0 ? "Short by one. Creating a replacement." : "One too many. Removing one.";
        this.paintLoopPanel();
        if (d < 0) {
          apply(w, { kind: "create" });
        } else {
          const spare = w.servers.find((s) => s.status === "running");
          if (spare) apply(w, { kind: "delete", target: spare.id });
        }
        this.paint();

        this.after(800, () => {
          settle(w);
          this.loopStep = 4;
          this.loopNote = "Looking again.";
          if (converged(w)) this.repaired += 1;
          this.paint();
          this.after(900, () => this.tick());
        });
      });
    });
  }

  private breakOne(): void {
    const w = this.world;
    const live = w.servers.filter((s) => s.status === "running");
    if (live.length === 0) return;
    const victim = live[(w.flags.kills ?? 0) % live.length];
    w.flags.kills = (w.flags.kills ?? 0) + 1;
    victim.status = "failed";
    victim.cpu = 0;
    w.log.push({ at: stamp(w.clock), text: `You stopped ${victim.id}`, kind: "you" });
    note(w, `${victim.id} stopped responding.`, "world");
    this.paint();
  }

  // --- what the waiting was ---------------------------------------------

  private renderEventual(): void {
    this.autoOn = false;
    this.phase = "eventual";
    this.setHead(
      "One more thing",
      "Nothing is instant",
      "Every repair you watched took a couple of seconds. That gap is worth a name."
    );
    this.screen(`
      <p class="op-lede">A reconciler does not put a system into its desired state. It moves the
      system toward it, and moving takes time.</p>
      ${this.timeline()}
      <p>Look at the two middle steps. The system is short of its specification and something is
      already fixing it. It is wrong and it is converging, at the same moment. That window is not a
      failure of the design. It is the design.</p>
      <p>The property has a name: eventual consistency. You do not get three servers, always. You
      get three servers, given a moment. Most of what feels broken about a system like this turns
      out to be someone reading the panel during somebody else's moment, which is exactly what
      happened to you in level five.</p>
      <p>So the useful question is rarely whether the system matches right now. It is whether the
      gap is closing.</p>
      <div class="op-foot">
        <button type="button" class="op-btn" data-tone="primary" data-go="done">Continue</button>
      </div>`);
  }

  private timeline(): string {
    const steps: { at: string; count: string; note: string; state: string }[] = [
      { at: "14:32:01", count: "3 of 3", note: "matching", state: "ok" },
      { at: "14:32:04", count: "2 of 3", note: "a server fails", state: "off" },
      { at: "14:32:06", count: "2 of 3", note: "the controller acts", state: "work" },
      { at: "14:32:09", count: "3 of 3", note: "matching again", state: "ok" },
    ];
    return `
      <ol class="op-time" role="img" aria-label="A timeline: three of three matching, then a server fails leaving two of three, then the controller acts while still at two of three, then three of three matching again. The two middle moments are the converging window.">
        ${steps
          .map(
            (s) => `<li data-state="${s.state}">
              <time>${s.at}</time>
              <b>${s.count}</b>
              <span>${s.note}</span>
            </li>`
          )
          .join("")}
      </ol>
      <p class="op-time-note">The shaded stretch is the whole idea. The system is wrong there, and
      something is already working on it.</p>`;
  }

  // --- completion ------------------------------------------------------

  /** Says the lesson is finished. What that means for progress is the page's. */
  private announceDone(): void {
    document.dispatchEvent(new CustomEvent("operator:done"));
  }

  private renderDone(): void {
    this.autoOn = false;
    this.phase = "done";
    // Everything the lesson deliberately withheld: the closing prose and the
    // sidebar glossary. The page owns what completion means for progress, so
    // say it happened and let it decide.
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-hold]"))) {
      el.hidden = false;
      el.classList.add("op-in");
    }
    this.announceDone();

    this.setHead("Done", "You are thinking like a controller", "You watched a piece of software do, on its own, the thing you spent six levels working out.");
    const cont = this.nextHref
      ? `<a class="op-btn" data-tone="primary" data-go="continue" href="${esc(this.nextHref)}">Continue to ${esc(this.nextTitle)}</a>`
      : "";
    this.screen(`
      ${this.loopDiagram()}
      <dl class="op-scores">
        <div><dt>Actions taken</dt><dd>${this.stats.moves}</dd></div>
        <div><dt>Times you read the state</dt><dd>${this.stats.reads}</dd></div>
        <div><dt>Actions that were not needed</dt><dd>${this.stats.needless}</dd></div>
        <div><dt>Moves away from the specification</dt><dd>${this.stats.worse}</dd></div>
      </dl>
      <p>That loop is most of what Kubernetes is doing at any moment. The rest of this track is
      either a loop, the state a loop reads, or the machinery that lets a loop act.</p>
      <div class="op-foot">
        ${cont}
        <button type="button" class="op-btn" data-go="start">Play again</button>
      </div>`);
  }
}

let current: Game | null = null;

function boot(): void {
  current?.destroy();
  current = null;
  const root = document.querySelector<HTMLElement>("[data-operator]");
  if (root) current = new Game(root);
}

document.addEventListener("astro:page-load", boot);
document.addEventListener("astro:before-swap", () => {
  current?.destroy();
  current = null;
});
