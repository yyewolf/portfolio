// Runner and view for lesson 10's stale set.
//
// Smaller than the track's other panels, because it has one thing to show and
// three steps to show it in. Same conventions though: the shell is built once,
// only [data-ss-body] is replaced, the stylesheet is global and namespaced under
// .ss, and no bare <header> is rendered (global.css pins that as site chrome).
//
// The disagreement is the whole picture, so the set's template and each pod's
// image are always both on screen, and a pod whose image is not the template's is
// marked. Between step one and step three the reader is looking at a set that
// wants one thing and is running another with nothing in the world trying to fix
// it, and that state has to look deliberate rather than broken.

import { acts, IMAGE_NEW, type Act } from "./acts";
import { deletePods, setImage, settle, start, versions, type World } from "./engine";

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", [`"`]: "&quot;" })[c] ?? c);

class StaleSet {
  private root: HTMLElement;
  private body: HTMLElement;
  private rail: HTMLElement;
  private i = 0;
  private world: World = start();
  private log: string[] = [];
  private done = false;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="ss-shell">
        <div class="ss-head">
          <ol class="ss-rail" data-ss-rail aria-label="Steps"></ol>
        </div>
        <div class="ss-body" data-ss-body></div>
      </div>`;
    const body = root.querySelector<HTMLElement>("[data-ss-body]");
    const rail = root.querySelector<HTMLElement>("[data-ss-rail]");
    if (!body || !rail) throw new Error("stale set failed to mount");
    this.body = body;
    this.rail = rail;
    this.step();
  }

  /** Pods the reader is asked to delete in the act they are on. */
  private targets(act: Act): string[] {
    if (act.n === 2) return [this.world.pods[0]?.name ?? ""];
    if (act.n === 3) return this.world.pods.filter((p) => p.image !== IMAGE_NEW).map((p) => p.name);
    return [];
  }

  private paintRail(): void {
    this.rail.innerHTML = acts
      .map((a) => {
        const state = a.n - 1 < this.i ? "done" : a.n - 1 === this.i ? "current" : "todo";
        return `<li data-state="${state}"><span>${a.n}</span></li>`;
      })
      .join("");
  }

  private worldHtml(): string {
    const { set, pods } = this.world;
    const rows = pods
      .map((p) => {
        const stale = p.image !== set.image;
        return `<li data-stale="${stale ? "yes" : "no"}">
          <span class="ss-pod-name">${esc(p.name)}</span>
          <span class="ss-pod-image">${esc(p.image)}</span>
        </li>`;
      })
      .join("");
    const mixed = versions(this.world).length > 1;
    return `<div class="ss-world">
      <div class="ss-set">
        <p class="ss-panel-head">ReplicaSet</p>
        <p class="ss-set-name">${esc(set.name)}</p>
        <dl class="ss-fields">
          <div><dt>replicas</dt><dd>${set.replicas}</dd></div>
          <div><dt>template image</dt><dd>${esc(set.image)}</dd></div>
        </dl>
      </div>
      <div class="ss-pods">
        <p class="ss-panel-head">
          Pods <span class="ss-count">${pods.length} running${mixed ? ", two versions" : ""}</span>
        </p>
        <ol class="ss-podlist">${rows}</ol>
      </div>
    </div>`;
  }

  private step(): void {
    const act = acts[this.i];
    if (!act) return this.summary();
    this.log = [];
    this.done = false;
    this.paintRail();
    this.body.innerHTML = `
      <div class="ss-stage">
        <p class="ss-kicker">Step ${act.n} of ${acts.length}</p>
        <p class="ss-ask">${esc(act.ask)}</p>
        <div data-ss-world></div>
        <div data-ss-foot></div>
      </div>`;
    this.paint(act);
  }

  private paint(act: Act): void {
    const worldHost = this.body.querySelector<HTMLElement>("[data-ss-world]");
    const foot = this.body.querySelector<HTMLElement>("[data-ss-foot]");
    if (!worldHost || !foot) return;
    worldHost.innerHTML = this.worldHtml();

    const label = act.action.replace("{pod}", this.targets(act)[0] ?? "a pod");
    const last = this.i === acts.length - 1;
    const result = this.done
      ? `<div class="ss-result">
           <p class="ss-happened">${esc(act.happened)}</p>
           ${
             this.log.length > 0
               ? `<ul class="ss-log">${this.log.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`
               : `<p class="ss-log-empty">The controller ran and had nothing to do.</p>`
           }
           <p class="ss-note">${esc(act.note)}</p>
         </div>`
      : "";
    const go = this.done
      ? `<button type="button" class="ss-btn" data-tone="primary" data-go="next">
           ${last ? "What that means" : "Next step"}
         </button>`
      : `<button type="button" class="ss-btn" data-tone="primary" data-go="act">${esc(label)}</button>`;
    foot.innerHTML = `${result}<div class="ss-foot">${go}</div>`;

    foot.querySelector<HTMLButtonElement>(`[data-go="act"]`)?.addEventListener("click", () => {
      if (act.n === 1) this.world = setImage(this.world, IMAGE_NEW);
      else this.world = deletePods(this.world, this.targets(act));
      // The loop then runs to a standstill, which on step one means it runs and
      // changes nothing. That empty log is the point of the step.
      const settled = settle(this.world);
      this.world = settled.world;
      this.log = settled.log;
      this.done = true;
      this.paint(act);
    });
    foot.querySelector<HTMLButtonElement>(`[data-go="next"]`)?.addEventListener("click", () => {
      this.i += 1;
      this.step();
      this.scrollIntoFrame();
    });
  }

  private summary(): void {
    this.paintRail();
    this.body.innerHTML = `
      <div class="ss-stage">
        <p class="ss-kicker">Three steps later</p>
        <h3 class="ss-title">A ReplicaSet has no idea what it's running</h3>
        <p class="ss-ask">
          It counted pods the whole way through and never once looked at what was
          inside one. That's why the template change did nothing, and why the only
          way you got 2.9 onto all three was by deleting pods until they'd all been
          replaced, with nothing watching how many were up while you did it.
        </p>
        <p class="ss-ask">
          A release is that, done carefully, by something that counts. You are about
          to meet the object whose whole job is doing it for you.
        </p>
        <div class="ss-foot">
          <button type="button" class="ss-btn" data-go="again">Run it again</button>
        </div>
      </div>`;
    this.body.querySelector<HTMLButtonElement>(`[data-go="again"]`)?.addEventListener("click", () => {
      this.i = 0;
      this.world = start();
      this.step();
      this.scrollIntoFrame();
    });
  }

  /** global.css pins the site header, so the shell has to clear it. */
  private scrollIntoFrame(): void {
    const head = document.querySelector("body > header");
    const offset = head instanceof HTMLElement ? head.offsetHeight + 12 : 12;
    window.scrollTo({
      top: this.root.getBoundingClientRect().top + window.scrollY - offset,
      behavior: "smooth",
    });
  }
}

const mount = (): void => {
  const host = document.querySelector<HTMLElement>("[data-staleset]");
  const start2 = host?.querySelector<HTMLButtonElement>(`[data-go="start"]`);
  if (!host || !start2) return;
  start2.addEventListener("click", () => {
    const stage = host.querySelector<HTMLElement>("[data-ss-stage]");
    if (stage) new StaleSet(stage);
  });
};

// Per page load: this module is evaluated once for the session, so a lesson
// arrived at by going back would otherwise render its Start button unwired.
document.addEventListener("astro:page-load", mount);
