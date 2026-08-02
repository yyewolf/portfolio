// The "wow" animations: leaderboard race, a living Kubernetes cluster floor
// (individual animated pods), and the first-blood ticker. Each returns a
// controller with redraw()/destroy() so the bootstrap can re-render on theme /
// resize.
import {
  el, fmt, clockUTC, elapsed, palette, fitCanvas, lerp, clamp, showTip, hideTip,
  type Cleanup,
} from "./util";

export interface Viz { redraw(): void; destroy(): void; }

// ---------------------------------------------------------------- transport
// Real-time based: `speed` is a real-time multiplier, so 1x == real time and the
// sim advances `speed` seconds of event-time per real second.
interface Marker { p: number; label: string; }
interface TransportOpts {
  spanSeconds: number;
  speeds?: number[];
  defaultSpeedIndex?: number;
  heat?: number[];
  markers?: Marker[];
  label: (p: number) => string;
  onProgress: (p: number) => void;
}
class Transport {
  p = 0;
  playing = false;
  private speeds: number[];
  private si: number;
  private raf = 0;
  private last = 0;
  private cleanups: Cleanup[] = [];
  root: HTMLElement;
  private btn: HTMLButtonElement;
  private btnIcon: SVGElement;
  private spdWrap: HTMLElement;
  private bar: HTMLElement;
  private fill: HTMLElement;
  private heatEl: HTMLElement;
  private cap: HTMLElement;
  constructor(private o: TransportOpts) {
    this.speeds = o.speeds ?? [1, 60, 600, 1800];
    this.si = o.defaultSpeedIndex ?? this.speeds.length - 1;

    this.root = el("div", "ctf-transport");
    this.btn = el("button", "ctf-tbtn") as HTMLButtonElement;
    this.btn.setAttribute("aria-label", "Play / pause");
    this.btnIcon = mkIcon("play");
    this.btn.appendChild(this.btnIcon);

    this.spdWrap = el("div", "ctf-tspeeds");
    this.speeds.forEach((s, i) => {
      const b = el("button", "ctf-tsp", (s >= 1000 ? s / 1000 + "k" : "" + s) + "×") as HTMLButtonElement;
      if (s === 1) b.title = "real time";
      b.addEventListener("click", () => { this.si = i; this.syncSpeeds(); });
      this.spdWrap.appendChild(b);
    });

    const barWrap = el("div", "ctf-tbarwrap");
    const markerLayer = el("div", "ctf-tmarks");
    (o.markers ?? []).forEach((m) => {
      const tick = el("div", "ctf-tmark");
      tick.style.left = (clamp(m.p, 0, 1) * 100) + "%";
      tick.appendChild(el("span", "ctf-tmark-l", m.label));
      tick.title = m.label;
      markerLayer.appendChild(tick);
    });
    this.heatEl = el("div", "ctf-theat");
    this.heatEl.title = "Activity — brighter = busier";
    this.bar = el("div", "ctf-tbar");
    this.fill = el("div", "ctf-tfill");
    this.bar.appendChild(this.fill);
    barWrap.append(markerLayer, this.heatEl, this.bar);

    this.cap = el("div", "ctf-tcap");
    this.root.append(this.btn, this.spdWrap, barWrap, this.cap);
    this.setHeat(o.heat);
    this.syncSpeeds();

    this.btn.addEventListener("click", () => this.toggle());
    const scrub = (clientX: number) => {
      const r = this.bar.getBoundingClientRect();
      this.p = clamp((clientX - r.left) / r.width, 0, 1);
      this.render();
    };
    let dragging = false;
    this.bar.addEventListener("pointerdown", (e) => { dragging = true; this.pause(); scrub(e.clientX); this.bar.setPointerCapture(e.pointerId); });
    this.bar.addEventListener("pointermove", (e) => { if (dragging) scrub(e.clientX); });
    this.bar.addEventListener("pointerup", () => { dragging = false; });

    this.render();
  }
  private syncSpeeds(): void {
    Array.from(this.spdWrap.children).forEach((c, i) => c.classList.toggle("on", i === this.si));
  }
  setHeat(samples?: number[]): void {
    if (!samples || !samples.length) { this.heatEl.style.display = "none"; return; }
    const n = samples.length;
    const stops = samples.map((v, i) => {
      const a = 0.05 + 0.9 * Math.pow(clamp(v, 0, 1), 1.1);
      return `rgba(233,84,42,${a.toFixed(3)}) ${((i / (n - 1)) * 100).toFixed(1)}%`;
    });
    this.heatEl.style.background = `linear-gradient(to right, ${stops.join(",")})`;
    this.heatEl.style.display = "block";
  }
  private loop = (ts: number) => {
    if (!this.playing) return;
    if (!this.last) this.last = ts;
    const dt = (ts - this.last) / 1000; this.last = ts;
    this.p += (dt * this.speeds[this.si]) / this.o.spanSeconds;
    if (this.p >= 1) { this.p = 1; this.playing = false; setIcon(this.btnIcon, "restart"); }
    this.render();
    if (this.playing) this.raf = requestAnimationFrame(this.loop);
  };
  render(): void {
    this.fill.style.width = (this.p * 100) + "%";
    this.cap.textContent = this.o.label(this.p);
    this.o.onProgress(this.p);
  }
  play(): void {
    if (this.p >= 1) this.p = 0;
    this.playing = true; this.last = 0; setIcon(this.btnIcon, "pause");
    this.raf = requestAnimationFrame(this.loop);
  }
  pause(): void { this.playing = false; setIcon(this.btnIcon, this.p >= 1 ? "restart" : "play"); cancelAnimationFrame(this.raf); }
  toggle(): void { this.playing ? this.pause() : this.play(); }
  destroy(): void { cancelAnimationFrame(this.raf); this.cleanups.forEach((c) => c()); }
}

function densityOf(times: number[], start: number, end: number, bins = 72): number[] {
  const arr = new Array(bins).fill(0);
  const span = (end - start) || 1;
  for (const t of times) { let b = Math.floor(((t - start) / span) * bins); b = clamp(b, 0, bins - 1); arr[b]++; }
  const mx = Math.max(1, ...arr);
  return arr.map((v) => v / mx);
}
function argmaxP(heat: number[]): number {
  let bi = 0; for (let i = 1; i < heat.length; i++) if (heat[i] > heat[bi]) bi = i;
  return heat.length > 1 ? bi / (heat.length - 1) : 0;
}

// ---------------------------------------------------------------- race
interface Race { start: number; end: number; teams: string[]; events: [number, number, number][]; }
export function setupRace(host: HTMLElement, data: Race): Viz {
  const TOPN_DESKTOP = 12;
  const spanEnd = data.events.length ? data.events[data.events.length - 1][0] : data.end;
  const span = spanEnd - data.start;
  const finals = new Float64Array(data.teams.length);
  for (const [, ti, pts] of data.events) finals[ti] += pts;
  const maxScore = Math.max(...finals);

  const cv = el("canvas", "ctf-canvas") as HTMLCanvasElement;
  host.appendChild(cv);
  const ctx = cv.getContext("2d")!;

  const scores = new Float64Array(data.teams.length);
  let idx = 0, processedTime = data.start;
  const dispY = new Map<number, number>();
  function advanceTo(t: number): void {
    if (t < processedTime) { scores.fill(0); idx = 0; }
    while (idx < data.events.length && data.events[idx][0] <= t) { const [, ti, pts] = data.events[idx]; scores[ti] += pts; idx++; }
    processedTime = t;
  }

  let lastP = 0;
  function draw(p: number): void {
    lastP = p;
    const pal = palette();
    const { w, h } = fitCanvas(cv);
    const now = data.start + p * span;
    advanceTo(now);
    const topN = w < 560 ? 8 : TOPN_DESKTOP;
    const order = Array.from(scores.keys()).filter((i) => scores[i] > 0).sort((a, b) => scores[b] - scores[a] || a - b);
    const top = order.slice(0, topN);
    ctx.clearRect(0, 0, w, h);
    const padL = w < 560 ? 92 : 150, padR = 74, padT = 8, padB = 22;
    const rowH = (h - padT - padB) / topN;
    const barH = Math.min(rowH * 0.66, 30);
    const scale = (w - padL - padR) / (maxScore || 1);
    top.forEach((ti, rank) => {
      const ty = padT + rank * rowH + rowH / 2;
      const cur = dispY.get(ti);
      dispY.set(ti, cur == null ? ty : lerp(cur, ty, 0.12));
    });
    ctx.textBaseline = "middle";
    top.forEach((ti, rank) => {
      const y = dispY.get(ti)!;
      const val = scores[ti];
      const bw = Math.max(2, val * scale);
      const isLeader = rank === 0;
      ctx.fillStyle = isLeader ? pal.gold : pal.c1;
      roundRect(ctx, padL, y - barH / 2, bw, barH, 4); ctx.fill();
      ctx.fillStyle = pal.muted; ctx.textAlign = "left"; ctx.font = "700 11px Inter, system-ui, sans-serif";
      ctx.fillText("#" + (rank + 1), 6, y);
      ctx.fillStyle = pal.ink; ctx.textAlign = "right"; ctx.font = (isLeader ? "700 " : "600 ") + "12px Inter, system-ui, sans-serif";
      ctx.fillText(clip(ctx, data.teams[ti], padL - 40), padL - 8, y);
      ctx.fillStyle = isLeader ? pal.gold : pal.ink2; ctx.textAlign = "left"; ctx.font = "700 12px Inter, system-ui, sans-serif";
      ctx.fillText(fmt(Math.round(val)), padL + bw + 6, y);
    });
  }
  const heat = densityOf(data.events.map((e) => e[0]), data.start, spanEnd);
  const transport = new Transport({
    spanSeconds: span, heat,
    markers: [{ p: 0, label: "start" }, { p: argmaxP(heat), label: "peak solves" }],
    label: (p) => `${clockUTC(data.start + p * span)} UTC  ·  ${elapsed(data.start + p * span, data.start)}`,
    onProgress: draw,
  });
  host.appendChild(transport.root);
  let settle = 0;
  function tick() { if (!transport.playing) draw(lastP); settle = requestAnimationFrame(tick); }
  settle = requestAnimationFrame(tick);
  return { redraw: () => draw(lastP), destroy: () => { cancelAnimationFrame(settle); transport.destroy(); } };
}

// ------------------------------------------------------ cluster floor (pods)
interface Insts { start: number; end: number; nodes: number; nodeNames: string[]; instances: [number, number, number, number, number][]; }
interface Chal { id: number; name: string; category: string; value: number; solves: number; }
type V3 = [number, number, number];

export function setupGrid(host: HTMLElement, data: Insts, challenges: Chal[]): Viz {
  const insts = data.instances; // [node, chal, team, startOffset, duration]
  const spanEnd = insts.reduce((m, i) => Math.max(m, data.start + i[3] + i[4]), data.start);
  const span = spanEnd - data.start;
  const N = data.nodes;
  const cols = Math.ceil(Math.sqrt(N));
  const rows = Math.ceil(N / cols);

  // challenge + category metadata
  const chalMeta = new Map<number, Chal>();
  for (const c of challenges) chalMeta.set(c.id, c);
  const cats = Array.from(new Set(challenges.map((c) => c.category))).sort();
  const catIndex = new Map(cats.map((c, i) => [c, i]));
  const catColor = (cat: string, dark: boolean): string => {
    const i = catIndex.get(cat) ?? 0;
    const hue = Math.round((i * 360) / cats.length);
    return `hsl(${hue}, ${dark ? 62 : 66}%, ${dark ? 60 : 48}%)`;
  };
  // CTFd platform pods use a reserved neutral colour, distinct from challenge hues
  const platLabel = (c: number): string => c === -2 ? "MariaDB" : c === -3 ? "Redis" : c === -4 ? "controller" : "CTFd web";
  const platColor = (dark: boolean): string => dark ? "#94a6bd" : "#59697d";

  // category filter state
  const hiddenCats = new Set<string>();

  // peak concurrency on any node -> stack scale
  let globalMax = 1;
  {
    const evs: [number, number][][] = Array.from({ length: N }, () => []);
    for (const [node, , , off, dur] of insts) { const st = data.start + off; evs[node].push([st, 1]); evs[node].push([st + dur, -1]); }
    for (let n = 0; n < N; n++) { evs[n].sort((a, b) => a[0] - b[0]); let c = 0, m = 0; for (const [, d] of evs[n]) { c += d; if (c > m) m = c; } if (m > globalMax) globalMax = m; }
  }

  const stats = el("div", "ctf-gridstats");
  const sActive = statBox(stats, "pods running");
  const sTotal = statBox(stats, "scheduled so far");
  const sNodes = statBox(stats, "nodes in use");
  const sPeak = statBox(stats, "busiest node");
  host.appendChild(stats);

  const cv = el("canvas", "ctf-canvas ctf-canvas-grid") as HTMLCanvasElement;
  host.appendChild(cv);
  const panel = el("div", "ctf-nodepanel");
  panel.style.display = "none";
  host.appendChild(panel);
  const legend = el("div", "ctf-catlegend");
  host.appendChild(legend);
  host.appendChild(el("div", "ctf-gridlegend",
    `Each cube is one live challenge pod, coloured by category · it drops onto the node the scheduler placed it on, then is torn down when the team finishes · <b>drag to rotate</b> · hover/click a node · double-click to reset`));
  const ctx = cv.getContext("2d")!;

  function buildLegend(): void {
    legend.replaceChildren();
    const dark = document.documentElement.classList.contains("dark");

    const mkChip = (label: string, color: string) => {
      const chip = el("span", "ctf-catchip") as HTMLSpanElement;
      const hidden = hiddenCats.has(label);
      chip.classList.toggle("off", hidden);
      const dot = el("span", "ctf-catdot"); dot.style.background = color;
      chip.append(dot, document.createTextNode(label));
      chip.addEventListener("click", () => {
        if (hiddenCats.has(label)) hiddenCats.delete(label);
        else hiddenCats.add(label);
        chip.classList.toggle("off");
        draw(lastP);
      });
      chip.style.cursor = "pointer";
      chip.title = `${hidden ? "Show" : "Hide"} "${label}" pods`;
      legend.appendChild(chip);
    };

    for (const c of cats) mkChip(c, catColor(c, dark));
    for (const pc of ["CTFd web", "MariaDB", "Redis", "controller"]) mkChip(pc, platColor(dark));
  }

  // camera
  const view = { yaw: -0.62, pitch: 0.86 };
  const target = { yaw: -0.62, pitch: 0.86 };
  const home = { yaw: -0.62, pitch: 0.86 };
  const ROT_EASE = 0.14;
  let dragging = false, moved = false, lx = 0, ly = 0;
  cv.addEventListener("pointerdown", (e) => { dragging = true; moved = false; lx = e.clientX; ly = e.clientY; cv.setPointerCapture(e.pointerId); cv.style.cursor = "grabbing"; });
  cv.addEventListener("pointermove", (e) => {
    if (dragging) {
      if (Math.abs(e.clientX - lx) + Math.abs(e.clientY - ly) > 3) moved = true;
      target.yaw -= (e.clientX - lx) * 0.009;
      target.pitch = clamp(target.pitch + (e.clientY - ly) * 0.006, 0.18, 1.4);
      lx = e.clientX; ly = e.clientY;
    } else {
      hover(e.clientX, e.clientY);
    }
  });
  const endDrag = () => { dragging = false; cv.style.cursor = "grab"; };
  cv.addEventListener("pointerup", endDrag);
  cv.addEventListener("pointercancel", endDrag);
  cv.addEventListener("pointerleave", () => { hideTip(); });
  cv.addEventListener("dblclick", () => { target.yaw = home.yaw; target.pitch = home.pitch; });
  cv.addEventListener("click", (e) => {
    if (moved) return;
    const n = pick(e.clientX, e.clientY);
    if (n < 0 || n === pinned) { pinned = -1; panel.style.display = "none"; }
    else { pinned = n; showPanel(n); }
  });

  // world constants
  const SPACING = 1.0, TILE = 0.82, PF = 2, CUBE = 0.32, CUBEH = 0.30;
  const maxLayers = Math.max(1, Math.ceil(globalMax / (PF * PF)));
  const maxStackH = maxLayers * CUBEH;

  // per-pod visual state
  interface VP { node: number; cat: string; team: number; chal: number; slot: number; born: number; die: number; fallSlot?: number; fallStart?: number; }
  const visual = new Map<number, VP>();
  const nodeSlots: boolean[][] = Array.from({ length: N }, () => []);
  const alloc = (node: number): number => { const s = nodeSlots[node]; for (let i = 0; i < s.length; i++) if (!s[i]) { s[i] = true; return i; } s.push(true); return s.length - 1; };
  const DROP_MS = 520, DIE_MS = 380;

  // screen positions of node centers (for hit-testing), recomputed each frame
  const nodeScreen: [number, number][] = Array.from({ length: N }, () => [0, 0]);
  let pinned = -1;

  function nodeAgg(n: number): { count: number; cats: Map<string, number>; teams: Set<number> } {
    const c = new Map<string, number>(); const teams = new Set<number>(); let count = 0;
    for (const vp of visual.values()) if (vp.node === n && vp.die === 0 && !hiddenCats.has(vp.cat)) { count++; c.set(vp.cat, (c.get(vp.cat) ?? 0) + 1); teams.add(vp.team); }
    return { count, cats: c, teams };
  }
  function pick(clientX: number, clientY: number): number {
    const r = cv.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top;
    let best = -1, bd = 42 * 42;
    for (let n = 0; n < N; n++) { const dx = x - nodeScreen[n][0], dy = y - nodeScreen[n][1]; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = n; } }
    return best;
  }
  function hover(clientX: number, clientY: number): void {
    const n = pick(clientX, clientY);
    if (n < 0) { hideTip(); return; }
    const a = nodeAgg(n);
    const topCats = Array.from(a.cats.entries()).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(" · ");
    showTip(clientX, clientY, `<b>${data.nodeNames[n] ?? "node " + n}</b><span>${a.count} pods · ${a.teams.size} teams</span>${topCats ? `<span>${topCats}</span>` : ""}`);
  }
  function showPanel(n: number): void {
    const a = nodeAgg(n);
    const rows = Array.from(a.cats.entries()).sort((x, y) => y[1] - x[1])
      .map(([k, v]) => `<div class="ctf-np-row"><span>${k}</span><b>${v}</b></div>`).join("");
    panel.innerHTML = `<div class="ctf-np-title">${data.nodeNames[n] ?? "node " + n}</div>`
      + `<div class="ctf-np-sub">${a.count} pods running · ${a.teams.size} teams</div>${rows}`
      + `<div class="ctf-np-note">CPU / RAM per node weren't captured in this backup.</div>`;
    panel.style.display = "block";
  }

  let lastP = 0;
  function draw(p: number): void {
    lastP = p;
    const pal = palette();
    const dark = document.documentElement.classList.contains("dark");
    const { w, h } = fitCanvas(cv);
    const now = data.start + p * span;
    const nowReal = performance.now();
    ctx.clearRect(0, 0, w, h);

    view.yaw += (target.yaw - view.yaw) * ROT_EASE;
    view.pitch += (target.pitch - view.pitch) * ROT_EASE;

    // ---- reconcile visual pods against the data at `now` ----
    let totalSoFar = 0;
    for (let i = 0; i < insts.length; i++) {
      const [node, chal, team, off, dur] = insts[i];
      const st = data.start + off;
      if (st <= now) totalSoFar++;
      const active = st <= now && now < st + dur;
      const vp = visual.get(i);
      if (active && !vp) {
        const meta = chalMeta.get(chal);
        const cat = chal < 0 ? platLabel(chal) : (meta ? meta.category : "?");
        visual.set(i, { node, cat, team, chal, slot: alloc(node), born: nowReal, die: 0 });
      } else if (!active && vp && vp.die === 0) {
        vp.die = nowReal;
      }
    }
    const deadIds: number[] = [];
    const changedNodes = new Set<number>();
    for (const [i, vp] of visual) {
      if (vp.die && nowReal - vp.die > DIE_MS) {
        nodeSlots[vp.node][vp.slot] = false;
        changedNodes.add(vp.node);
        deadIds.push(i);
      }
    }
    for (const i of deadIds) visual.delete(i);
    for (const node of changedNodes) {
      const fps = PF * PF;
      for (let fp = 0; fp < fps; fp++) {
        const columnPods: [number, VP][] = [];
        for (const [i, vp] of visual) {
          if (vp.node === node && vp.slot % fps === fp) columnPods.push([i, vp]);
        }
        columnPods.sort((a, b) => Math.floor(a[1].slot / fps) - Math.floor(b[1].slot / fps));
        columnPods.forEach(([, vp], layerIdx) => {
          const newSlot = fp + layerIdx * fps;
          if (vp.slot !== newSlot) {
            vp.fallSlot = vp.slot;
            vp.fallStart = nowReal;
          }
          vp.slot = newSlot;
        });
      }
      let maxSlot = -1;
      for (const [, vp] of visual) if (vp.node === node && vp.slot > maxSlot) maxSlot = vp.slot;
      const used = new Array(maxSlot + 1).fill(false);
      for (const [, vp] of visual) if (vp.node === node) used[vp.slot] = true;
      nodeSlots[node] = used;
    }

    // per-node aggregates for floor pressure / labels
    const cnt = new Int32Array(N);
    let running = 0, busiest = 0, nodesUsed = 0;
    for (const vp of visual.values()) if (vp.die === 0) {
      if (hiddenCats.has(vp.cat)) continue;
      cnt[vp.node]++; running++;
    }
    for (let n = 0; n < N; n++) { if (cnt[n] > 0) { nodesUsed++; if (cnt[n] > busiest) busiest = cnt[n]; } }

    // ---- camera basis ----
    const a = view.yaw, e = view.pitch;
    const ca = Math.cos(a), sa = Math.sin(a), ce = Math.cos(e), se = Math.sin(e);
    const right: V3 = [-sa, ca, 0];
    const up: V3 = [-se * ca, -se * sa, ce];
    const dir: V3 = [ce * ca, ce * sa, se];
    const light: V3 = norm([-0.4, -0.5, 0.9]);
    const dot = (u: V3, v: V3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const sx = (v: V3) => dot(v, right), sy = (v: V3) => dot(v, up);

    // ---- stable fit from world bounds (ignores transient drop offsets) ----
    const ex = ((cols - 1) / 2) * SPACING + SPACING * 0.6;
    const ey = ((rows - 1) / 2) * SPACING + SPACING * 0.6;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const cx of [-ex, ex]) for (const cy of [-ey, ey]) for (const cz of [0, maxStackH + 0.5]) {
      const X = sx([cx, cy, cz]), Y = sy([cx, cy, cz]);
      if (X < minX) minX = X; if (X > maxX) maxX = X; if (Y < minY) minY = Y; if (Y > maxY) maxY = Y;
    }
    const pad = 18;
    const scale = Math.min((w - pad * 2) / (maxX - minX || 1), (h - pad * 2) / (maxY - minY || 1));
    const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
    const toC = (pt: V3): [number, number] => [w / 2 + (sx(pt) - midX) * scale, h / 2 - (sy(pt) - midY) * scale];

    interface Face { pts: V3[]; depth: number; color: string; alpha: number; }
    const faces: Face[] = [];
    const faceDefs: { idx: number[]; n: V3 }[] = [
      { idx: [4, 5, 6, 7], n: [0, 0, 1] }, { idx: [1, 2, 6, 5], n: [1, 0, 0] },
      { idx: [3, 0, 4, 7], n: [-1, 0, 0] }, { idx: [2, 3, 7, 6], n: [0, 1, 0] }, { idx: [0, 1, 5, 4], n: [0, -1, 0] },
    ];
    const box = (cx: number, cy: number, bz: number, hx: number, hy: number, hz: number, base: string, alpha: number, flash: number) => {
      const v: V3[] = [
        [cx - hx, cy - hy, bz], [cx + hx, cy - hy, bz], [cx + hx, cy + hy, bz], [cx - hx, cy + hy, bz],
        [cx - hx, cy - hy, bz + hz], [cx + hx, cy - hy, bz + hz], [cx + hx, cy + hy, bz + hz], [cx - hx, cy + hy, bz + hz],
      ];
      for (const fd of faceDefs) {
        if (dot(fd.n, dir) <= 0.001) continue;
        const pts = fd.idx.map((k) => v[k]);
        const shade = 0.5 + 0.5 * Math.max(0, dot(fd.n, light));
        let col = mix(base, "#000000", (1 - shade) * 0.55);
        if (fd.n[2] === 1 && flash > 0.01) col = mix(col, "#ffffff", flash * 0.8);
        const depth = (dot(pts[0], dir) + dot(pts[2], dir)) / 2;
        faces.push({ pts, depth, color: col, alpha });
      }
    };

    // floor tiles (datacenter floor), tinted by pod pressure
    const good = "#1f9d57", warn = "#e0a51f", crit = "#d84a3a";
    for (let n = 0; n < N; n++) {
      const gx = n % cols, gy = Math.floor(n / cols);
      const wx = (gx - (cols - 1) / 2) * SPACING, wy = (gy - (rows - 1) / 2) * SPACING;
      const load = clamp(cnt[n] / globalMax, 0, 1);
      let tile = mix(pal.nodeBg, good, load * 0.5);
      if (load > 0.5) tile = mix(warn, crit, (load - 0.5) / 0.5);
      else if (load > 0.15) tile = mix(good, warn, (load - 0.15) / 0.35);
      const hs = TILE / 2;
      const pts: V3[] = [[wx - hs, wy - hs, 0], [wx + hs, wy - hs, 0], [wx + hs, wy + hs, 0], [wx - hs, wy + hs, 0]];
      faces.push({ pts, depth: dot([wx, wy, 0], dir), color: cnt[n] ? tile : pal.nodeBg, alpha: cnt[n] ? 0.92 : 0.5 });
      nodeScreen[n] = toC([wx, wy, 0]);
    }

    // pods
    for (const vp of visual.values()) {
      if (hiddenCats.has(vp.cat)) continue;
      const gx = vp.node % cols, gy = Math.floor(vp.node / cols);
      const wx = (gx - (cols - 1) / 2) * SPACING, wy = (gy - (rows - 1) / 2) * SPACING;
      const col = vp.slot % PF, row = Math.floor(vp.slot / PF) % PF, layer = Math.floor(vp.slot / (PF * PF));
      const px = wx + (col - (PF - 1) / 2) * (CUBE + 0.02);
      const py = wy + (row - (PF - 1) / 2) * (CUBE + 0.02);
      let bz = layer * CUBEH;
      let sc = 1, flash = 0, alpha = 1;
      if (vp.die) {
        const t = clamp((nowReal - vp.die) / DIE_MS, 0, 1);
        sc = 1 - t; alpha = 1 - t; bz += t * CUBEH * 0.4;               // evaporate up + shrink
      } else {
        const t = clamp((nowReal - vp.born) / DROP_MS, 0, 1);
        bz += (1 - easeOutCubic(t)) * (CUBEH * 6);
        flash = 1 - t; sc = 0.6 + 0.4 * t;
      }
      if (vp.fallStart) {
        const tF = clamp((nowReal - vp.fallStart) / 220, 0, 1);
        const oldLayer = Math.floor((vp.fallSlot ?? 0) / (PF * PF));
        if (tF >= 1) { delete vp.fallStart; delete vp.fallSlot; }
        else bz = lerp(oldLayer * CUBEH, bz, tF);
      }
      if (sc < 0.02) continue;
      const base = vp.chal < 0 ? platColor(dark) : catColor(vp.cat, dark);
      box(px, py, bz, (CUBE / 2) * sc, (CUBE / 2) * sc, CUBEH * sc, base, alpha, flash);
    }

    faces.sort((f1, f2) => f1.depth - f2.depth);
    for (const fc of faces) {
      ctx.globalAlpha = fc.alpha;
      ctx.beginPath();
      fc.pts.forEach((pt, i) => { const c = toC(pt); i ? ctx.lineTo(c[0], c[1]) : ctx.moveTo(c[0], c[1]); });
      ctx.closePath();
      ctx.fillStyle = fc.color; ctx.fill();
      ctx.strokeStyle = mix(fc.color, "#000000", 0.28); ctx.lineWidth = 0.5; ctx.stroke();
    }
    ctx.globalAlpha = 1;

    sActive.v.textContent = fmt(running); sActive.v.style.color = pal.crit;
    sTotal.v.textContent = fmt(totalSoFar);
    sNodes.v.textContent = nodesUsed + " / " + N;
    sPeak.v.textContent = String(busiest);
    if (pinned >= 0) showPanel(pinned);
  }

  buildLegend();
  const heat = concurrencyHeat(insts, data.start, spanEnd);
  const transport = new Transport({
    spanSeconds: span, speeds: [1, 60, 600, 1800], defaultSpeedIndex: 3, heat,
    markers: [{ p: 0, label: "start" }, { p: argmaxP(heat), label: "peak load" }],
    label: (p) => `${clockUTC(data.start + p * span)} UTC  ·  ${elapsed(data.start + p * span, data.start)}`,
    onProgress: draw,
  });
  host.appendChild(transport.root);

  let settle = 0;
  function tick() { if (!transport.playing) draw(lastP); settle = requestAnimationFrame(tick); }
  settle = requestAnimationFrame(tick);
  return {
    redraw: () => { buildLegend(); draw(lastP); },
    destroy: () => { cancelAnimationFrame(settle); transport.destroy(); },
  };
}
function concurrencyHeat(insts: [number, number, number, number, number][], start: number, end: number, bins = 72): number[] {
  const arr = new Array(bins).fill(0); const span = (end - start) || 1;
  for (const [, , , off, dur] of insts) {
    const s = start + off, e = s + dur;
    let b0 = clamp(Math.floor(((s - start) / span) * bins), 0, bins - 1);
    let b1 = clamp(Math.floor(((e - start) / span) * bins), 0, bins - 1);
    for (let b = b0; b <= b1; b++) arr[b]++;
  }
  const mx = Math.max(1, ...arr);
  return arr.map((v) => v / mx);
}

function statBox(host: HTMLElement, label: string): { v: HTMLElement } {
  const b = el("div", "ctf-gstat");
  const v = el("div", "ctf-gstat-v", "0");
  b.appendChild(v); b.appendChild(el("div", "ctf-gstat-l", label));
  host.appendChild(b);
  return { v };
}

// ---------------------------------------------------------------- ticker
interface FB { challenge: string; category: string; team: string; secondsAfterStart: number; t: number; }
export function setupTicker(host: HTMLElement, data: FB[], start: number): Viz {
  const rows = data.slice().sort((a, b) => a.t - b.t);
  const spanEnd = rows.length ? rows[rows.length - 1].t : start + 1;
  const span = spanEnd - start;
  const stage = el("div", "ctf-tick-stage");
  const bigTime = el("div", "ctf-tick-time", "—");
  const bigChal = el("div", "ctf-tick-chal", "Press play to replay every first blood");
  const bigTeam = el("div", "ctf-tick-team", "");
  stage.append(bigTime, bigChal, bigTeam);
  host.appendChild(stage);
  const list = el("div", "ctf-tick-list");
  const rowEls: HTMLElement[] = rows.map((r) => {
    const row = el("div", "ctf-tick-row");
    row.append(
      el("span", "ctf-tick-rt", elapsed(r.t, start)), el("span", "ctf-tick-rc", r.challenge),
      el("span", "ctf-tick-rcat", r.category), el("span", "ctf-tick-rteam", r.team),
    );
    list.appendChild(row); return row;
  });
  host.appendChild(list);
  let lastActive = -1;
  function draw(p: number): void {
    const now = start + p * span;
    let active = -1;
    for (let i = 0; i < rows.length; i++) if (rows[i].t <= now) active = i; else break;
    if (active !== lastActive) {
      rowEls.forEach((rEl, i) => rEl.classList.toggle("on", i <= active));
      if (active >= 0) {
        const r = rows[active];
        bigTime.textContent = `${elapsed(r.t, start)}  ·  ${clockUTC(r.t)} UTC`;
        bigChal.textContent = r.challenge;
        bigTeam.textContent = `first blood — ${r.team}  ·  ${r.category}`;
        rowEls[active].scrollIntoView({ block: "nearest", behavior: "smooth" });
      } else { bigTime.textContent = "—"; bigChal.textContent = "Press play to replay every first blood"; bigTeam.textContent = ""; }
      lastActive = active;
    }
  }
  const heat = densityOf(rows.map((r) => r.t), start, spanEnd);
  const transport = new Transport({
    spanSeconds: span, heat,
    markers: [{ p: 0, label: "first blood" }],
    label: (p) => `${clockUTC(start + p * span)} UTC  ·  first bloods: ${lastActive + 1}/${rows.length}`,
    onProgress: draw,
  });
  host.appendChild(transport.root);
  return { redraw: () => draw(lastActive < 0 ? 0 : (rows[lastActive].t - start) / span), destroy: () => transport.destroy() };
}

// ---------------------------------------------------------------- network flow
interface Net {
  start: number; end: number; nodes: number;
  t: number[]; rx: number[]; tx: number[];
  peakRx: number; peakTx: number; totalRxGB: number; totalTxGB: number;
}
export function setupNetwork(host: HTMLElement, data: Net): Viz {
  const M = data.t.length;
  const span = (data.t[M - 1] - data.start) || 1;
  // cumulative GB (rx+tx) up to each sample
  const cum: number[] = []; let acc = 0;
  for (let i = 0; i < M; i++) {
    if (i > 0) { const dt = data.t[i] - data.t[i - 1]; acc += (data.rx[i] + data.tx[i]) * dt / 1024; }
    cum.push(acc);
  }
  const peak = Math.max(data.peakRx, data.peakTx, 1);

  const stats = el("div", "ctf-gridstats");
  const sIn = statBox(stats, "ingress now");
  const sOut = statBox(stats, "egress now");
  const sTot = statBox(stats, "transferred so far");
  const sPk = statBox(stats, "peak ingress");
  host.appendChild(stats);
  const cv = el("canvas", "ctf-canvas ctf-canvas-net") as HTMLCanvasElement;
  host.appendChild(cv);
  host.appendChild(el("div", "ctf-gridlegend",
    "Player traffic: Internet → gateway → challenge pods and back · particle density tracks real throughput at that moment on the timeline"));
  const ctx = cv.getContext("2d")!;

  function sample(now: number): { rx: number; tx: number; cum: number } {
    if (now <= data.t[0]) return { rx: data.rx[0], tx: data.tx[0], cum: cum[0] };
    if (now >= data.t[M - 1]) return { rx: data.rx[M - 1], tx: data.tx[M - 1], cum: cum[M - 1] };
    let i = 1; while (i < M && data.t[i] < now) i++;
    const t0 = data.t[i - 1], t1 = data.t[i], f = (now - t0) / ((t1 - t0) || 1);
    return { rx: lerp(data.rx[i - 1], data.rx[i], f), tx: lerp(data.tx[i - 1], data.tx[i], f), cum: lerp(cum[i - 1], cum[i], f) };
  }

  interface P { dir: 0 | 1; prog: number; sp: number; j: number; }
  const parts: P[] = [];
  let inAcc = 0, outAcc = 0;
  const RATE = 1.5, CAP = 520, TRAVEL = 2.4; // particles/(MB/s)/s, max, seconds across
  let cur = { rx: 0, tx: 0, cum: 0 };
  let lastP = 0;

  function onProg(p: number): void {
    lastP = p;
    cur = sample(data.start + p * span);
    sIn.v.textContent = cur.rx.toFixed(1) + " MB/s";
    sOut.v.textContent = cur.tx.toFixed(1) + " MB/s";
    sTot.v.textContent = cur.cum >= 1024 ? (cur.cum / 1024).toFixed(1) + " TB" : Math.round(cur.cum) + " GB";
    sPk.v.textContent = data.peakRx + " MB/s";
  }

  let raf = 0, prev = 0;
  function frame(ts: number): void {
    const dt = prev ? Math.min((ts - prev) / 1000, 0.05) : 0; prev = ts;
    // spawn proportional to current throughput
    inAcc += cur.rx * RATE * dt;
    outAcc += cur.tx * RATE * dt;
    while (inAcc >= 1 && parts.length < CAP) { parts.push({ dir: 0, prog: 0, sp: (1 / TRAVEL) * (0.85 + Math.random() * 0.3), j: (Math.random() - 0.5) }); inAcc--; }
    while (outAcc >= 1 && parts.length < CAP) { parts.push({ dir: 1, prog: 0, sp: (1 / TRAVEL) * (0.85 + Math.random() * 0.3), j: (Math.random() - 0.5) }); outAcc--; }
    for (const p of parts) p.prog += p.sp * dt;
    for (let i = parts.length - 1; i >= 0; i--) if (parts[i].prog >= 1) parts.splice(i, 1);
    draw();
    raf = requestAnimationFrame(frame);
  }

  function draw(): void {
    const pal = palette();
    const { w, h } = fitCanvas(cv);
    ctx.clearRect(0, 0, w, h);
    const xL = w * 0.14, xM = w * 0.5, xR = w * 0.86;
    const yIn = h * 0.40, yOut = h * 0.60, laneGap = Math.min(h * 0.13, 42);
    const inCol = pal.aqua, outCol = pal.c2;

    sIn.v.style.color = inCol; sOut.v.style.color = outCol;

    // pipes
    ctx.lineCap = "round";
    ctx.strokeStyle = pal.grid; ctx.lineWidth = laneGap * 0.7;
    ctx.beginPath(); ctx.moveTo(xL, yIn); ctx.lineTo(xR, yIn); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(xL, yOut); ctx.lineTo(xR, yOut); ctx.stroke();

    // particles
    for (const p of parts) {
      const fade = Math.sin(p.prog * Math.PI);       // fade in/out at the ends
      const jy = p.j * laneGap * 0.32;
      if (p.dir === 0) {
        const x = lerp(xL, xR, p.prog), y = yIn + jy;
        drawParticle(ctx, x, y, x - 9, y, inCol, fade);
      } else {
        const x = lerp(xR, xL, p.prog), y = yOut + jy;
        drawParticle(ctx, x, y, x + 9, y, outCol, fade);
      }
    }

    // endpoint nodes (drawn on top)
    const gGlow = clamp((cur.rx + cur.tx) / (peak * 1.4), 0, 1);
    drawInternet(ctx, xL, (yIn + yOut) / 2, pal);
    drawGateway(ctx, xM, (yIn + yOut) / 2, pal, gGlow, inCol);
    drawCluster(ctx, xR, (yIn + yOut) / 2, pal, data.nodes);

    // lane direction labels
    ctx.font = "600 11px Inter, system-ui, sans-serif"; ctx.textBaseline = "alphabetic";
    ctx.fillStyle = inCol; ctx.textAlign = "left"; ctx.fillText("ingress", xL + 4, yIn - laneGap * 0.5);
    drawArrow(ctx, xL + 4 + ctx.measureText("ingress").width + 4, yIn - laneGap * 0.5, 1, inCol);
    ctx.fillStyle = outCol; ctx.textAlign = "right"; ctx.fillText("egress", xR - 4, yOut + laneGap * 0.7 + 10);
    drawArrow(ctx, xR - 4 - ctx.measureText("egress").width - 4, yOut + laneGap * 0.7 + 10, -1, outCol);
  }

  function buildHeat(): number[] {
    const bins = 72, arr = new Array(bins).fill(0);
    for (let i = 0; i < M; i++) { const b = clamp(Math.floor(((data.t[i] - data.start) / span) * bins), 0, bins - 1); arr[b] = Math.max(arr[b], data.rx[i] + data.tx[i]); }
    const mx = Math.max(1, ...arr); return arr.map((v) => v / mx);
  }
  const heat = buildHeat();
  const transport = new Transport({
    spanSeconds: span, heat,
    markers: [{ p: 0, label: "start" }, { p: argmaxP(heat), label: "peak traffic" }],
    label: (p) => `${clockUTC(data.start + p * span)} UTC  ·  ${elapsed(data.start + p * span, data.start)}`,
    onProgress: onProg,
  });
  host.appendChild(transport.root);
  raf = requestAnimationFrame(frame);
  onProg(0);
  return {
    redraw: () => onProg(lastP),
    destroy: () => { cancelAnimationFrame(raf); transport.destroy(); },
  };
}
function drawParticle(ctx: CanvasRenderingContext2D, x: number, y: number, tx: number, ty: number, color: string, alpha: number): void {
  ctx.globalAlpha = clamp(alpha, 0, 1) * 0.9;
  ctx.strokeStyle = color; ctx.lineWidth = 2.4; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
  ctx.globalAlpha = 1;
}
function drawInternet(ctx: CanvasRenderingContext2D, x: number, y: number, pal: ReturnType<typeof palette>): void {
  ctx.strokeStyle = pal.ink2; ctx.fillStyle = pal.nodeBg; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(x, y, 22, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(x, y, 9, 22, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 22, y); ctx.lineTo(x + 22, y); ctx.moveTo(x - 19, y - 11); ctx.lineTo(x + 19, y - 11); ctx.moveTo(x - 19, y + 11); ctx.lineTo(x + 19, y + 11); ctx.stroke();
  nodeLabel(ctx, x, y + 38, "Internet", pal);
}
function drawGateway(ctx: CanvasRenderingContext2D, x: number, y: number, pal: ReturnType<typeof palette>, glow: number, glowCol: string): void {
  const wq = 40, hq = 46;
  if (glow > 0.02) { ctx.globalAlpha = glow * 0.5; ctx.fillStyle = glowCol; ctx.beginPath(); ctx.ellipse(x, y, wq, hq, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
  ctx.fillStyle = pal.surface; ctx.strokeStyle = pal.ink2; ctx.lineWidth = 1.5;
  rrect(ctx, x - wq / 2, y - hq / 2, wq, hq, 7); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = pal.muted; ctx.lineWidth = 1;
  for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(x - wq / 2 + 8, y + i * 10); ctx.lineTo(x + wq / 2 - 8, y + i * 10); ctx.stroke(); }
  nodeLabel(ctx, x, y + hq / 2 + 16, "Gateway", pal);
  ctx.fillStyle = pal.muted; ctx.font = "500 9px Inter, system-ui, sans-serif"; ctx.textAlign = "center";
  ctx.fillText("envoy", x, y + hq / 2 + 28);
}
function drawCluster(ctx: CanvasRenderingContext2D, x: number, y: number, pal: ReturnType<typeof palette>, nodes: number): void {
  const s = 11, gap = 3, cols = 3, rows = 3;
  const gw = cols * s + (cols - 1) * gap, gh = rows * s + (rows - 1) * gap;
  ctx.fillStyle = pal.nodeBg; ctx.strokeStyle = pal.ink2; ctx.lineWidth = 1;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const px = x - gw / 2 + c * (s + gap), py = y - gh / 2 + r * (s + gap);
    rrect(ctx, px, py, s, s, 2); ctx.fill(); ctx.stroke();
  }
  nodeLabel(ctx, x, y + gh / 2 + 16, `Cluster · ${nodes} nodes`, pal);
}
function nodeLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, pal: ReturnType<typeof palette>): void {
  ctx.fillStyle = pal.ink; ctx.font = "600 12px Inter, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x, y);
}
function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, h / 2, w / 2);
  ctx.beginPath(); ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr); ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr); ctx.arcTo(x, y, x + w, y, rr); ctx.closePath();
}

// ---------------------------------------------------------------- utils
// ---------------------------------------------------------------- icon helpers
const ICONS: Record<string, string> = {
  play: '<polygon points="7,5 19,12 7,19"/>',
  pause: '<rect x="7" y="5" width="3.5" height="14"/><rect x="15" y="5" width="3.5" height="14"/>',
  restart: '<path d="M17.65 6.35A7.96 7.96 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>',
};
function mkIcon(type: string): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("fill", "currentColor");
  svg.innerHTML = ICONS[type] ?? "";
  return svg;
}
function setIcon(icon: SVGElement, type: string): void {
  icon.innerHTML = ICONS[type] ?? "";
}
function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, dir: number, color: string): void {
  const s = 5;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + dir * s, y);
  ctx.lineTo(x, y - s * 0.6);
  ctx.lineTo(x, y + s * 0.6);
  ctx.closePath();
  ctx.fill();
}

function easeOutCubic(t: number): number { return 1 - Math.pow(1 - t, 3); }
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, h / 2, w / 2);
  ctx.beginPath(); ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr); ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr); ctx.arcTo(x, y, x + w, y, rr); ctx.closePath();
}
function clip(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text; while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}
function mix(a: string, b: string, t: number): string {
  const A = hex2rgb(a), B = hex2rgb(b);
  return `rgb(${Math.round(lerp(A.r, B.r, t))},${Math.round(lerp(A.g, B.g, t))},${Math.round(lerp(A.b, B.b, t))})`;
}
function hex2rgb(hex: string): { r: number; g: number; b: number } {
  const s = hex.trim();
  if (s.startsWith("rgb")) { const m = s.match(/\d+/g); if (m) return { r: +m[0], g: +m[1], b: +m[2] }; }
  if (s.startsWith("hsl")) { const m = s.match(/-?\d+(\.\d+)?/g); if (m) return hsl2rgb(+m[0], +m[1], +m[2]); }
  let x = s.replace("#", ""); if (x.length === 3) x = x.split("").map((c) => c + c).join("");
  const n = parseInt(x || "888888", 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function hsl2rgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const f = (n: number) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return { r: Math.round(255 * f(0)), g: Math.round(255 * f(8)), b: Math.round(255 * f(4)) };
}
function norm(v: V3): V3 { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
