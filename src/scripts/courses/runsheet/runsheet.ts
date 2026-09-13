// Runner and view for lesson 12's run sheet.
//
// Same shape as the other staged interactives in the track: the shell is built
// once and only [data-rs-body] is ever replaced, the stylesheet is global and
// hand-namespaced under .rs, and there is no bare <header> anywhere (global.css
// pins that as site chrome).
//
// This file decides nothing. It holds the reader's settings, hands them to
// engine.ts, and paints what comes back. A round is cleared when the engine
// reports no bad consequence, never when the settings match something here.
//
// The timeline is the reason this panel exists. Pods as bars against time is the
// one view where a replacement starting from zero, a hang that never ends, and
// two syncs on top of each other are visible rather than described, so it's
// always drawn from the simulation and never from a canned picture.

import { rounds, type Field, type Round, type Settings } from "./rounds";
import { manifest, run, setting, type Finding, type Outcome, type Timeline } from "./engine";

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", [`"`]: "&quot;" })[c] ?? c);

/** Findings and notes are written with backticks, the way the prose is. */
const prose = (s: string): string => esc(s).replace(/`([^`]+)`/g, `<code class="rs-code">$1</code>`);

const yamlHtml = (text: string): string =>
  esc(text)
    .replace(/^(\s*)(#.*)$/, `$1<span class="rs-comment">$2</span>`)
    .replace(/^(\s*)(- )?([\w.-]+)(:)/, (_m, sp: string, dash: string | undefined, key: string, colon: string) =>
      `${sp}${dash ? `<span class="rs-dash">${dash}</span>` : ""}<b class="rs-key">${key}</b>${colon}`,
    );

const pct = (t: Timeline, v: number): number =>
  Math.max(0, Math.min(100, ((v - t.from) / (t.to - t.from)) * 100));

class RunSheet {
  private root: HTMLElement;
  private body: HTMLElement;
  private rail: HTMLElement;
  private i = 0;
  private settings: Settings = {};
  private outcome: Outcome | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="rs-shell">
        <div class="rs-head">
          <ol class="rs-rail" data-rs-rail aria-label="Tasks"></ol>
        </div>
        <div class="rs-body" data-rs-body></div>
      </div>`;
    const body = root.querySelector<HTMLElement>("[data-rs-body]");
    const rail = root.querySelector<HTMLElement>("[data-rs-rail]");
    if (!body || !rail) throw new Error("run sheet failed to mount");
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

  private fieldsHtml(r: Round): string {
    return r.fields
      .map((f: Field) => {
        const now = setting(this.settings, f.id);
        const opts = f.choices
          .map((c) => {
            const on = c.value === now;
            return `<button type="button" class="rs-choice" data-field="${f.id}" data-value="${esc(c.value)}"
              aria-pressed="${on}" ${this.cleared ? "disabled" : ""}>${esc(c.label)}</button>`;
          })
          .join("");
        return `<div class="rs-field">
          <span class="rs-path">${esc(f.path)}</span>
          <div class="rs-choices" role="group" aria-label="${esc(f.path)}">${opts}</div>
        </div>`;
      })
      .join("");
  }

  private specHtml(r: Round): string {
    const rows = manifest(r, this.settings)
      .map((line) => {
        const changed = line.field !== undefined && setting(this.settings, line.field) !== setting(r.start, line.field);
        return `<li${line.field ? ` data-knob="yes"` : ""}${changed ? ` data-changed="yes"` : ""}
          ><span class="rs-gutter" aria-hidden="true">${changed ? "~" : " "}</span
          ><span class="rs-line">${yamlHtml(line.text)}</span></li>`;
      })
      .join("");
    return `<div class="rs-spec">
      <p class="rs-panel-head">${esc(r.world.name)}.yaml <span class="rs-hint">tinted lines are yours to change</span></p>
      <ol class="rs-yaml">${rows}</ol>
    </div>`;
  }

  private timelineHtml(t: Timeline): string {
    const ticks = t.ticks
      .map((k, idx) => {
        const edge = idx === 0 ? "start" : idx === t.ticks.length - 1 ? "end" : "mid";
        return `<span class="rs-tick" data-edge="${edge}" style="left:${pct(t, k.at)}%">${esc(k.label)}</span>`;
      })
      .join("");
    const target = t.target === undefined ? "" : `<span class="rs-target" style="left:${pct(t, t.target)}%"></span>`;
    const rows = t.rows
      .map((row) => {
        const bars = row.bars
          .map((b) => {
            const left = pct(t, b.from);
            const width = Math.max(pct(t, b.to) - left, 0.6);
            return `<span class="rs-bar" data-state="${b.state}" data-end="${b.end ?? "ok"}" data-open="${
              b.open ? "yes" : "no"
            }" style="left:${left}%;width:${width}%" title="${esc(b.title)}"></span>`;
          })
          .join("");
        const skip = row.skipAt === undefined ? "" : `<span class="rs-skip" style="left:${pct(t, row.skipAt)}%"></span>`;
        return `<li class="rs-row">
          <span class="rs-row-label"><span class="rs-name">${esc(row.label)}</span>${
            row.sub ? `<span class="rs-sub">${esc(row.sub)}</span>` : ""
          }</span>
          <span class="rs-track">${target}${bars}${skip}</span>
          <span class="rs-tag" data-tone="${row.tone}">${esc(row.tag)}</span>
        </li>`;
      })
      .join("");
    return `<div class="rs-timeline">
      <p class="rs-panel-head">What happened <span class="rs-hint">${esc(t.caption)}</span></p>
      <div class="rs-grid">
        <div class="rs-axis"><span class="rs-axis-pad"></span><span class="rs-ticks">${ticks}</span><span class="rs-axis-pad"></span></div>
        <ol class="rs-rows">${rows}</ol>
      </div>
      <p class="rs-legend">
        <span><i data-k="run"></i>working</span>
        <span><i data-k="hung"></i>alive, doing nothing</span>
        <span><i data-k="bad"></i>ended badly</span>
      </p>
    </div>`;
  }

  private terminalHtml(o: Outcome): string {
    if (!o.terminal) return "";
    return `<pre class="rs-term"><span class="rs-prompt">$ ${esc(o.terminal.command)}</span>
${o.terminal.lines.map(esc).join("\n")}</pre>`;
  }

  private findingsHtml(findings: Finding[]): string {
    if (findings.length === 0) return "";
    return `<ul class="rs-findings">${findings
      .map((f) => `<li class="rs-finding" data-tone="${f.tone}">${prose(f.text)}</li>`)
      .join("")}</ul>`;
  }

  private round(): void {
    const r = rounds[this.i];
    if (!r) return this.summary();
    this.settings = { ...r.start };
    this.outcome = null;
    this.paintRail();
    this.body.innerHTML = `
      <div class="rs-stage">
        <p class="rs-kicker">Task ${r.n} of ${rounds.length}</p>
        <h3 class="rs-title">${esc(r.title)}</h3>
        <blockquote class="rs-brief">${esc(r.brief)}</blockquote>
        <div class="rs-work">
          <div data-rs-fields></div>
          <div data-rs-spec></div>
        </div>
        <div data-rs-result></div>
        <div data-rs-foot></div>
      </div>`;
    this.paint(r);
  }

  private paint(r: Round): void {
    const fields = this.body.querySelector<HTMLElement>("[data-rs-fields]");
    const spec = this.body.querySelector<HTMLElement>("[data-rs-spec]");
    const result = this.body.querySelector<HTMLElement>("[data-rs-result]");
    const foot = this.body.querySelector<HTMLElement>("[data-rs-foot]");
    if (!fields || !spec || !result || !foot) return;

    fields.innerHTML = `<p class="rs-prompt">The spec as it was written</p>${this.fieldsHtml(r)}`;
    spec.innerHTML = this.specHtml(r);

    const o = this.outcome;
    result.innerHTML = o ? `${this.timelineHtml(o.timeline)}${this.terminalHtml(o)}${this.findingsHtml(o.findings)}` : "";

    const last = this.i === rounds.length - 1;
    const go = this.cleared
      ? `<button type="button" class="rs-btn" data-tone="primary" data-go="next">
           ${last ? "What all five had in common" : "Next task"}
         </button>`
      : `<button type="button" class="rs-btn" data-tone="primary" data-go="run">${o ? "Run it again" : "Run it"}</button>`;
    const note = this.cleared ? `<p class="rs-note">${prose(r.note)}</p>` : "";
    foot.innerHTML = `${note}<div class="rs-foot">${go}</div>`;

    fields.querySelectorAll<HTMLButtonElement>(".rs-choice").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.field as Field["id"] | undefined;
        const value = btn.dataset.value;
        if (!id || value === undefined || this.cleared) return;
        this.settings = { ...this.settings, [id]: value };
        // A changed setting invalidates the last run. Leaving its timeline up
        // would show the consequences of a spec the reader has moved on from.
        this.outcome = null;
        this.paint(r);
      });
    });
    foot.querySelector<HTMLButtonElement>(`[data-go="run"]`)?.addEventListener("click", () => {
      this.outcome = run(r, this.settings);
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
      <div class="rs-stage">
        <p class="rs-kicker">Five tasks later</p>
        <h3 class="rs-title">What a Job actually promises</h3>
        <p class="rs-plain">
          A Job promises the work finishes, even if that means running it more than once. It retries
          whatever fails, a drained node counts as failing, and a retry starts your
          command from the top, so the fix for doing things twice lives in your code.
          It also can't tell a stuck process from a slow one, which is what a deadline
          is for.
        </p>
        <p class="rs-plain">
          A CronJob is a clock that makes Jobs. It doesn't know how long yours take, so
          it'll start the next one on top of the last unless you say otherwise, and it
          reads the schedule on its own clock unless you give it yours.
        </p>
        <div class="rs-foot">
          <button type="button" class="rs-btn" data-go="again">Start over</button>
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
  const host = document.querySelector<HTMLElement>("[data-runsheet]");
  const start = host?.querySelector<HTMLButtonElement>(`[data-go="start"]`);
  if (!host || !start) return;
  start.addEventListener("click", () => {
    const stage = host.querySelector<HTMLElement>("[data-rs-stage]");
    if (stage) new RunSheet(stage);
  });
};

// Per page load: this module is evaluated once for the session, so a lesson
// arrived at by going back would otherwise render its Start button unwired.
document.addEventListener("astro:page-load", mount);
