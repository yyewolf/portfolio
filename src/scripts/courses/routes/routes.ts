// Runner and view for lesson 18's route table.
//
// Same shell as the service desk: built once, only [data-gw-body] replaced after
// that, the stylesheet global and namespaced under .gw, and no bare <header>.
//
// Each round unlocks one kind of edit (`round.edit`), so the controls are only
// ever the ones that round is about. The manifest beside them is generated from
// the reader's own route, and the requests below show the rule each one matched,
// the backend it reached and the path that backend was handed. Any edit throws
// the last outcome away.

import { rounds, type Allowed, type Match, type Round, type Route, type Rule } from "./rounds";
import { gatewayYaml, routeYaml, run, type Outcome } from "./engine";

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", [`"`]: "&quot;" })[c] ?? c);

const prose = (s: string): string => esc(s).replace(/`([^`]+)`/g, `<code class="gw-code">$1</code>`);

const yamlHtml = (text: string): string =>
  esc(text)
    .replace(/^(\s*)([\w.-]+)(:)/, `$1<b class="gw-key">$2</b>$3`)
    .replace(/^(\s*)(- )([\w.-]+)(:)/, `$1<span class="gw-dash">$2</span><b class="gw-key">$3</b>$4`)
    .replace(/^(\s*)(- )(?!<)/, `$1<span class="gw-dash">$2</span>`);

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const MAX_RULES = 3;
const MATCHES: Match[] = ["PathPrefix", "Exact"];
const ALLOWED: Allowed[] = ["Same", "All", "Selector"];

class RouteTable {
  private root: HTMLElement;
  private body: HTMLElement;
  private rail: HTMLElement;
  private i = 0;
  private route: Route | null = null;
  private allowed: Allowed = "Same";
  private outcome: Outcome | null = null;
  private cleared = false;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="gw-shell">
        <div class="gw-head">
          <ol class="gw-rail" data-gw-rail aria-label="Requests"></ol>
        </div>
        <div class="gw-body" data-gw-body></div>
      </div>`;
    const body = root.querySelector<HTMLElement>("[data-gw-body]");
    const rail = root.querySelector<HTMLElement>("[data-gw-rail]");
    if (!body || !rail) throw new Error("route table failed to mount");
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
    this.route = clone(r.route);
    this.allowed = r.allowed;
    this.outcome = null;
    this.cleared = false;
    this.paintRail();
    this.body.innerHTML = `
      <div class="gw-stage">
        <p class="gw-kicker">Change ${r.n} of ${rounds.length}</p>
        <h3 class="gw-title">${esc(r.title)}</h3>
        <blockquote class="gw-brief">${esc(r.brief)}</blockquote>
        <div data-gw-edits></div>
        <div class="gw-panels" data-gw-panels></div>
        <div data-gw-results></div>
        <div data-gw-foot></div>
      </div>`;
    this.paint(r);
  }

  private toggle(attrs: string, on: boolean, label: string): string {
    return `<li><button type="button" class="gw-toggle" ${attrs} aria-pressed="${on}"${
      this.cleared ? " disabled" : ""
    }>${esc(label)}</button></li>`;
  }

  private ruleHtml(r: Round, rule: Rule, k: number): string {
    const route = this.route;
    if (!route) return "";
    const e = r.edit;
    const parts: string[] = [];
    if (e.rules) {
      parts.push(
        `<ul class="gw-toggles">${MATCHES.map((m) => this.toggle(`data-rule="${k}" data-match="${m}"`, rule.match === m, m)).join("")}</ul>`,
        `<ul class="gw-toggles">${r.paths.map((p) => this.toggle(`data-rule="${k}" data-path="${esc(p)}"`, rule.path === p, p)).join("")}</ul>`,
        `<span class="gw-arrow" aria-hidden="true">to</span>`,
        `<ul class="gw-toggles">${r.backends
          .map((b) => this.toggle(`data-rule="${k}" data-backend="${esc(b)}"`, rule.backends[0]?.name === b, b))
          .join("")}</ul>`,
      );
      if (route.rules.length > 1 && !this.cleared) {
        parts.push(`<button type="button" class="gw-restart" data-drop="${k}">remove</button>`);
      }
    } else {
      parts.push(
        `<code class="gw-rulename">${esc(`${rule.match} ${rule.path}`)}</code>`,
        `<span class="gw-arrow" aria-hidden="true">to</span>`,
      );
      if (e.weights && rule.backends.length > 1) {
        parts.push(
          rule.backends
            .map(
              (b, bi) => `<span class="gw-weight"><code>${esc(b.name)}</code> weight
                <ul class="gw-toggles">${r.weights
                  .map((w) => this.toggle(`data-rule="${k}" data-bi="${bi}" data-weight="${w}"`, b.weight === w, String(w)))
                  .join("")}</ul></span>`,
            )
            .join(""),
        );
      } else {
        parts.push(`<code class="gw-rulename">${esc(rule.backends.map((b) => b.name).join(", "))}</code>`);
      }
      if (e.rewrite) {
        parts.push(
          `<ul class="gw-toggles">${this.toggle(
            `data-rule="${k}" data-rewrite="1" data-plain="yes"`,
            rule.rewrite,
            rule.rewrite ? "rewriting the prefix to /" : "no rewrite",
          )}</ul>`,
        );
      }
    }
    return `<li class="gw-rule">${parts.join("")}</li>`;
  }

  private editsHtml(r: Round): string {
    const route = this.route;
    if (!route) return "";
    if (r.edit.allowed) {
      return `<p class="gw-label">The listener takes routes from</p>
        <ul class="gw-toggles">${ALLOWED.map((a) =>
          this.toggle(
            `data-allowed="${a}" data-plain="yes"`,
            this.allowed === a,
            a === "Same" ? "its own namespace (Same)" : a === "All" ? "every namespace (All)" : "labelled namespaces (Selector)",
          ),
        ).join("")}</ul>`;
    }
    const add =
      r.edit.rules && route.rules.length < MAX_RULES && !this.cleared
        ? `<button type="button" class="gw-restart" data-add="1">add a rule</button>`
        : "";
    return `<p class="gw-label">Rules on shop.example.com</p>
      <ol class="gw-rules">${route.rules.map((rule, k) => this.ruleHtml(r, rule, k)).join("")}</ol>${add}`;
  }

  private resultsHtml(r: Round, o: Outcome): string {
    const findings = `<ul class="gw-findings">${o.findings
      .map((f) => `<li class="gw-finding" data-tone="${f.tone}">${prose(f.text)}</li>`)
      .join("")}</ul>`;
    const note = this.cleared ? `<p class="gw-note">${prose(r.note)}</p>` : "";
    if (r.share && o.counts) {
      const total = r.share.sample;
      const bars = Object.entries(o.counts)
        .map(
          ([k, v]) => `<li><span class="gw-bar-name">${esc(k)}</span>
            <span class="gw-bar"><span style="width:${(v / total) * 100}%"></span></span>
            <span class="gw-bar-n">${v}</span></li>`,
        )
        .join("");
      return `<p class="gw-label">${total} requests to /api/orders</p><ul class="gw-bars">${bars}</ul>${findings}${note}`;
    }
    const rows = o.hits
      .map(
        (h) => `<li data-ok="${h.ok ? "yes" : "no"}">
          <code class="gw-req-path">${esc(h.path)}</code>
          <span class="gw-req-rule">${
            h.rule && h.route
              ? `${esc(`${h.rule.match} ${h.rule.path}`)}${h.route.ns !== "shop" ? ` in ${esc(`${h.route.ns}/${h.route.name}`)}` : ""}`
              : "no rule"
          }</span>
          <span class="gw-req-to">${h.backend ? `${esc(h.backend)}${h.sent !== h.path ? ` as ${esc(h.sent ?? "")}` : ""}` : "the Gateway"}</span>
          <span class="gw-req-got">${esc(h.text)}</span>
        </li>`,
      )
      .join("");
    return `<p class="gw-label">Requests to shop.example.com</p>
      <ol class="gw-reqs">
        <li class="gw-reqs-head" aria-hidden="true"><span>path</span><span>matched</span><span>sent to</span><span>answer</span></li>
        ${rows}
      </ol>${findings}${note}`;
  }

  private paint(r: Round): void {
    const route = this.route;
    const edits = this.body.querySelector<HTMLElement>("[data-gw-edits]");
    const panels = this.body.querySelector<HTMLElement>("[data-gw-panels]");
    const results = this.body.querySelector<HTMLElement>("[data-gw-results]");
    const foot = this.body.querySelector<HTMLElement>("[data-gw-foot]");
    if (!route || !edits || !panels || !results || !foot) return;

    edits.innerHTML = this.editsHtml(r);
    const yaml = (title: string, lines: string[]): string => `<div class="gw-panel">
        <p class="gw-panel-head">${esc(title)}</p>
        <ol class="gw-yaml">${lines.map((l) => `<li>${yamlHtml(l)}</li>`).join("")}</ol>
      </div>`;
    panels.innerHTML = r.edit.allowed
      ? `${yaml("gateway.yaml, in infra", gatewayYaml(this.allowed))}${yaml("httproute.yaml, in shop", routeYaml(r, route))}${r.others
          .map((o) => yaml(`httproute.yaml, in ${o.ns}, created ${o.created}`, routeYaml(r, o)))
          .join("")}`
      : yaml("httproute.yaml", routeYaml(r, route));

    results.innerHTML = this.outcome ? this.resultsHtml(r, this.outcome) : "";

    const last = this.i === rounds.length - 1;
    foot.innerHTML = `<div class="gw-foot">${
      this.cleared
        ? `<button type="button" class="gw-btn" data-tone="primary" data-go="next">${last ? "Wrap up" : "Next change"}</button>`
        : `<button type="button" class="gw-btn" data-tone="primary" data-go="send">Apply and send</button>
           <button type="button" class="gw-restart" data-go="reset">Put it back</button>`
    }</div>`;

    const change = (f: (route: Route) => void): void => {
      if (this.cleared || !this.route) return;
      f(this.route);
      this.outcome = null;
      this.paint(r);
    };
    const ruleAt = (el: HTMLElement): Rule | undefined => this.route?.rules[Number(el.dataset.rule)];

    edits.querySelectorAll<HTMLButtonElement>("[data-match]").forEach((b) =>
      b.addEventListener("click", () =>
        change(() => {
          const rule = ruleAt(b);
          const m = MATCHES.find((x) => x === b.dataset.match);
          if (rule && m) rule.match = m;
        }),
      ),
    );
    edits.querySelectorAll<HTMLButtonElement>("[data-path]").forEach((b) =>
      b.addEventListener("click", () =>
        change(() => {
          const rule = ruleAt(b);
          if (rule && b.dataset.path) rule.path = b.dataset.path;
        }),
      ),
    );
    edits.querySelectorAll<HTMLButtonElement>("[data-backend]").forEach((b) =>
      b.addEventListener("click", () =>
        change(() => {
          const rule = ruleAt(b);
          if (rule && b.dataset.backend) rule.backends = [{ name: b.dataset.backend, weight: 1 }];
        }),
      ),
    );
    edits.querySelectorAll<HTMLButtonElement>("[data-weight]").forEach((b) =>
      b.addEventListener("click", () =>
        change(() => {
          const ref = ruleAt(b)?.backends[Number(b.dataset.bi)];
          if (ref) ref.weight = Number(b.dataset.weight);
        }),
      ),
    );
    edits.querySelectorAll<HTMLButtonElement>("[data-rewrite]").forEach((b) =>
      b.addEventListener("click", () =>
        change(() => {
          const rule = ruleAt(b);
          if (rule) rule.rewrite = !rule.rewrite;
        }),
      ),
    );
    edits.querySelectorAll<HTMLButtonElement>("[data-allowed]").forEach((b) =>
      b.addEventListener("click", () =>
        change(() => {
          const a = ALLOWED.find((x) => x === b.dataset.allowed);
          if (a) this.allowed = a;
        }),
      ),
    );
    edits.querySelector("[data-add]")?.addEventListener("click", () =>
      change((route) => {
        route.rules.push({ match: "PathPrefix", path: r.paths[0] ?? "/", rewrite: false, backends: [{ name: r.backends[0] ?? "web", weight: 1 }] });
      }),
    );
    edits.querySelectorAll<HTMLButtonElement>("[data-drop]").forEach((b) =>
      b.addEventListener("click", () =>
        change((route) => {
          route.rules.splice(Number(b.dataset.drop), 1);
        }),
      ),
    );
    foot.querySelector(`[data-go="send"]`)?.addEventListener("click", () => {
      if (!this.route) return;
      this.outcome = run(r, { route: this.route, allowed: this.allowed });
      this.cleared = this.outcome.cleared;
      this.paint(r);
    });
    foot.querySelector(`[data-go="reset"]`)?.addEventListener("click", () => {
      if (this.cleared) return;
      this.route = clone(r.route);
      this.allowed = r.allowed;
      this.outcome = null;
      this.paint(r);
    });
    foot.querySelector(`[data-go="next"]`)?.addEventListener("click", () => {
      this.i += 1;
      this.round();
      this.scrollIntoFrame();
    });
  }

  private summary(): void {
    this.paintRail();
    this.body.innerHTML = `
      <div class="gw-stage">
        <p class="gw-kicker">Four changes later</p>
        <h3 class="gw-title">Who owns what</h3>
        <p class="gw-plain">
          Three of those were the app team's to fix, in their own route: which paths go
          where, what path the backend sees, and how traffic splits. The last one was the
          platform team's, on the Gateway, and no route could have fixed it.
        </p>
        <p class="gw-plain">
          Most of what went wrong didn't look wrong in the YAML. A rule that's in the list
          can still lose to a longer one or an older one, so when a request lands
          somewhere odd, look at every rule that matches it, including the ones in other
          people's routes.
        </p>
        <div class="gw-foot">
          <button type="button" class="gw-btn" data-go="again">Start over</button>
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
  const host = document.querySelector<HTMLElement>("[data-routes]");
  const go = host?.querySelector<HTMLButtonElement>(`[data-go="start"]`);
  if (!host || !go) return;
  go.addEventListener("click", () => {
    const stage = host.querySelector<HTMLElement>("[data-gw-stage]");
    if (stage) new RouteTable(stage);
  });
};

// Per page load: this module is evaluated once for the session, so a lesson
// arrived at by going back would otherwise render its Start button unwired.
document.addEventListener("astro:page-load", mount);
