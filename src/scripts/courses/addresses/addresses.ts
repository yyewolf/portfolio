// Runner and view for lesson 15's address board.
//
// Free play, like the lesson 13 board, drawn as a small network diagram instead
// of a report. Nodes sit side by side on the node network, each with its range
// printed on it, and shop keeps sending requests to whatever address its config
// says. Every request is a dot: out of shop's pod, down to its node, along the
// node network, up into whichever node owns that range and on to the pod, and
// back again as a reply. A request that gets lost stops where it got lost.
//
// The engine decides everything. `send()` walks the route and returns how it
// ended and which node it reached, and this file only turns that into
// waypoints measured off the rendered DOM. So the dots can't disagree with the
// sentence under them.
//
// Markup is a runtime string, so the stylesheet is global and hand-namespaced
// under .ab, and there is no bare <header> anywhere (global.css pins that as site
// chrome). Requests only flow while the board is on screen, and with reduced
// motion the dots are skipped and only where each request ended is marked.

import {
  act,
  can,
  PORT,
  send,
  start,
  type Action,
  type Pod,
  type Trace,
  type World,
} from "./engine";

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", [`"`]: "&quot;" })[c] ?? c);

interface Point {
  x: number;
  y: number;
}

/** Pixels per millisecond. Slow enough to follow, quick enough to feel live. */
const SPEED = 0.55;
const EVERY = 1800;
const TALLY = 12;

const ENDINGS: Record<Trace["ending"], string> = {
  answered: "200",
  refused: "connection refused",
  "no-pod": "no route to host",
  "no-route": "timed out",
};

class AddressBoard {
  private root: HTMLElement;
  private world: World = start();
  private selected: string | null = null;
  private happened = "";
  private last: Trace | null = null;
  private tally: boolean[] = [];
  private paused = false;
  private visible = true;
  private timer: number | undefined;
  /** Bumped whenever the dots are cleared, so a dot from before can't start a reply. */
  private generation = 0;
  private reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="ab-shell">
        <div class="ab-head">
          <p class="ab-title">shop's config</p>
          <code class="ab-config" data-ab-config></code>
        </div>
        <div class="ab-scroll">
          <div class="ab-canvas" data-ab-canvas>
            <div class="ab-nodes" data-ab-nodes></div>
            <div class="ab-bus" data-ab-bus>
              <span class="ab-bus-label">node network, 192.168.0.0/24</span>
              <span class="ab-gateway" data-ab-gateway>gateway</span>
            </div>
            <div class="ab-overlay" data-ab-overlay aria-hidden="true"></div>
          </div>
        </div>
        <div class="ab-bar" data-ab-bar></div>
        <div class="ab-status" data-ab-status aria-live="polite"></div>
      </div>`;

    new IntersectionObserver((entries) => {
      this.visible = entries.some((e) => e.isIntersecting);
    }).observe(root);

    this.paint();
    this.fire(send(this.world));
    this.timer = window.setInterval(() => this.tick(), EVERY);
  }

  private q<T extends HTMLElement>(sel: string): T | null {
    return this.root.querySelector<T>(sel);
  }

  private tick(): void {
    if (!this.root.isConnected) {
      window.clearInterval(this.timer);
      return;
    }
    if (this.paused || !this.visible || document.hidden) return;
    this.fire(send(this.world));
  }

  private do(a: Action): void {
    if (!can(this.world, a)) return;
    const r = act(this.world, a);
    this.world = r.world;
    this.happened = r.report.happened;
    if (this.selected && !this.world.pods.some((p) => p.name === this.selected)) this.selected = null;
    this.clearDots();
    this.paint();
    this.fire(r.report.trace);
  }

  /* --- drawing a request -------------------------------------------------- */

  private clearDots(): void {
    this.generation += 1;
    const overlay = this.q("[data-ab-overlay]");
    if (overlay) overlay.innerHTML = "";
  }

  /** A point on an element, relative to the canvas. */
  private at(el: Element | null, where: "center" | "bottom"): Point | null {
    const canvas = this.q("[data-ab-canvas]");
    if (!el || !canvas) return null;
    const c = canvas.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left - c.left + r.width / 2, y: where === "center" ? r.top - c.top + r.height / 2 : r.bottom - c.top };
  }

  private nodeEl(name: string | undefined): HTMLElement | null {
    return name ? this.root.querySelector<HTMLElement>(`[data-node="${CSS.escape(name)}"]`) : null;
  }

  private podEl(name: string | undefined): HTMLElement | null {
    return name ? this.root.querySelector<HTMLElement>(`[data-pod="${CSS.escape(name)}"]`) : null;
  }

  private fire(t: Trace): void {
    // The result line changes when the dot gets there, not when it sets off.
    const report = (): void => {
      this.last = t;
      this.tally = [...this.tally, t.ok].slice(-TALLY);
      this.paintStatus();
    };

    const bus = this.q("[data-ab-bus]");
    const from = this.at(this.podEl(t.from.name), "center");
    const srcNic = this.at(this.nodeEl(t.from.node)?.querySelector(".ab-nic") ?? null, "center");
    const busY = this.at(bus, "center")?.y;
    if (!from || !srcNic || busY === undefined) return report();

    const path: Point[] = [from, srcNic];
    let end: Point | null = null;

    if (t.ending === "no-route") {
      const gw = this.at(this.q("[data-ab-gateway]"), "center");
      path.push({ x: srcNic.x, y: busY });
      if (gw) path.push({ x: gw.x, y: busY });
      end = path[path.length - 1] ?? null;
    } else {
      const dstNic = this.at(this.nodeEl(t.dst)?.querySelector(".ab-nic") ?? null, "center");
      if (!dstNic) return report();
      if (t.dst !== t.from.node) path.push({ x: srcNic.x, y: busY }, { x: dstNic.x, y: busY }, dstNic);
      if (t.ending === "no-pod") {
        end = dstNic;
      } else {
        const pod = this.at(this.podEl(t.answeredBy), "center");
        if (pod) path.push(pod);
        end = pod;
      }
    }

    const land = (): void => {
      report();
      if (t.ending === "answered") {
        this.flash(t.answeredBy);
        if (!this.reduced) this.travel([...path].reverse(), "reply");
      } else if (end) {
        this.burst(end, ENDINGS[t.ending]);
      }
    };

    if (this.reduced) {
      report();
      if (t.ending === "answered") this.flash(t.answeredBy);
      else if (end) this.burst(end, ENDINGS[t.ending]);
      return;
    }
    this.travel(path, "request", land);
  }

  private travel(points: Point[], kind: "request" | "reply", done?: () => void): void {
    const overlay = this.q("[data-ab-overlay]");
    const first = points[0];
    if (!overlay || !first || points.length < 2) return;
    const lengths = points.slice(1).map((p, i) => {
      const prev = points[i] ?? p;
      return Math.hypot(p.x - prev.x, p.y - prev.y);
    });
    const total = lengths.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    const frames: Keyframe[] = [{ transform: `translate(${first.x}px, ${first.y}px)`, offset: 0 }];
    points.slice(1).forEach((p, i) => {
      acc += lengths[i] ?? 0;
      frames.push({ transform: `translate(${p.x}px, ${p.y}px)`, offset: Math.min(1, acc / total) });
    });

    const dot = document.createElement("span");
    dot.className = "ab-dot";
    dot.dataset.kind = kind;
    overlay.appendChild(dot);
    const generation = this.generation;
    const anim = dot.animate(frames, { duration: Math.max(450, total / SPEED), easing: "linear", fill: "forwards" });
    anim.onfinish = () => {
      dot.remove();
      if (generation === this.generation && overlay.isConnected) done?.();
    };
  }

  private burst(p: Point, text: string): void {
    const overlay = this.q("[data-ab-overlay]");
    if (!overlay) return;
    const el = document.createElement("span");
    el.className = "ab-burst";
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    el.innerHTML = `<span class="ab-burst-x"></span><span class="ab-burst-text">${esc(text)}</span>`;
    overlay.appendChild(el);
    window.setTimeout(() => el.remove(), 1400);
  }

  private flash(pod: string | undefined): void {
    const el = this.podEl(pod);
    if (!el) return;
    el.dataset.hit = "yes";
    window.setTimeout(() => {
      if (el.isConnected) delete el.dataset.hit;
    }, 450);
  }

  /* --- painting ----------------------------------------------------------- */

  private podHtml(p: Pod): string {
    const target = p.ip === this.world.config;
    const sel = this.selected === p.name;
    return `<button type="button" class="ab-pod" data-pod="${esc(p.name)}" data-app="${p.app}"
        data-target="${target ? "yes" : "no"}" aria-pressed="${sel}"
        title="${esc(`${p.name}, ${p.ip}${p.restarts ? `, restarted ${p.restarts}x` : ""}`)}">
      <span class="ab-pod-app">${p.app}${p.app === "api" ? ` <span class="ab-pod-ver">${esc(p.version ?? "")}</span>` : ""}</span>
      <span class="ab-pod-ip">${esc(p.ip)}</span>
    </button>`;
  }

  private paint(): void {
    const w = this.world;
    const config = this.q("[data-ab-config]");
    if (config) config.textContent = `API_URL=http://${w.config}:${PORT}`;

    const nodes = this.q("[data-ab-nodes]");
    if (nodes) {
      nodes.innerHTML = w.nodes
        .map((n) => {
          const pods = w.pods
            .filter((p) => p.node === n.name)
            .sort((a, b) => (a.app === b.app ? a.serial - b.serial : a.app === "shop" ? -1 : 1));
          const remove = can(w, { kind: "remove", node: n.name })
            ? `<button type="button" class="ab-x" data-remove="${esc(n.name)}" aria-label="Remove ${esc(n.name)}" title="Remove ${esc(n.name)}">×</button>`
            : "";
          return `<div class="ab-node" data-node="${esc(n.name)}">
            <div class="ab-node-head"><span class="ab-node-name">${esc(n.name)}</span>${remove}</div>
            <span class="ab-range">${esc(n.range)}.0/24</span>
            <div class="ab-pods">${pods.map((p) => this.podHtml(p)).join("")}</div>
            <span class="ab-nic" title="${esc(n.ip)}"><span>${esc(n.ip)}</span></span>
          </div>`;
        })
        .join("");
      nodes.querySelectorAll<HTMLButtonElement>("[data-pod]").forEach((b) =>
        b.addEventListener("click", () => {
          const name = b.dataset.pod ?? null;
          this.selected = this.selected === name ? null : name;
          this.paint();
        }),
      );
      nodes.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach((b) =>
        b.addEventListener("click", () => this.do({ kind: "remove", node: b.dataset.remove ?? "" })),
      );
    }

    this.paintBar();
    this.paintStatus();
  }

  private paintBar(): void {
    const w = this.world;
    const bar = this.q("[data-ab-bar]");
    if (!bar) return;
    const pod = w.pods.find((p) => p.name === this.selected);
    const dis = (a: Action): string => (can(w, a) ? "" : " disabled");

    bar.innerHTML = pod
      ? `<span class="ab-bar-what"><code>${esc(pod.name)}</code></span>
         <button type="button" class="ab-btn" data-go="delete">Delete it</button>
         <button type="button" class="ab-btn" data-go="restart">Crash its container</button>
         ${
           pod.app === "api"
             ? `<button type="button" class="ab-btn" data-go="point"${dis({ kind: "point", pod: pod.name })}>Put this address in shop's config</button>`
             : ""
         }
         <button type="button" class="ab-link" data-go="deselect">Done</button>`
      : `<button type="button" class="ab-btn" data-go="release"${dis({ kind: "release" })}>Ship a new api version</button>
         <span class="ab-stepper">
           <button type="button" class="ab-btn" data-go="down"${dis({ kind: "scale", by: -1 })} aria-label="Fewer api pods">−</button>
           <span>${w.replicas} api ${w.replicas === 1 ? "pod" : "pods"}</span>
           <button type="button" class="ab-btn" data-go="up"${dis({ kind: "scale", by: 1 })} aria-label="More api pods">+</button>
         </span>
         <button type="button" class="ab-btn" data-go="add"${dis({ kind: "add" })}>Add a node</button>
         <span class="ab-bar-end">
           <button type="button" class="ab-link" data-go="pause">${this.paused ? "Resume" : "Pause"}</button>
           <button type="button" class="ab-link" data-go="reset">Start over</button>
         </span>`;

    const on = (go: string, f: () => void): void => bar.querySelector(`[data-go="${go}"]`)?.addEventListener("click", f);
    if (pod) {
      on("delete", () => this.do({ kind: "delete", pod: pod.name }));
      on("restart", () => this.do({ kind: "restart", pod: pod.name }));
      on("point", () => this.do({ kind: "point", pod: pod.name }));
      on("deselect", () => {
        this.selected = null;
        this.paint();
      });
    } else {
      on("release", () => this.do({ kind: "release" }));
      on("down", () => this.do({ kind: "scale", by: -1 }));
      on("up", () => this.do({ kind: "scale", by: 1 }));
      on("add", () => this.do({ kind: "add" }));
      on("pause", () => {
        this.paused = !this.paused;
        this.paintBar();
      });
      on("reset", () => {
        this.world = start();
        this.selected = null;
        this.happened = "";
        this.tally = [];
        this.clearDots();
        this.paint();
        this.fire(send(this.world));
      });
    }
  }

  private paintStatus(): void {
    const status = this.q("[data-ab-status]");
    const t = this.last;
    if (!status) return;
    const lastHop = t?.hops[t.hops.length - 1];
    const result = t
      ? `<p class="ab-result" data-ok="${t.ok ? "yes" : "no"}">
           <span class="ab-result-mark"></span>
           <span>${t.ok ? `200 from <code>${esc(t.answeredBy ?? "")}</code>` : esc(t.log.replace(/^dial tcp [^:]+:\d+: /, ""))}</span>
           <span class="ab-tally" aria-label="Recent requests">${this.tally
             .map((ok) => `<i data-ok="${ok ? "yes" : "no"}"></i>`)
             .join("")}</span>
         </p>
         ${lastHop && !t.ok ? `<p class="ab-why">${esc(lastHop.text)}</p>` : ""}`
      : "";
    status.innerHTML = `${
      this.happened
        ? `<p class="ab-happened">${esc(this.happened)}</p>`
        : `<p class="ab-hint">Click a pod to delete it or crash it, or ship a new version, change the count, or remove a node with its ×.</p>`
    }${result}`;
  }
}

const mount = (): void => {
  const host = document.querySelector<HTMLElement>("[data-addresses]");
  const go = host?.querySelector<HTMLButtonElement>(`[data-go="start"]`);
  if (!host || !go) return;
  go.addEventListener("click", () => {
    const stage = host.querySelector<HTMLElement>("[data-ab-stage]");
    if (stage) new AddressBoard(stage);
  });
};

// Per page load: this module is evaluated once for the session, so a lesson
// arrived at by going back would otherwise render its Start button unwired.
document.addEventListener("astro:page-load", mount);
