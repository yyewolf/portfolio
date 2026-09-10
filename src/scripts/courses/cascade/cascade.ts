// Runner and view for lesson 7's controller cascade.
//
// Same shape as the other course interactives: one shell built at runtime, then
// only the panels inside it are repainted. Markup is a runtime string, so the
// stylesheet is global and hand-namespaced (`.cs`) and there is no bare
// `<header>` anywhere — global.css pins that as fixed site chrome (AGENTS.md
// gotcha 7).
//
// It is deliberately *not* built on the lesson 2 engine. There the player is
// the loop and the world is hidden from them; here the loops are the exhibit
// and the world is fully visible the whole time. The reader's job is to poke
// the records and watch which loop notices, which only works if nothing is
// hidden.
//
// The pause switches are the reason this exists rather than an animation. Stop
// the ReplicaSet controller, delete a pod, and nothing happens — no other loop
// steps in, because no other loop is watching for that. Start it again and the
// pod comes back without anybody re-issuing the request. That is the whole
// lesson, and it cannot be made out of prose.

import {
  actions,
  controllers,
  initialWorld,
  type Action,
  type World,
} from "./engine";

interface Entry {
  who: string;
  text: string;
  rev: number;
}

const esc = (s: string): string =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", [`"`]: "&quot;" })[c] ?? c,
  );

const TICK_MS = 800;
const LOG_MAX = 10;

class Cascade {
  private root: HTMLElement;
  private world: World = initialWorld();
  private paused = new Set<string>();
  private log: Entry[] = [];
  private acted = new Set<string>();
  private timer: number | null = null;
  private settled = false;
  /**
   * Whether the reader has the loops switched on. Settling stops the timer but
   * leaves this true, so a later edit to a record wakes them up again — which
   * is what a real cluster does, and what stops the panel looking broken after
   * it has come to rest.
   */
  private auto = false;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="cs-shell">
        <div class="cs-head">
          <p class="cs-title">One cluster, five loops</p>
          <p class="cs-rev">revision <b data-cs-rev></b></p>
        </div>
        <div class="cs-controls" data-cs-controls></div>
        <div class="cs-grid">
          <div class="cs-loops" data-cs-loops></div>
          <div class="cs-world" data-cs-world></div>
        </div>
        <div class="cs-actions" data-cs-actions></div>
        <div class="cs-logwrap">
          <p class="cs-log-head">What each loop did, in order</p>
          <ol class="cs-log" data-cs-log></ol>
        </div>
      </div>`;
    this.paintControls();
    this.paint();
  }

  // --- the loop ------------------------------------------------------------

  /**
   * One sweep. Every controller that is not paused gets a look, in a fixed
   * order, and does at most one thing. A sweep where nobody found anything is
   * the settled state, and saying so out loud is half the point of the panel.
   */
  private tick(): void {
    this.acted.clear();
    let changed = false;

    for (const c of controllers) {
      if (this.paused.has(c.id)) continue;
      const line = c.reconcile(this.world);
      if (line === null) continue;
      changed = true;
      this.acted.add(c.id);
      this.log.unshift({ who: c.name, text: line, rev: this.world.rev });
    }

    this.log = this.log.slice(0, LOG_MAX);
    this.settled = !changed;
    if (this.settled) this.stop();
    this.paint();
  }

  private start(): void {
    this.auto = true;
    if (this.timer !== null) return;
    this.settled = false;
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.paintControls();
  }

  /** Stops the timer without clearing `auto`; use `halt` for the reader's pause. */
  private stop(): void {
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
    this.paintControls();
  }

  /** The reader's pause: stop the timer and stay stopped. */
  private halt(): void {
    this.auto = false;
    this.stop();
  }

  private act(a: Action): void {
    if (!a.enabled(this.world)) return;
    a.apply(this.world);
    // Described after the change so the line reports what the record now says.
    this.log.unshift({ who: "you", text: a.describe(this.world), rev: this.world.rev });
    this.log = this.log.slice(0, LOG_MAX);
    this.settled = false;
    this.acted.clear();
    if (this.auto) this.start();
    this.paint();
  }

  // --- painting ------------------------------------------------------------

  private paintControls(): void {
    const el = this.root.querySelector<HTMLElement>("[data-cs-controls]");
    if (!el) return;
    el.innerHTML = `
      <button type="button" class="cs-btn" data-tone="primary" data-go="run">
        ${this.auto ? "Pause the loops" : "Run the loops"}
      </button>
      <button type="button" class="cs-btn" data-go="step"${this.auto ? " disabled" : ""}>
        One sweep
      </button>
      <button type="button" class="cs-btn" data-go="reset">Start over</button>
      <span class="cs-state" data-state="${this.settled ? "settled" : "working"}">
        ${this.settled ? "settled" : "gap open"}
      </span>`;

    el.querySelector<HTMLButtonElement>(`[data-go="run"]`)?.addEventListener(
      "click",
      () => (this.auto ? this.halt() : this.start()),
    );
    el.querySelector<HTMLButtonElement>(`[data-go="step"]`)?.addEventListener(
      "click",
      () => this.tick(),
    );
    el.querySelector<HTMLButtonElement>(`[data-go="reset"]`)?.addEventListener(
      "click",
      () => {
        this.halt();
        this.world = initialWorld();
        this.log = [];
        this.acted.clear();
        this.paused.clear();
        this.settled = false;
        this.paintControls();
        this.paint();
      },
    );
  }

  private loopsHtml(): string {
    return controllers
      .map((c) => {
        const off = this.paused.has(c.id);
        return `<div class="cs-loop" data-off="${off ? "yes" : "no"}" data-acted="${
          this.acted.has(c.id) ? "yes" : "no"
        }">
          <div class="cs-loop-text">
            <p class="cs-loop-name">${esc(c.name)}</p>
            <p class="cs-loop-watch">watches ${esc(c.watches)}</p>
          </div>
          <button type="button" class="cs-toggle" data-pause="${c.id}" aria-pressed="${off}">
            ${off ? "stopped" : "running"}
          </button>
        </div>`;
      })
      .join("");
  }

  private worldHtml(): string {
    const w = this.world;

    const deployment = w.deployment
      ? `<div class="cs-obj" data-kind="deployment">
           <p class="cs-obj-kind">Deployment</p>
           <p class="cs-obj-name">${esc(w.deployment.name)}</p>
           <p class="cs-obj-spec">replicas ${w.deployment.replicas} &middot; ${esc(w.deployment.image)}</p>
         </div>`
      : `<div class="cs-obj" data-kind="gone">
           <p class="cs-obj-kind">Deployment</p>
           <p class="cs-obj-name">deleted</p>
         </div>`;

    const sets = w.replicaSets.length
      ? w.replicaSets
          .map((rs) => {
            const mine = w.pods.filter((p) => p.rs === rs.name);
            const chips = mine
              .map(
                (p) =>
                  `<li class="cs-pod" data-phase="${p.phase}">
                     <span class="cs-pod-name">${esc(p.name)}</span>
                     <span class="cs-pod-where">${p.node ? esc(p.node) : "unscheduled"}</span>
                   </li>`,
              )
              .join("");
            return `<div class="cs-obj" data-kind="replicaset">
                <p class="cs-obj-kind">ReplicaSet</p>
                <p class="cs-obj-name">${esc(rs.name)}</p>
                <p class="cs-obj-spec">
                  wants ${rs.replicas} &middot; has ${mine.length} &middot; ${esc(rs.image)}
                </p>
                <ul class="cs-pods">${chips || `<li class="cs-empty">no pods</li>`}</ul>
              </div>`;
          })
          .join("")
      : `<p class="cs-empty cs-empty-block">No ReplicaSets.</p>`;

    // Pods whose owner has already gone. They are the garbage collector's
    // reason to exist, and they only show up for a tick or two.
    const orphans = w.pods.filter(
      (p) => !w.replicaSets.some((r) => r.name === p.rs),
    );
    const orphanHtml = orphans.length
      ? `<div class="cs-obj" data-kind="orphan">
           <p class="cs-obj-kind">Pods with no owner</p>
           <ul class="cs-pods">${orphans
             .map(
               (p) =>
                 `<li class="cs-pod" data-phase="${p.phase}">
                    <span class="cs-pod-name">${esc(p.name)}</span>
                    <span class="cs-pod-where">${p.node ? esc(p.node) : "unscheduled"}</span>
                  </li>`,
             )
             .join("")}</ul>
         </div>`
      : "";

    return deployment + sets + orphanHtml;
  }

  private actionsHtml(): string {
    return actions
      .map(
        (a) =>
          `<button type="button" class="cs-btn cs-action" data-act="${a.id}"${
            a.enabled(this.world) ? "" : " disabled"
          }>${esc(a.label)}</button>`,
      )
      .join("");
  }

  private logHtml(): string {
    if (this.log.length === 0)
      return `<li class="cs-empty">Nothing has happened yet.</li>`;
    return this.log
      .map(
        (e) =>
          `<li class="cs-entry" data-who="${e.who === "you" ? "you" : "loop"}">
             <span class="cs-entry-who">${esc(e.who)}</span>
             <span class="cs-entry-text">${esc(e.text)}</span>
             <span class="cs-entry-rev">${e.rev}</span>
           </li>`,
      )
      .join("");
  }

  private paint(): void {
    const q = <T extends HTMLElement>(sel: string): T | null =>
      this.root.querySelector<T>(sel);

    const rev = q("[data-cs-rev]");
    if (rev) rev.textContent = String(this.world.rev);

    const loops = q("[data-cs-loops]");
    if (loops) {
      loops.innerHTML = this.loopsHtml();
      loops.querySelectorAll<HTMLButtonElement>("[data-pause]").forEach((b) => {
        b.addEventListener("click", () => {
          const id = b.dataset.pause;
          if (!id) return;
          if (this.paused.has(id)) this.paused.delete(id);
          else this.paused.add(id);
          // A stopped loop is a reason for the system to stop being settled:
          // starting it again should be able to find work.
          this.settled = false;
          if (this.auto) this.start();
          this.paint();
          this.paintControls();
        });
      });
    }

    const world = q("[data-cs-world]");
    if (world) world.innerHTML = this.worldHtml();

    const acts = q("[data-cs-actions]");
    if (acts) {
      acts.innerHTML = this.actionsHtml();
      acts.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((b) => {
        b.addEventListener("click", () => {
          const a = actions.find((x) => x.id === b.dataset.act);
          if (a) this.act(a);
        });
      });
    }

    const log = q("[data-cs-log]");
    if (log) log.innerHTML = this.logHtml();

    const state = q("[data-state]");
    if (state) {
      state.dataset.state = this.settled ? "settled" : "working";
      state.textContent = this.settled ? "settled" : "gap open";
    }
  }
}

const mount = (): void => {
  const host = document.querySelector<HTMLElement>("[data-cascade]");
  const start = host?.querySelector<HTMLButtonElement>(`[data-go="start"]`);
  if (!host || !start) return;
  start.addEventListener("click", () => {
    const stage = host.querySelector<HTMLElement>("[data-cs-stage]");
    if (stage) new Cascade(stage);
  });
};

// Per page load: the module is evaluated once for the session, so a lesson
// reached by going back would otherwise render its start button unwired.
document.addEventListener("astro:page-load", mount);
