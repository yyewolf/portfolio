// Runner and view for lesson 16's service desk.
//
// The change desk's shape: the shell is built once and only [data-sv-body] is
// replaced after that, the stylesheet is global and namespaced under .sv, and
// there's no bare <header> anywhere (global.css pins that as site chrome).
//
// This file decides nothing. It holds the reader's spec, hands it to engine.ts
// with the round, and paints what comes back: the manifest, the pods with the
// labels the selector is asking about marked, the EndpointSlice as kubectl
// prints it, and where each of the eight requests went. Any edit throws the last
// outcome away, so a finding is never on screen next to a spec it wasn't about.

import { rounds, type Round, type Spec } from "./rounds";
import { manifest, missingLabels, REQUESTS, run, sliceTable, type Outcome } from "./engine";

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", [`"`]: "&quot;" })[c] ?? c);

const prose = (s: string): string => esc(s).replace(/`([^`]+)`/g, `<code class="sv-code">$1</code>`);

const yamlHtml = (text: string): string =>
  esc(text)
    .replace(/^(\s*)([\w.-]+)(:)/, `$1<b class="sv-key">$2</b>$3`)
    .replace(/^(\s*)(- )/, `$1<span class="sv-dash">$2</span>`);

const portLabel = (p: number | string | null): string => (p === null ? "leave it out" : String(p));

class ServiceDesk {
  private root: HTMLElement;
  private body: HTMLElement;
  private rail: HTMLElement;
  private i = 0;
  private spec: Spec = { selector: [], type: "ClusterIP" };
  private outcome: Outcome | null = null;
  private cleared = false;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="sv-shell">
        <div class="sv-head">
          <ol class="sv-rail" data-sv-rail aria-label="Services"></ol>
        </div>
        <div class="sv-body" data-sv-body></div>
      </div>`;
    const body = root.querySelector<HTMLElement>("[data-sv-body]");
    const rail = root.querySelector<HTMLElement>("[data-sv-rail]");
    if (!body || !rail) throw new Error("service desk failed to mount");
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
    this.spec = { ...r.start, selector: [...r.start.selector] };
    this.outcome = null;
    this.cleared = false;
    this.paintRail();
    this.body.innerHTML = `
      <div class="sv-stage">
        <p class="sv-kicker">Service ${r.n} of ${rounds.length}</p>
        <h3 class="sv-title">${esc(r.title)}</h3>
        <blockquote class="sv-brief">${esc(r.brief)}</blockquote>
        <div data-sv-edits></div>
        <div class="sv-panels" data-sv-panels></div>
        <div data-sv-results></div>
        <div data-sv-foot></div>
      </div>`;
    this.paint(r);
  }

  private editsHtml(r: Round): string {
    const dis = this.cleared ? " disabled" : "";
    const selector = r.labels
      .map((l) => {
        const on = this.spec.selector.includes(l);
        return `<li><button type="button" class="sv-toggle" data-label="${esc(l)}" aria-pressed="${on}"${dis}>${esc(l)}</button></li>`;
      })
      .join("");
    const ports =
      r.targetPorts.length > 1
        ? `<p class="sv-label">targetPort</p>
           <ul class="sv-toggles">${r.targetPorts
             .map((p, k) => {
               const on = (this.spec.targetPort ?? null) === p;
               return `<li><button type="button" class="sv-toggle" data-port="${k}" aria-pressed="${on}"${
                 p === null ? ` data-plain="yes"` : ""
               }${dis}>${esc(portLabel(p))}</button></li>`;
             })
             .join("")}</ul>`
        : "";
    const types = r.types
      ? `<p class="sv-label">type</p>
         <ul class="sv-toggles">${r.types
           .map(
             (t) =>
               `<li><button type="button" class="sv-toggle" data-type="${t}" aria-pressed="${this.spec.type === t}"${dis}>${t}</button></li>`,
           )
           .join("")}</ul>`
      : "";
    return `<p class="sv-label">selector, a pod needs every label that's on</p>
      <ul class="sv-toggles">${selector}</ul>${ports}${types}`;
  }

  private podsHtml(r: Round): string {
    const o = this.outcome;
    const rows = r.pods
      .map((p) => {
        const labels = Object.entries(p.labels)
          .map(([k, v]) => {
            const l = `${k}=${v}`;
            const asked = this.spec.selector.includes(l);
            return `<span class="sv-plabel" data-asked="${asked ? "yes" : "no"}">${esc(l)}</span>`;
          })
          .join("");
        let state = "";
        if (o) {
          const inSlice = o.slice.some((e) => e.pod === p);
          const got = o.requests.filter((q) => q.pod === p).length;
          state = inSlice
            ? p.ready
              ? `<span class="sv-pstate" data-in="yes">in the slice, ${got} of ${REQUESTS}</span>`
              : `<span class="sv-pstate" data-in="wait">in the slice, not ready</span>`
            : `<span class="sv-pstate" data-in="no">left out${
                this.spec.selector.length ? `, no ${esc(missingLabels(p, this.spec.selector).join(" or "))}` : ""
              }</span>`;
        }
        return `<li class="sv-pod" data-ready="${p.ready ? "yes" : "no"}">
          <span class="sv-pod-top">
            <span class="sv-pod-name">${esc(p.name)}</span>
            <span class="sv-pod-port">${p.port}${p.portName ? ` (${esc(p.portName)})` : ""}${p.ready ? "" : ", starting"}</span>
          </span>
          <span class="sv-plabels">${labels}</span>
          ${state}
        </li>`;
      })
      .join("");
    return `<div class="sv-panel">
      <p class="sv-panel-head">Pods in the namespace</p>
      <ul class="sv-pods">${rows}</ul>
    </div>`;
  }

  private paint(r: Round): void {
    const edits = this.body.querySelector<HTMLElement>("[data-sv-edits]");
    const panels = this.body.querySelector<HTMLElement>("[data-sv-panels]");
    const results = this.body.querySelector<HTMLElement>("[data-sv-results]");
    const foot = this.body.querySelector<HTMLElement>("[data-sv-foot]");
    if (!edits || !panels || !results || !foot) return;

    edits.innerHTML = this.editsHtml(r);
    panels.innerHTML = `<div class="sv-panel">
        <p class="sv-panel-head">service.yaml</p>
        <ol class="sv-yaml">${manifest(r, this.spec)
          .map((l) => `<li>${yamlHtml(l)}</li>`)
          .join("")}</ol>
      </div>${this.podsHtml(r)}`;

    const o = this.outcome;
    results.innerHTML = o
      ? `<div class="sv-panel sv-wide">
           <p class="sv-panel-head">The EndpointSlice</p>
           <ol class="sv-term">${sliceTable(r, o)
             .map((l) => `<li>${esc(l)}</li>`)
             .join("")}</ol>
         </div>
         <p class="sv-label">${r.from === "outside" ? "Eight webhooks from the provider" : `Eight requests to ${esc(r.service.name)}`}</p>
         <ol class="sv-requests">${o.requests
           .map(
             (q) => `<li data-ok="${q.ok ? "yes" : "no"}">
               <span class="sv-req-to">${q.pod ? esc(q.pod.name) : "nowhere"}</span>
               <span class="sv-req-got">${esc(q.text)}</span>
             </li>`,
           )
           .join("")}</ol>
         <ul class="sv-findings">${o.findings
           .map((f) => `<li class="sv-finding" data-tone="${f.tone}">${prose(f.text)}</li>`)
           .join("")}</ul>
         ${this.cleared ? `<p class="sv-note">${prose(r.note)}</p>` : ""}`
      : "";

    const last = this.i === rounds.length - 1;
    foot.innerHTML = `<div class="sv-foot">
      ${
        this.cleared
          ? `<button type="button" class="sv-btn" data-tone="primary" data-go="next">${last ? "Wrap up" : "Next Service"}</button>`
          : `<button type="button" class="sv-btn" data-tone="primary" data-go="send">Send ${REQUESTS} requests</button>
             <button type="button" class="sv-restart" data-go="reset">Put the spec back</button>`
      }
    </div>`;

    const change = (f: () => void): void => {
      if (this.cleared) return;
      f();
      this.outcome = null;
      this.paint(r);
    };
    edits.querySelectorAll<HTMLButtonElement>("[data-label]").forEach((b) =>
      b.addEventListener("click", () =>
        change(() => {
          const l = b.dataset.label ?? "";
          this.spec.selector = this.spec.selector.includes(l)
            ? this.spec.selector.filter((x) => x !== l)
            : r.labels.filter((x) => x === l || this.spec.selector.includes(x));
        }),
      ),
    );
    edits.querySelectorAll<HTMLButtonElement>("[data-port]").forEach((b) =>
      b.addEventListener("click", () =>
        change(() => {
          const p = r.targetPorts[Number(b.dataset.port)];
          if (p === null || p === undefined) delete this.spec.targetPort;
          else this.spec.targetPort = p;
        }),
      ),
    );
    edits.querySelectorAll<HTMLButtonElement>("[data-type]").forEach((b) =>
      b.addEventListener("click", () =>
        change(() => {
          const t = r.types?.find((x) => x === b.dataset.type);
          if (t) this.spec.type = t;
        }),
      ),
    );
    foot.querySelector(`[data-go="send"]`)?.addEventListener("click", () => {
      this.outcome = run(r, this.spec);
      this.cleared = this.outcome.cleared;
      this.paint(r);
    });
    foot.querySelector(`[data-go="reset"]`)?.addEventListener("click", () =>
      change(() => {
        this.spec = { ...r.start, selector: [...r.start.selector] };
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
      <div class="sv-stage">
        <p class="sv-kicker">Four Services later</p>
        <h3 class="sv-title">Where it goes wrong</h3>
        <p class="sv-plain">
          Every one of those was the same three steps. The selector decides which pods
          end up in the slice, the target port decides where on those pods a connection
          goes, and the type decides who can get to the Service in the first place.
        </p>
        <p class="sv-plain">
          None of them fail loudly. A selector that's too wide sends a share of your
          traffic somewhere that answers wrong, one that's too narrow leaves a pod sitting
          idle, and a wrong port looks exactly like an app that's down. When a Service
          misbehaves, look at its EndpointSlice first.
        </p>
        <div class="sv-foot">
          <button type="button" class="sv-btn" data-go="again">Start over</button>
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
  const host = document.querySelector<HTMLElement>("[data-services]");
  const go = host?.querySelector<HTMLButtonElement>(`[data-go="start"]`);
  if (!host || !go) return;
  go.addEventListener("click", () => {
    const stage = host.querySelector<HTMLElement>("[data-sv-stage]");
    if (stage) new ServiceDesk(stage);
  });
};

// Per page load: this module is evaluated once for the session, so a lesson
// arrived at by going back would otherwise render its Start button unwired.
document.addEventListener("astro:page-load", mount);
