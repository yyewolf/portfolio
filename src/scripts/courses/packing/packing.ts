// Runner and view for lesson 9's pod packing.
//
// Same shape as the other staged interactives in the track: the shell is built
// once and only [data-pk-body] is ever replaced, so four applications do not
// read as four pages. Markup is assembled at runtime, so the stylesheet is
// global and hand-namespaced under .pk and there is no bare <header> anywhere
// (global.css pins that as site chrome).
//
// The one rule worth keeping: this file decides nothing. It collects a
// placement, hands it to engine.ts, and paints whatever comes back. A round is
// cleared when the engine reports no bad consequence, never when the placement
// matches something written down here, because the reader is allowed to find an
// arrangement the author did not think of and be right.

import { rounds, type Proc, type Round } from "./rounds";
import { evaluate, manifest, podLabel, pods, solved, type Finding, type Placement } from "./engine";

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", [`"`]: "&quot;" })[c] ?? c);

/**
 * Enough YAML colouring to read as a manifest rather than a paragraph. Shiki is
 * build time only and these strings are generated in the browser from the
 * reader's own arrangement, so this paints the two things that matter: keys and
 * list bullets.
 */
const yamlHtml = (yaml: string): string =>
  yaml
    .split("\n")
    .map((line) =>
      esc(line)
        .replace(/^(\s*)([\w.-]+)(:)/, `$1<b class="pk-key">$2</b>$3`)
        .replace(/^(\s*)(- )/, `$1<span class="pk-dash">$2</span>`),
    )
    .join("\n");

interface Slot {
  pod: string;
  init: boolean;
  label: string;
}

const slotsFor = (round: Round): Slot[] =>
  round.pods.flatMap((pod) =>
    round.init
      ? [
          { pod, init: true, label: `${podLabel(pod)}, before start` },
          { pod, init: false, label: podLabel(pod) },
        ]
      : [{ pod, init: false, label: podLabel(pod) }],
  );

class Packing {
  private root: HTMLElement;
  private body: HTMLElement;
  private rail: HTMLElement;
  private i = 0;
  private placement: Placement = {};
  private findings: Finding[] = [];
  private done = false;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="pk-shell">
        <div class="pk-head">
          <ol class="pk-rail" data-pk-rail aria-label="Applications"></ol>
        </div>
        <div class="pk-body" data-pk-body></div>
      </div>`;
    const body = root.querySelector<HTMLElement>("[data-pk-body]");
    const rail = root.querySelector<HTMLElement>("[data-pk-rail]");
    if (!body || !rail) throw new Error("packing failed to mount");
    this.body = body;
    this.rail = rail;
    this.round();
  }

  private paintRail(): void {
    this.rail.innerHTML = rounds
      .map((r) => {
        const state = r.n - 1 < this.i ? "done" : r.n - 1 === this.i ? "current" : "todo";
        return `<li data-state="${state}"><span>${r.n}</span></li>`;
      })
      .join("");
  }

  private procHtml(round: Round, p: Proc): string {
    const at = this.placement[p.id];
    const slots = slotsFor(round)
      .map((s) => {
        const on = at?.pod === s.pod && at.init === s.init;
        return `<button type="button" class="pk-slot" data-pod="${s.pod}" data-init="${s.init}"
          data-on="${on ? "yes" : "no"}" aria-pressed="${on}"
          ${this.done ? "disabled" : ""}>${esc(s.label)}</button>`;
      })
      .join("");
    return `<li class="pk-proc" data-proc="${p.id}">
      <div class="pk-proc-head">
        <span class="pk-proc-name">${esc(p.name)}</span>
        <span class="pk-proc-image">${esc(p.image)}</span>
      </div>
      <p class="pk-proc-what">${esc(p.what)}</p>
      <div class="pk-slots" role="group" aria-label="Where does ${esc(p.name)} go?">${slots}</div>
    </li>`;
  }

  /** The arrangement as it stands. Redrawn on every click, so it is cheap. */
  private podsHtml(round: Round): string {
    const built = pods(round, this.placement);
    const left = round.procs.filter((p) => !this.placement[p.id]).length;
    const boxes = built
      .map((pod) => {
        const rows = [
          ...pod.init.map(
            (p) =>
              `<li data-init="yes">${esc(p.name)}<span class="pk-tag">before start</span></li>`,
          ),
          ...pod.main.map((p) => `<li>${esc(p.name)}</li>`),
        ].join("");
        return `<div class="pk-pod">
          <p class="pk-pod-label">${esc(pod.label)}</p>
          <ul class="pk-pod-list">${rows}</ul>
        </div>`;
      })
      .join("");
    const empty = built.length === 0 ? `<p class="pk-empty">Nothing placed yet.</p>` : boxes;
    const foot =
      left > 0
        ? `<p class="pk-left">${left} still to place</p>`
        : `<p class="pk-left" data-ready="yes">Every process has somewhere to go.</p>`;
    return `<div class="pk-pods">${empty}</div>${foot}`;
  }

  private findingsHtml(): string {
    if (this.findings.length === 0) return "";
    const items = this.findings
      .map((f) => `<li class="pk-finding" data-tone="${f.tone}">${esc(f.text)}</li>`)
      .join("");
    return `<ul class="pk-findings">${items}</ul>`;
  }

  private resultHtml(round: Round): string {
    if (!this.done) return "";
    const files = pods(round, this.placement)
      .map(
        (pod) =>
          `<li class="pk-file">
            <p class="pk-file-name">${esc(pod.name)}.yaml</p>
            <pre class="pk-yaml"><code>${yamlHtml(manifest(round, pod))}</code></pre>
          </li>`,
      )
      .join("");
    return `<div class="pk-written">
      <p class="pk-written-head">What you just described</p>
      <ul class="pk-files">${files}</ul>
      <p class="pk-note">${esc(round.note)}</p>
    </div>`;
  }

  private round(): void {
    const r = rounds[this.i];
    if (!r) return this.summary();
    this.placement = Object.fromEntries(r.procs.map((p) => [p.id, null]));
    this.findings = [];
    this.done = false;
    this.paintRail();
    this.body.innerHTML = `
      <div class="pk-stage">
        <p class="pk-kicker">Application ${r.n} of ${rounds.length}</p>
        <h3 class="pk-title">${esc(r.title)}</h3>
        <p class="pk-brief">${esc(r.brief)}</p>
        <ul class="pk-procs" data-pk-procs></ul>
        <div data-pk-arrangement></div>
        <div data-pk-foot></div>
      </div>`;
    this.paintProcs(r);
    this.paintArrangement(r);
    this.paintFoot(r);
  }

  private paintProcs(r: Round): void {
    const host = this.body.querySelector<HTMLElement>("[data-pk-procs]");
    if (!host) return;
    host.innerHTML = r.procs.map((p) => this.procHtml(r, p)).join("");
    host.querySelectorAll<HTMLButtonElement>(".pk-slot").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.closest<HTMLElement>("[data-proc]")?.dataset.proc;
        const pod = btn.dataset.pod;
        if (!id || !pod || this.done) return;
        this.placement[id] = { pod, init: btn.dataset.init === "true" };
        // A change invalidates the last run. Leaving the findings up would let
        // the reader read a consequence of an arrangement they have moved on
        // from, which is the one mistake this panel exists to argue against.
        this.findings = [];
        this.paintProcs(r);
        this.paintArrangement(r);
        this.paintFoot(r);
      });
    });
  }

  private paintArrangement(r: Round): void {
    const host = this.body.querySelector<HTMLElement>("[data-pk-arrangement]");
    if (host) host.innerHTML = this.podsHtml(r);
  }

  private paintFoot(r: Round): void {
    const host = this.body.querySelector<HTMLElement>("[data-pk-foot]");
    if (!host) return;
    const ready = r.procs.every((p) => this.placement[p.id]);
    const last = this.i === rounds.length - 1;
    const run = this.done
      ? ""
      : `<button type="button" class="pk-btn" data-tone="primary" data-go="run" ${ready ? "" : "disabled"}>
           ${this.findings.length > 0 ? "Run it again" : "Run it"}
         </button>`;
    const next = this.done
      ? `<button type="button" class="pk-btn" data-tone="primary" data-go="next">
           ${last ? "See where that leaves you" : "Next application"}
         </button>`
      : "";
    host.innerHTML = `${this.findingsHtml()}${this.resultHtml(r)}<div class="pk-foot">${run}${next}</div>`;

    host.querySelector<HTMLButtonElement>(`[data-go="run"]`)?.addEventListener("click", () => {
      this.findings = evaluate(r, this.placement);
      this.done = solved(this.findings);
      this.paintProcs(r);
      this.paintFoot(r);
    });
    host.querySelector<HTMLButtonElement>(`[data-go="next"]`)?.addEventListener("click", () => {
      this.i += 1;
      this.round();
      this.scrollIntoFrame();
    });
  }

  private summary(): void {
    this.paintRail();
    this.body.innerHTML = `
      <div class="pk-stage">
        <p class="pk-kicker">Four applications later</p>
        <h3 class="pk-title">You were never choosing containers</h3>
        <p class="pk-brief">
          Every round was the same question asked four ways: do these two things have
          to be copied the same number of times, reached at the same address, given
          the same directory, and started and stopped together? Four yeses and it's
          one pod. A single no and it's two, however much they feel like one
          application.
        </p>
        <div class="pk-foot">
          <button type="button" class="pk-btn" data-go="again">Start over</button>
        </div>
      </div>`;
    this.body.querySelector<HTMLButtonElement>(`[data-go="again"]`)?.addEventListener("click", () => {
      this.i = 0;
      this.round();
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
  const host = document.querySelector<HTMLElement>("[data-packing]");
  const start = host?.querySelector<HTMLButtonElement>(`[data-go="start"]`);
  if (!host || !start) return;
  start.addEventListener("click", () => {
    const stage = host.querySelector<HTMLElement>("[data-pk-stage]");
    if (stage) new Packing(stage);
  });
};

// Per page load: this module is evaluated once for the session, so a lesson
// arrived at by going back would otherwise render its Start button unwired.
document.addEventListener("astro:page-load", mount);
