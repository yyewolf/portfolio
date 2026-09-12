// Runner and view for lesson 10's change desk.
//
// Same shape as the other staged interactives in the track: the shell is built
// once and only [data-cd-body] is ever replaced, so five requests do not read as
// five pages. Markup is assembled at runtime, so the stylesheet is global and
// hand-namespaced under .cd and there is no bare <header> anywhere (global.css
// pins that as site chrome).
//
// This file decides nothing. It collects a set of switched-on edits, hands them
// to engine.ts, and paints what comes back. A round is cleared when the engine
// reports no bad consequence, never when the edits match something written down
// here.
//
// The spec is the main panel rather than a detail, because the reader's job is
// to find the template in it. Lines inside the template are tinted, changed
// lines are marked in the gutter, and the pod list sits underneath so a rollout
// is visible as names moving rather than as a sentence about names moving.

import { rounds, type Edit, type Round } from "./rounds";
import {
  applyEdits,
  diff,
  manifest,
  podNames,
  run,
  type Finding,
  type Outcome,
} from "./engine";

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", [`"`]: "&quot;" })[c] ?? c);

/** Findings and notes are written with backticks, the way the prose is. */
const prose = (s: string): string =>
  esc(s).replace(/`([^`]+)`/g, `<code class="cd-code">$1</code>`);

/**
 * Enough YAML colouring to read as a manifest rather than a paragraph. Shiki is
 * build time only and these lines are generated in the browser from the reader's
 * own spec, so this paints the two things that matter: keys and list bullets.
 */
const yamlHtml = (text: string): string =>
  esc(text)
    .replace(/^(\s*)([\w.-]+)(:)/, `$1<b class="cd-key">$2</b>$3`)
    .replace(/^(\s*)(- )/, `$1<span class="cd-dash">$2</span>`);

class Changes {
  private root: HTMLElement;
  private body: HTMLElement;
  private rail: HTMLElement;
  private i = 0;
  private on = new Set<string>();
  private outcome: Outcome | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="cd-shell">
        <div class="cd-head">
          <ol class="cd-rail" data-cd-rail aria-label="Requests"></ol>
        </div>
        <div class="cd-body" data-cd-body></div>
      </div>`;
    const body = root.querySelector<HTMLElement>("[data-cd-body]");
    const rail = root.querySelector<HTMLElement>("[data-cd-rail]");
    if (!body || !rail) throw new Error("change desk failed to mount");
    this.body = body;
    this.rail = rail;
    this.round();
  }

  private get cleared(): boolean {
    return this.outcome?.cleared ?? false;
  }

  private paintRail(): void {
    this.rail.innerHTML = rounds
      .map((r) => {
        const state = r.n - 1 < this.i ? "done" : r.n - 1 === this.i ? "current" : "todo";
        return `<li data-state="${state}"><span>${r.n}</span></li>`;
      })
      .join("");
  }

  /** The spec as it would read if the reader applied what is switched on. */
  private specHtml(r: Round): string {
    const next = applyEdits(r.spec, r.edits, this.on);
    const touched = new Set(diff(r.spec, next).map((c) => c.field));
    const fresh = new Set(
      diff(r.spec, next)
        .filter((c) => c.from === null)
        .map((c) => c.field),
    );
    const rows = manifest(next)
      .map((line) => {
        const changed = line.field && touched.has(line.field);
        const mark = !changed ? " " : fresh.has(line.field as string) ? "+" : "~";
        return `<li${line.tmpl ? ` data-tmpl="yes"` : ""}${changed ? ` data-changed="yes"` : ""}
          ><span class="cd-gutter" aria-hidden="true">${mark}</span
          ><span class="cd-line">${yamlHtml(line.text)}</span></li>`;
      })
      .join("");
    return `<div class="cd-spec">
      <p class="cd-panel-head">deployment.yaml <span class="cd-hint">the tinted block is the template</span></p>
      <ol class="cd-yaml">${rows}</ol>
    </div>`;
  }

  /** Pods before the apply, or before and after it once there is an outcome. */
  private podsHtml(r: Round): string {
    const o = this.outcome;
    const before = podNames(r.spec);
    if (!o) {
      const rows = before.map((n) => `<li>${esc(n)}</li>`).join("");
      return `<div class="cd-pods">
        <p class="cd-panel-head">Running now</p>
        <ol class="cd-podlist">${rows}</ol>
      </div>`;
    }
    const kept = o.after.filter((n) => before.includes(n));
    const rows = [
      ...o.after.map(
        (n) =>
          `<li data-state="${kept.includes(n) ? "kept" : "new"}">${esc(n)}<span class="cd-tag">${
            kept.includes(n) ? "still there" : "new"
          }</span></li>`,
      ),
      ...before
        .filter((n) => !o.after.includes(n))
        .map((n) => `<li data-state="gone">${esc(n)}<span class="cd-tag">gone</span></li>`),
    ].join("");
    return `<div class="cd-pods">
      <p class="cd-panel-head">After the apply</p>
      <ol class="cd-podlist">${rows}</ol>
    </div>`;
  }

  private editsHtml(r: Round): string {
    const rows = r.edits
      .map((e: Edit) => {
        const on = this.on.has(e.id);
        return `<li>
          <button type="button" class="cd-edit" data-edit="${e.id}" data-on="${on ? "yes" : "no"}"
            aria-pressed="${on}" ${this.cleared ? "disabled" : ""}>
            <span class="cd-box" aria-hidden="true"></span>
            <span class="cd-edit-text">
              <span class="cd-edit-label">${esc(e.label)}</span>
              <span class="cd-edit-field">${esc(e.field)}</span>
            </span>
          </button>
        </li>`;
      })
      .join("");
    return `<ul class="cd-edits" data-cd-edits>${rows}</ul>`;
  }

  private findingsHtml(findings: Finding[]): string {
    if (findings.length === 0) return "";
    const items = findings
      .map((f) => `<li class="cd-finding" data-tone="${f.tone}">${prose(f.text)}</li>`)
      .join("");
    return `<ul class="cd-findings">${items}</ul>`;
  }

  private round(): void {
    const r = rounds[this.i];
    if (!r) return this.summary();
    this.on = new Set();
    this.outcome = null;
    this.paintRail();
    this.body.innerHTML = `
      <div class="cd-stage">
        <p class="cd-kicker">Request ${r.n} of ${rounds.length}</p>
        <h3 class="cd-title">${esc(r.title)}</h3>
        <blockquote class="cd-brief">${esc(r.brief)}</blockquote>
        <div data-cd-edits-host></div>
        <div class="cd-panels" data-cd-panels></div>
        <div data-cd-foot></div>
      </div>`;
    this.paint(r);
  }

  private paint(r: Round): void {
    const editsHost = this.body.querySelector<HTMLElement>("[data-cd-edits-host]");
    const panels = this.body.querySelector<HTMLElement>("[data-cd-panels]");
    const foot = this.body.querySelector<HTMLElement>("[data-cd-foot]");
    if (!editsHost || !panels || !foot) return;

    editsHost.innerHTML = `<p class="cd-prompt">Change what needs changing, then apply it.</p>${this.editsHtml(r)}`;
    panels.innerHTML = `${this.specHtml(r)}${this.podsHtml(r)}`;

    const last = this.i === rounds.length - 1;
    const o = this.outcome;
    const apply = this.cleared
      ? ""
      : `<button type="button" class="cd-btn" data-tone="primary" data-go="apply" ${this.on.size === 0 && !o ? "disabled" : ""}>
           ${o ? "Apply again" : "Apply"}
         </button>`;
    const note = this.cleared ? `<p class="cd-note">${prose(r.note)}</p>` : "";
    const next = this.cleared
      ? `<button type="button" class="cd-btn" data-tone="primary" data-go="next">
           ${last ? "See what you've been doing" : "Next request"}
         </button>`
      : "";
    foot.innerHTML = `${this.findingsHtml(o?.findings ?? [])}${note}<div class="cd-foot">${apply}${next}</div>`;

    editsHost.querySelectorAll<HTMLButtonElement>(".cd-edit").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.edit;
        if (!id || this.cleared) return;
        if (this.on.has(id)) this.on.delete(id);
        else this.on.add(id);
        // Switching an edit invalidates the last apply. Leaving the findings up
        // would let the reader read a consequence of a spec they have moved on
        // from, which is the mistake this panel exists to argue against.
        this.outcome = null;
        this.paint(r);
      });
    });
    foot.querySelector<HTMLButtonElement>(`[data-go="apply"]`)?.addEventListener("click", () => {
      this.outcome = run(r, r.edits, this.on);
      this.paint(r);
    });
    foot.querySelector<HTMLButtonElement>(`[data-go="next"]`)?.addEventListener("click", () => {
      this.i += 1;
      this.round();
      this.scrollIntoFrame();
    });
  }

  private summary(): void {
    this.paintRail();
    this.body.innerHTML = `
      <div class="cd-stage">
        <p class="cd-kicker">Five requests later</p>
        <h3 class="cd-title">One question, five times</h3>
        <p class="cd-brief-plain">
          Is what I'm about to change inside the template or not? Inside it and every
          pod is replaced, because creating and deleting pods is the only thing a
          Deployment does to one. Outside it and the pods carry on exactly as they
          are. A count, a label, an image and a timestamp are all the same size of
          event to a Deployment, and the only one of those you'd have guessed was
          dangerous is the image.
        </p>
        <p class="cd-brief-plain">
          The middle chunk of every pod name moved every time the template did and
          never when it didn't, because that chunk is the ReplicaSet, and a template
          it has no set for is a template it needs a new set for.
        </p>
        <div class="cd-foot">
          <button type="button" class="cd-btn" data-go="again">Start over</button>
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
  const host = document.querySelector<HTMLElement>("[data-changes]");
  const start = host?.querySelector<HTMLButtonElement>(`[data-go="start"]`);
  if (!host || !start) return;
  start.addEventListener("click", () => {
    const stage = host.querySelector<HTMLElement>("[data-cd-stage]");
    if (stage) new Changes(stage);
  });
};

// Per page load: this module is evaluated once for the session, so a lesson
// arrived at by going back would otherwise render its Start button unwired.
document.addEventListener("astro:page-load", mount);
