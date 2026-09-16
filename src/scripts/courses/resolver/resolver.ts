// Runner and view for lesson 17's name lookup.
//
// Same shell as the service desk: built once, only [data-dn-body] replaced after
// that, the stylesheet global and namespaced under .dn, and no bare <header>.
//
// The reader types a name into a real form, so Enter works, and the panel prints
// the pod's resolv.conf next to every query the lookup made, in order, with what
// each one got back. The lookups the reader has tried this round stay listed
// underneath, newest first, so the search list's effect is visible across
// spellings. Nothing here decides what's right: engine.ts resolves and judges.

import { rounds, type Round } from "./rounds";
import { judge, lookup, resolvConf, type Lookup, type Verdict } from "./engine";

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", [`"`]: "&quot;" })[c] ?? c);

const prose = (s: string): string => esc(s).replace(/`([^`]+)`/g, `<code class="dn-code">$1</code>`);

interface Try {
  lookup: Lookup;
  verdict: Verdict;
}

class NameLookup {
  private root: HTMLElement;
  private body: HTMLElement;
  private rail: HTMLElement;
  private i = 0;
  private tries: Try[] = [];
  private cleared = false;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="dn-shell">
        <div class="dn-head">
          <ol class="dn-rail" data-dn-rail aria-label="Lookups"></ol>
        </div>
        <div class="dn-body" data-dn-body></div>
      </div>`;
    const body = root.querySelector<HTMLElement>("[data-dn-body]");
    const rail = root.querySelector<HTMLElement>("[data-dn-rail]");
    if (!body || !rail) throw new Error("name lookup failed to mount");
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
    this.tries = [];
    this.cleared = false;
    this.paintRail();
    this.body.innerHTML = `
      <div class="dn-stage">
        <p class="dn-kicker">Lookup ${r.n} of ${rounds.length}</p>
        <h3 class="dn-title">${esc(r.title)}</h3>
        <blockquote class="dn-brief">${esc(r.brief)}</blockquote>
        <div class="dn-panels">
          <div class="dn-panel">
            <p class="dn-panel-head">/etc/resolv.conf in ${esc(r.from.name)}, namespace ${esc(r.from.ns)}</p>
            <ol class="dn-yaml">${resolvConf(r.from)
              .map((l) => `<li>${esc(l)}</li>`)
              .join("")}</ol>
          </div>
        </div>
        <form class="dn-form" data-dn-form>
          <label class="dn-label" for="dn-name-${r.n}">The host name in the config</label>
          <div class="dn-row">
            <input id="dn-name-${r.n}" class="dn-input" data-dn-input type="text" autocomplete="off" autocapitalize="off"
              spellcheck="false" value="${esc(r.first)}" placeholder="a name" />
            <button type="submit" class="dn-btn" data-tone="primary">Look it up</button>
          </div>
        </form>
        <div data-dn-results></div>
        <div data-dn-foot></div>
      </div>`;
    const form = this.body.querySelector<HTMLFormElement>("[data-dn-form]");
    const input = this.body.querySelector<HTMLInputElement>("[data-dn-input]");
    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!input || this.cleared) return;
      const l = lookup(r.from, input.value);
      this.tries.unshift({ lookup: l, verdict: judge(r, l) });
      this.cleared = this.tries[0]?.verdict.cleared ?? false;
      if (this.cleared) {
        input.disabled = true;
        form.querySelector("button")?.setAttribute("disabled", "");
      }
      this.paint(r);
    });
    this.paint(r);
  }

  private tryHtml(t: Try, latest: boolean): string {
    const l = t.lookup;
    const queries = l.queries
      .map(
        (q) => `<li data-hit="${q.answer ? "yes" : "no"}">
          <span class="dn-q">${esc(q.name)}.</span>
          <span class="dn-a">${q.answer ? esc(q.answer.join(", ")) : "NXDOMAIN"}</span>
        </li>`,
      )
      .join("");
    const findings = t.verdict.findings
      .map((f) => `<li class="dn-finding" data-tone="${f.tone}">${prose(f.text)}</li>`)
      .join("");
    if (!latest) {
      return `<li class="dn-past" data-cleared="${t.verdict.cleared ? "yes" : "no"}">
        <code>${esc(l.typed || "(empty)")}</code>
        <span>${l.error ? "not a name" : `${l.queries.length} ${l.queries.length === 1 ? "query" : "queries"}, ${
          l.answer ? esc(l.answer.join(", ")) : "NXDOMAIN"
        }`}</span>
      </li>`;
    }
    return `${
      queries
        ? `<div class="dn-panel dn-queries">
            <p class="dn-panel-head">Queries for <code>${esc(l.typed)}</code>, in order</p>
            <ol class="dn-qlist">${queries}</ol>
          </div>`
        : ""
    }<ul class="dn-findings">${findings}</ul>`;
  }

  private paint(r: Round): void {
    const results = this.body.querySelector<HTMLElement>("[data-dn-results]");
    const foot = this.body.querySelector<HTMLElement>("[data-dn-foot]");
    if (!results || !foot) return;
    const [latest, ...past] = this.tries;
    results.innerHTML = latest
      ? `${this.tryHtml(latest, true)}${this.cleared ? `<p class="dn-note">${prose(r.note)}</p>` : ""}${
          past.length
            ? `<p class="dn-label">Tried before</p><ul class="dn-pasts">${past.map((t) => this.tryHtml(t, false)).join("")}</ul>`
            : ""
        }`
      : "";
    const last = this.i === rounds.length - 1;
    foot.innerHTML = this.cleared
      ? `<div class="dn-foot"><button type="button" class="dn-btn" data-tone="primary" data-go="next">${
          last ? "Wrap up" : "Next lookup"
        }</button></div>`
      : "";
    foot.querySelector(`[data-go="next"]`)?.addEventListener("click", () => {
      this.i += 1;
      this.round();
      this.scrollIntoFrame();
    });
  }

  private summary(): void {
    this.paintRail();
    this.body.innerHTML = `
      <div class="dn-stage">
        <p class="dn-kicker">Four lookups later</p>
        <h3 class="dn-title">What the name has to say</h3>
        <p class="dn-plain">
          A short name is only short because the search list fills in the rest, and the
          search list starts with the pod's own namespace. So the same config can mean a
          different Service depending on where it runs, and it won't tell you.
        </p>
        <p class="dn-plain">
          Across namespaces, write the namespace. For one particular pod of a
          StatefulSet, write the pod and its Service. For anything outside the cluster
          that gets called a lot, end the name with a dot.
        </p>
        <div class="dn-foot">
          <button type="button" class="dn-btn" data-go="again">Start over</button>
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
  const host = document.querySelector<HTMLElement>("[data-resolver]");
  const go = host?.querySelector<HTMLButtonElement>(`[data-go="start"]`);
  if (!host || !go) return;
  go.addEventListener("click", () => {
    const stage = host.querySelector<HTMLElement>("[data-dn-stage]");
    if (stage) new NameLookup(stage);
  });
};

// Per page load: this module is evaluated once for the session, so a lesson
// arrived at by going back would otherwise render its Start button unwired.
document.addEventListener("astro:page-load", mount);
