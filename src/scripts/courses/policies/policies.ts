// Runner and view for lesson 19's policy puzzle.
//
// Same shell as the service desk: built once, only [data-np-body] replaced after
// that, the stylesheet global and namespaced under .np, and no bare <header>.
//
// Each policy is a card: the directions it isolates, the rule entries that can go
// in it, and the YAML those produce, generated from the reader's own choices so
// the one-dash difference in round 2 is right there to see. Switching an entry on
// isolates its direction, since a rule under a direction nothing isolates does
// nothing, and un-isolating a direction switches its entries off. Checking runs
// every connection through engine.ts. Any change throws the last result away.

import { endpoints, rounds, type Check, type Direction, type PolicyDef, type Round, type Setup } from "./rounds";
import { evaluate, policyYaml, type Outcome } from "./engine";

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", [`"`]: "&quot;" })[c] ?? c);

const prose = (s: string): string => esc(s).replace(/`([^`]+)`/g, `<code class="np-code">$1</code>`);

const yamlHtml = (text: string): string =>
  text.startsWith("#")
    ? `<span class="np-dash">${esc(text)}</span>`
    : esc(text)
        .replace(/^(\s*)([\w./-]+)(:)/, `$1<b class="np-key">$2</b>$3`)
        .replace(/^(\s*)(- )([\w.-]+)(:)/, `$1<span class="np-dash">$2</span><b class="np-key">$3</b>$4`)
        .replace(/^(\s*)(- )(?!<)/, `$1<span class="np-dash">$2</span>`);

const DIRS: Direction[] = ["ingress", "egress"];

const nameOf = (id: string): string => endpoints.find((e) => e.id === id)?.name ?? id;

const where = (id: string): string => {
  const e = endpoints.find((x) => x.id === id);
  return e?.ns && e.ns !== "shop" ? ` <span class="np-ns">in ${esc(e.ns)}</span>` : "";
};

class PolicyPuzzle {
  private root: HTMLElement;
  private body: HTMLElement;
  private rail: HTMLElement;
  private i = 0;
  private setup: Setup = { on: [], isolated: [] };
  private outcome: Outcome | null = null;
  private cleared = false;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="np-shell">
        <div class="np-head">
          <ol class="np-rail" data-np-rail aria-label="Requirements"></ol>
        </div>
        <div class="np-body" data-np-body></div>
      </div>`;
    const body = root.querySelector<HTMLElement>("[data-np-body]");
    const rail = root.querySelector<HTMLElement>("[data-np-rail]");
    if (!body || !rail) throw new Error("policy puzzle failed to mount");
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

  private round(): void {
    const r = rounds[this.i];
    if (!r) return this.summary();
    this.setup = { on: [...r.start.on], isolated: [...r.start.isolated] };
    this.outcome = null;
    this.cleared = false;
    this.paintRail();
    this.body.innerHTML = `
      <div class="np-stage">
        <p class="np-kicker">Requirement ${r.n} of ${rounds.length}</p>
        <h3 class="np-title">${esc(r.title)}</h3>
        <blockquote class="np-brief">${esc(r.brief)}</blockquote>
        <div data-np-policies></div>
        <div data-np-results></div>
        <div data-np-foot></div>
      </div>`;
    this.paint(r);
  }

  private checkLine(c: Check): string {
    const to = endpoints.find((e) => e.id === c.to);
    return `<span class="np-conn"><code>${esc(nameOf(c.from))}</code>${where(c.from)} to ${
      to?.ip ? esc(to.name) : `<code>${esc(nameOf(c.to))}</code>${where(c.to)}`
    } on ${c.port}${c.byName ? `, by the name <code>${esc(c.byName)}</code>` : ""}</span>`;
  }

  private policyHtml(r: Round, p: PolicyDef): string {
    const dis = this.cleared ? " disabled" : "";
    const dirs = DIRS.filter((d) => p.offer.includes(d) || r.entries.some((e) => e.policy === p.name && e.dir === d));
    const groups = dirs
      .map((d) => {
        const key = `${p.name}:${d}`;
        const iso = this.setup.isolated.includes(key);
        const entries = r.entries.filter((e) => e.policy === p.name && e.dir === d);
        const toggle = p.offer.includes(d)
          ? `<button type="button" class="np-toggle" data-plain="yes" data-iso="${esc(key)}" aria-pressed="${iso}"${dis}>
               isolate ${d}${iso ? `, allow only what's below` : ""}
             </button>`
          : `<span class="np-fixed">${d} ${iso ? "isolated" : "not isolated"}</span>`;
        const list = entries.length
          ? `<ul class="np-entries">${entries
              .map(
                (e) => `<li><button type="button" class="np-toggle np-entry" data-plain="yes" data-entry="${esc(e.id)}"
                  aria-pressed="${this.setup.on.includes(e.id)}"${dis}>${esc(e.label)}</button></li>`,
              )
              .join("")}</ul>`
          : "";
        return `<div class="np-dir" data-iso="${iso ? "yes" : "no"}">${toggle}${list}</div>`;
      })
      .join("");
    return `<div class="np-policy">
      <div class="np-policy-edit">
        <p class="np-label">NetworkPolicy <code>${esc(p.name)}</code>, for pods ${esc(
          Object.entries(p.selects)
            .map(([k, v]) => `${k}=${v}`)
            .join(", "),
        )}</p>
        ${groups}
      </div>
      <div class="np-panel">
        <p class="np-panel-head">${esc(p.name)}.yaml</p>
        <ol class="np-yaml">${policyYaml(r, p, this.setup)
          .map((l) => `<li>${yamlHtml(l)}</li>`)
          .join("")}</ol>
      </div>
    </div>`;
  }

  private resultsHtml(r: Round, o: Outcome): string {
    const rows = o.results
      .map(
        (x) => `<li data-ok="${x.ok ? "yes" : "no"}">
          ${this.checkLine(x.check)}
          <span class="np-want">${x.check.want ? "should connect" : "should be blocked"}</span>
          <span class="np-got">${x.dnsFailed ? "lookup timed out" : x.allowed ? "connects" : "blocked"}</span>
        </li>`,
      )
      .join("");
    return `<p class="np-label">The connections</p>
      <ol class="np-results">${rows}</ol>
      <ul class="np-findings">${o.findings
        .map((f) => `<li class="np-finding" data-tone="${f.tone}">${prose(f.text)}</li>`)
        .join("")}</ul>
      ${this.cleared ? `<p class="np-note">${prose(r.note)}</p>` : ""}`;
  }

  private paint(r: Round): void {
    const policies = this.body.querySelector<HTMLElement>("[data-np-policies]");
    const results = this.body.querySelector<HTMLElement>("[data-np-results]");
    const foot = this.body.querySelector<HTMLElement>("[data-np-foot]");
    if (!policies || !results || !foot) return;

    const pending = this.outcome
      ? ""
      : `<p class="np-label">Has to hold afterwards</p>
         <ul class="np-results">${r.checks
           .map(
             (c) => `<li data-ok="todo">${this.checkLine(c)}<span class="np-want">${
               c.want ? "should connect" : "should be blocked"
             }</span><span class="np-got"></span></li>`,
           )
           .join("")}</ul>`;
    policies.innerHTML = `${r.policies.map((p) => this.policyHtml(r, p)).join("")}${pending}`;
    results.innerHTML = this.outcome ? this.resultsHtml(r, this.outcome) : "";

    const last = this.i === rounds.length - 1;
    foot.innerHTML = `<div class="np-foot">${
      this.cleared
        ? `<button type="button" class="np-btn" data-tone="primary" data-go="next">${last ? "Wrap up" : "Next requirement"}</button>`
        : `<button type="button" class="np-btn" data-tone="primary" data-go="check">Apply and test the connections</button>
           <button type="button" class="np-restart" data-go="reset">Put the policies back</button>`
    }</div>`;

    const change = (f: () => void): void => {
      if (this.cleared) return;
      f();
      this.outcome = null;
      this.paint(r);
    };
    policies.querySelectorAll<HTMLButtonElement>("[data-iso]").forEach((b) =>
      b.addEventListener("click", () =>
        change(() => {
          const key = b.dataset.iso ?? "";
          if (this.setup.isolated.includes(key)) {
            this.setup.isolated = this.setup.isolated.filter((k) => k !== key);
            this.setup.on = this.setup.on.filter((id) => {
              const e = r.entries.find((x) => x.id === id);
              return !e || `${e.policy}:${e.dir}` !== key;
            });
          } else {
            this.setup.isolated.push(key);
          }
        }),
      ),
    );
    policies.querySelectorAll<HTMLButtonElement>("[data-entry]").forEach((b) =>
      b.addEventListener("click", () =>
        change(() => {
          const e = r.entries.find((x) => x.id === b.dataset.entry);
          if (!e) return;
          if (this.setup.on.includes(e.id)) {
            this.setup.on = this.setup.on.filter((x) => x !== e.id);
          } else {
            this.setup.on.push(e.id);
            const key = `${e.policy}:${e.dir}`;
            if (!this.setup.isolated.includes(key)) this.setup.isolated.push(key);
          }
        }),
      ),
    );
    foot.querySelector(`[data-go="check"]`)?.addEventListener("click", () => {
      this.outcome = evaluate(r, this.setup);
      this.cleared = this.outcome.cleared;
      this.paint(r);
    });
    foot.querySelector(`[data-go="reset"]`)?.addEventListener("click", () =>
      change(() => {
        this.setup = { on: [...r.start.on], isolated: [...r.start.isolated] };
      }),
    );
    foot.querySelector(`[data-go="next"]`)?.addEventListener("click", () => {
      this.i += 1;
      this.round();
      this.scrollIntoFrame();
    });
  }

  private summary(): void {
    this.paintRail();
    this.body.innerHTML = `
      <div class="np-stage">
        <p class="np-kicker">Four requirements later</p>
        <h3 class="np-title">What a policy really says</h3>
        <p class="np-plain">
          A policy picks some pods and makes them refuse everything in one direction,
          then lists what they'll still take. Nothing else in the language exists. Every
          mistake in there was an allow that reached further than it read: a whole
          namespace, a second entry, every address on the internet.
        </p>
        <p class="np-plain">
          And every policy only changed the pods it selected. Nobody wrote one for
          frontend or grafana, so the whole time, they could still open a connection to
          anything that didn't refuse it.
        </p>
        <div class="np-foot">
          <button type="button" class="np-btn" data-go="again">Start over</button>
        </div>
      </div>`;
    this.body.querySelector(`[data-go="again"]`)?.addEventListener("click", () => {
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
  const host = document.querySelector<HTMLElement>("[data-policies]");
  const go = host?.querySelector<HTMLButtonElement>(`[data-go="start"]`);
  if (!host || !go) return;
  go.addEventListener("click", () => {
    const stage = host.querySelector<HTMLElement>("[data-np-stage]");
    if (stage) new PolicyPuzzle(stage);
  });
};

// Per page load: this module is evaluated once for the session, so a lesson
// arrived at by going back would otherwise render its Start button unwired.
document.addEventListener("astro:page-load", mount);
