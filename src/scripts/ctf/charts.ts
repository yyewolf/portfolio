// Static graphs for the CTF showcase, rendered as theme-aware SVG.
// Every chart re-renders on theme change / resize via the bootstrap in index.ts.
import {
  svg, el, fmt, fmtf, clockUTC, palette, showTip, hideTip, niceTicks,
  type Palette,
} from "./util";

const NS = "http://www.w3.org/2000/svg";

interface Box { w: number; h: number; ml: number; mr: number; mt: number; mb: number; }
function plotBox(host: HTMLElement, h: number, m: Partial<Box> = {}): Box {
  const w = Math.max(280, host.clientWidth);
  return {
    w, h,
    ml: m.ml ?? 44, mr: m.mr ?? 16, mt: m.mt ?? 14, mb: m.mb ?? 28,
  };
}
function newSvg(b: Box): SVGSVGElement {
  const s = document.createElementNS(NS, "svg") as SVGSVGElement;
  s.setAttribute("viewBox", `0 0 ${b.w} ${b.h}`);
  s.setAttribute("width", "100%");
  s.setAttribute("height", String(b.h));
  s.setAttribute("preserveAspectRatio", "none");
  s.style.overflow = "visible";
  s.style.display = "block";
  return s;
}
function clear(host: HTMLElement): void { host.replaceChildren(); }

function xAxisTime(s: SVGElement, b: Box, t0: number, t1: number, p: Palette): void {
  const span = t1 - t0;
  const stepH = span > 20 * 3600 ? 6 : 3;
  const first = Math.ceil(t0 / (stepH * 3600)) * stepH * 3600;
  for (let t = first; t <= t1; t += stepH * 3600) {
    const x = b.ml + ((t - t0) / span) * (b.w - b.ml - b.mr);
    const gl = svg("line", { x1: x, y1: b.mt, x2: x, y2: b.h - b.mb, stroke: p.grid, "stroke-width": 1 });
    s.appendChild(gl);
    const lab = svg("text", {
      x, y: b.h - b.mb + 16, fill: p.muted, "font-size": 10, "text-anchor": "middle",
    });
    lab.textContent = clockUTC(t).replace(/^\w+ /, "");
    s.appendChild(lab);
  }
}
function yAxis(s: SVGElement, b: Box, max: number, p: Palette, unit = ""): void {
  const ticks = niceTicks(max, 4);
  for (const v of ticks) {
    const y = b.h - b.mb - (v / max) * (b.h - b.mb - b.mt);
    s.appendChild(svg("line", { x1: b.ml, y1: y, x2: b.w - b.mr, y2: y, stroke: p.grid, "stroke-width": 1 }));
    const lab = svg("text", { x: b.ml - 6, y: y + 3, fill: p.muted, "font-size": 10, "text-anchor": "end" });
    lab.textContent = (v >= 1000 ? fmt(v) : fmtf(v, 1)) + unit;
    s.appendChild(lab);
  }
}

// ---------------------------------------------------------------- numbers
interface Summary {
  name: string; start: number; end: number; durationHours: number;
  usersReg: number; teamsReg: number; teamsScored: number; usersSubmitted: number;
  challenges: number; categories: number; unsolved: number;
  submissions: number; correct: number; accuracyPct: number; wrong: number; rateLimited: number;
  firstBlood: { challenge: string; team: string; seconds: number } | null;
  winner: { team: string; score: number } | null;
  winnerGap: number | null;
  busiestMinute: { time: string; solves: number } | null;
  infra: {
    nodes: number; memTotalGiB: number; instancePodsTotal: number;
    teamChallengeInstances: number; teamsWithInstances: number;
    peakConcurrentInstances: number; peakCpuCores: number; peakMemGiB: number; peakTargets: number;
  };
}

function tile(value: string, label: string, sub?: string, accent?: string): HTMLElement {
  const t = el("div", "ctf-tile");
  const v = el("div", "ctf-tile-v");
  v.textContent = value;
  if (accent) v.style.color = accent;
  t.appendChild(v);
  t.appendChild(el("div", "ctf-tile-l", label));
  if (sub) t.appendChild(el("div", "ctf-tile-s", sub));
  return t;
}

export function renderNumbers(host: HTMLElement, s: Summary): void {
  clear(host);
  const p = palette();
  const comp = el("div", "ctf-tilegrid");
  comp.append(
    tile(fmt(s.teamsReg), "teams registered", `${s.usersReg} players`),
    tile(fmt(s.teamsScored), "teams on the board", `of ${s.teamsReg} scored ≥1`),
    tile(fmt(s.challenges), "challenges", `${s.categories} categories · ${s.unsolved} never solved`),
    tile(fmt(s.submissions), "flag submissions", `${fmt(s.wrong)} wrong · ${fmt(s.rateLimited)} rate-limited`),
    tile(s.accuracyPct + "%", "flag accuracy", `${fmt(s.correct)} correct`, p.c1),
    tile(s.firstBlood ? s.firstBlood.seconds + "s" : "—", "to first blood",
      s.firstBlood ? `${s.firstBlood.team} · ${s.firstBlood.challenge}` : "", p.crit),
    tile(s.winner ? fmt(s.winner.score) : "—", "winning score",
      s.winner ? `${s.winner.team}` : "", p.gold),
    tile(s.winnerGap != null ? fmt(s.winnerGap) : "—", "1st→2nd gap",
      s.busiestMinute ? `busiest min: ${s.busiestMinute.solves} solves @ ${s.busiestMinute.time}` : ""),
  );
  host.appendChild(sectionLabel("The competition"));
  host.appendChild(comp);

  const infra = el("div", "ctf-tilegrid");
  const i = s.infra;
  infra.append(
    tile(fmt(i.instancePodsTotal), "challenge environments", "spun up over the event", p.aqua),
    tile(fmt(i.peakConcurrentInstances), "peak concurrent", "isolated player instances", p.aqua),
    tile(fmt(i.teamChallengeInstances), "team × challenge instances", `by ${i.teamsWithInstances} teams`),
    tile(fmt(i.nodes), "cluster nodes", `${fmt(i.memTotalGiB)} GiB RAM total`),
    tile(fmtf(i.peakCpuCores, 1), "peak CPU cores", "cluster-wide"),
    tile(fmtf(i.peakMemGiB, 1) + " GiB", "peak memory used", `of ${fmt(i.memTotalGiB)} GiB`),
    tile(fmt(i.peakTargets), "scrape targets at peak", "monitored live"),
    tile(s.durationHours + "h", "event duration", "non-stop"),
  );
  host.appendChild(sectionLabel("The infrastructure"));
  host.appendChild(infra);
}

function sectionLabel(text: string): HTMLElement {
  return el("div", "ctf-sublabel", text);
}

// ------------------------------------------------------------ activity area
export function renderActivity(host: HTMLElement, timeline: { solves: [number, number][] }, s: Summary): void {
  clear(host);
  const p = palette();
  const pts = timeline.solves;
  if (!pts.length) return;
  const b = plotBox(host, 220);
  const svgEl = newSvg(b);
  const t0 = s.start, t1 = Math.max(s.end, pts[pts.length - 1][0] + 900);
  const max = Math.max(...pts.map((d) => d[1])) * 1.1;
  const X = (t: number) => b.ml + ((t - t0) / (t1 - t0)) * (b.w - b.ml - b.mr);
  const Y = (v: number) => b.h - b.mb - (v / max) * (b.h - b.mb - b.mt);

  yAxis(svgEl, b, max, p);
  xAxisTime(svgEl, b, t0, t1, p);

  // area + line
  let dArea = `M ${X(pts[0][0])} ${b.h - b.mb}`;
  let dLine = "";
  pts.forEach((d, idx) => {
    const x = X(d[0]), y = Y(d[1]);
    dArea += ` L ${x} ${y}`;
    dLine += (idx ? " L" : "M") + ` ${x} ${y}`;
  });
  dArea += ` L ${X(pts[pts.length - 1][0])} ${b.h - b.mb} Z`;

  const gradId = "ctf-actgrad";
  const defs = document.createElementNS(NS, "defs");
  const lg = svg("linearGradient", { id: gradId, x1: 0, y1: 0, x2: 0, y2: 1 });
  lg.appendChild(svg("stop", { offset: "0%", "stop-color": p.c1, "stop-opacity": 0.35 }));
  lg.appendChild(svg("stop", { offset: "100%", "stop-color": p.c1, "stop-opacity": 0 }));
  defs.appendChild(lg);
  svgEl.appendChild(defs);
  svgEl.appendChild(svg("path", { d: dArea, fill: `url(#${gradId})` }));
  svgEl.appendChild(svg("path", { d: dLine, fill: "none", stroke: p.c1, "stroke-width": 2, "stroke-linejoin": "round" }));

  // crosshair + hover
  const cross = svg("line", { x1: 0, y1: b.mt, x2: 0, y2: b.h - b.mb, stroke: p.axis, "stroke-width": 1, opacity: 0 });
  const dot = svg("circle", { r: 4, fill: p.c1, stroke: p.surface, "stroke-width": 2, opacity: 0 });
  svgEl.appendChild(cross); svgEl.appendChild(dot);
  const hit = svg("rect", { x: b.ml, y: b.mt, width: b.w - b.ml - b.mr, height: b.h - b.mb - b.mt, fill: "transparent" });
  svgEl.appendChild(hit);
  hit.addEventListener("mousemove", (ev) => {
    const me = ev as MouseEvent;
    const rect = svgEl.getBoundingClientRect();
    const px = (me.clientX - rect.left) / rect.width * b.w;
    const t = t0 + ((px - b.ml) / (b.w - b.ml - b.mr)) * (t1 - t0);
    let best = pts[0];
    for (const d of pts) if (Math.abs(d[0] - t) < Math.abs(best[0] - t)) best = d;
    cross.setAttribute("x1", String(X(best[0]))); cross.setAttribute("x2", String(X(best[0])));
    cross.setAttribute("opacity", "1");
    dot.setAttribute("cx", String(X(best[0]))); dot.setAttribute("cy", String(Y(best[1]))); dot.setAttribute("opacity", "1");
    showTip(me.clientX, me.clientY, `<b>${best[1]} solves</b><span>${clockUTC(best[0])} UTC · 15-min window</span>`);
  });
  hit.addEventListener("mouseleave", () => { cross.setAttribute("opacity", "0"); dot.setAttribute("opacity", "0"); hideTip(); });
  host.appendChild(svgEl);
}

// ------------------------------------------------------------ difficulty scatter
interface Chal { id: number; name: string; category: string; value: number; solves: number; }
export function renderScatter(host: HTMLElement, chals: Chal[]): void {
  clear(host);
  const p = palette();
  const b = plotBox(host, 260, { ml: 44, mb: 34 });
  const svgEl = newSvg(b);
  const maxX = Math.max(...chals.map((c) => c.solves)) * 1.08 + 1;
  const maxY = Math.max(...chals.map((c) => c.value)) * 1.08;
  const X = (v: number) => b.ml + (v / maxX) * (b.w - b.ml - b.mr);
  const Y = (v: number) => b.h - b.mb - (v / maxY) * (b.h - b.mb - b.mt);
  // grid
  for (const v of niceTicks(maxY, 4)) {
    const y = Y(v);
    svgEl.appendChild(svg("line", { x1: b.ml, y1: y, x2: b.w - b.mr, y2: y, stroke: p.grid, "stroke-width": 1 }));
    const l = svg("text", { x: b.ml - 6, y: y + 3, fill: p.muted, "font-size": 10, "text-anchor": "end" }); l.textContent = String(v); svgEl.appendChild(l);
  }
  for (const v of niceTicks(maxX, 5)) {
    const x = X(v);
    const l = svg("text", { x, y: b.h - b.mb + 15, fill: p.muted, "font-size": 10, "text-anchor": "middle" }); l.textContent = String(v); svgEl.appendChild(l);
  }
  svgEl.appendChild(axisTitle(b, "solves →", "↑ points", p));
  for (const c of chals) {
    const cx = X(c.solves), cy = Y(c.value);
    const dot = svg("circle", { cx, cy, r: 5, fill: p.c1, "fill-opacity": 0.8, stroke: p.surface, "stroke-width": 1.5 }) as SVGCircleElement;
    dot.style.cursor = "pointer";
    dot.addEventListener("mouseenter", (ev) => {
      const me = ev as MouseEvent;
      dot.setAttribute("r", "7");
      showTip(me.clientX, me.clientY, `<b>${c.name}</b><span>${c.category} · ${c.value} pts · ${c.solves} solves</span>`);
    });
    dot.addEventListener("mousemove", (ev) => { const me = ev as MouseEvent; showTip(me.clientX, me.clientY, `<b>${c.name}</b><span>${c.category} · ${c.value} pts · ${c.solves} solves</span>`); });
    dot.addEventListener("mouseleave", () => { dot.setAttribute("r", "5"); hideTip(); });
    svgEl.appendChild(dot);
  }
  host.appendChild(svgEl);
}
function axisTitle(b: Box, x: string, y: string, p: Palette): SVGElement {
  const g = document.createElementNS(NS, "g");
  const tx = svg("text", { x: b.w - b.mr, y: b.h - 2, fill: p.muted, "font-size": 10, "text-anchor": "end" }); tx.textContent = x;
  const ty = svg("text", { x: 2, y: b.mt + 2, fill: p.muted, "font-size": 10, "text-anchor": "start" }); ty.textContent = y;
  g.appendChild(tx); g.appendChild(ty);
  return g;
}

// ------------------------------------------------------------ categories bars
interface Cat { name: string; challenges: number; solves: number; }
export function renderCategories(host: HTMLElement, cats: Cat[]): void {
  clear(host);
  const p = palette();
  const rows = cats.slice().sort((a, c) => c.solves - a.solves);
  const max = Math.max(...rows.map((r) => r.solves));
  const wrap = el("div", "ctf-bars");
  for (const r of rows) {
    const row = el("div", "ctf-bar-row");
    row.appendChild(el("div", "ctf-bar-name", r.name));
    const track = el("div", "ctf-bar-track");
    const fill = el("div", "ctf-bar-fill");
    fill.style.width = (r.solves / max * 100) + "%";
    fill.style.background = p.c1;
    track.appendChild(fill);
    const val = el("div", "ctf-bar-val", `${r.solves}`);
    row.appendChild(track); row.appendChild(val);
    row.title = `${r.name}: ${r.solves} solves across ${r.challenges} challenges`;
    wrap.appendChild(row);
  }
  host.appendChild(wrap);
}

// ------------------------------------------------------------ score long tail
interface Team { team: string; solves: number; score: number; }
export function renderScoreTail(host: HTMLElement, teams: Team[]): void {
  clear(host);
  const p = palette();
  const rows = teams.slice().sort((a, c) => c.score - a.score);
  const b = plotBox(host, 220, { ml: 48 });
  const svgEl = newSvg(b);
  const max = rows[0].score * 1.05;
  const n = rows.length;
  const X = (i: number) => b.ml + (i / (n - 1)) * (b.w - b.ml - b.mr);
  const Y = (v: number) => b.h - b.mb - (v / max) * (b.h - b.mb - b.mt);
  yAxis(svgEl, b, max, p);
  // x labels: rank
  for (const rk of [1, Math.round(n / 4), Math.round(n / 2), Math.round(3 * n / 4), n]) {
    const x = X(rk - 1);
    const l = svg("text", { x, y: b.h - b.mb + 15, fill: p.muted, "font-size": 10, "text-anchor": "middle" }); l.textContent = "#" + rk; svgEl.appendChild(l);
  }
  let dArea = `M ${X(0)} ${b.h - b.mb}`, dLine = "";
  rows.forEach((r, i) => { const x = X(i), y = Y(r.score); dArea += ` L ${x} ${y}`; dLine += (i ? " L" : "M") + ` ${x} ${y}`; });
  dArea += ` L ${X(n - 1)} ${b.h - b.mb} Z`;
  const defs = document.createElementNS(NS, "defs");
  const lg = svg("linearGradient", { id: "ctf-tailgrad", x1: 0, y1: 0, x2: 0, y2: 1 });
  lg.appendChild(svg("stop", { offset: "0%", "stop-color": p.violet, "stop-opacity": 0.35 }));
  lg.appendChild(svg("stop", { offset: "100%", "stop-color": p.violet, "stop-opacity": 0 }));
  defs.appendChild(lg); svgEl.appendChild(defs);
  svgEl.appendChild(svg("path", { d: dArea, fill: "url(#ctf-tailgrad)" }));
  svgEl.appendChild(svg("path", { d: dLine, fill: "none", stroke: p.violet, "stroke-width": 2 }));
  const dot = svg("circle", { r: 4, fill: p.violet, stroke: p.surface, "stroke-width": 2, opacity: 0 });
  svgEl.appendChild(dot);
  const hit = svg("rect", { x: b.ml, y: b.mt, width: b.w - b.ml - b.mr, height: b.h - b.mb - b.mt, fill: "transparent" });
  svgEl.appendChild(hit);
  hit.addEventListener("mousemove", (ev) => {
    const me = ev as MouseEvent; const rect = svgEl.getBoundingClientRect();
    const px = (me.clientX - rect.left) / rect.width * b.w;
    const i = Math.round(((px - b.ml) / (b.w - b.ml - b.mr)) * (n - 1));
    const r = rows[Math.max(0, Math.min(n - 1, i))];
    dot.setAttribute("cx", String(X(rows.indexOf(r)))); dot.setAttribute("cy", String(Y(r.score))); dot.setAttribute("opacity", "1");
    showTip(me.clientX, me.clientY, `<b>#${rows.indexOf(r) + 1} · ${r.team}</b><span>${fmt(r.score)} pts · ${r.solves} solves</span>`);
  });
  hit.addEventListener("mouseleave", () => { dot.setAttribute("opacity", "0"); hideTip(); });
  host.appendChild(svgEl);
}

// ------------------------------------------------------------ funnel
export function renderFunnel(host: HTMLElement, s: Summary): void {
  clear(host);
  const p = palette();
  const stages = [
    { label: "Users registered", v: s.usersReg, hue: p.seq[1] },
    { label: "Players who submitted", v: s.usersSubmitted, hue: p.seq[2] },
    { label: "Teams registered", v: s.teamsReg, hue: p.seq[3] },
    { label: "Teams that scored", v: s.teamsScored, hue: p.seq[4] },
  ];
  const max = Math.max(...stages.map((x) => x.v));
  const wrap = el("div", "ctf-funnel");
  for (const st of stages) {
    const row = el("div", "ctf-funnel-row");
    const bar = el("div", "ctf-funnel-bar");
    bar.style.width = (st.v / max * 100) + "%";
    bar.style.background = st.hue;
    bar.appendChild(el("span", "ctf-funnel-num", fmt(st.v)));
    row.appendChild(bar);
    row.appendChild(el("div", "ctf-funnel-lab", st.label));
    wrap.appendChild(row);
  }
  host.appendChild(wrap);
}

// ------------------------------------------------------------ infra small multiples
interface Infra { t: number[]; keys: string[]; rows: (number | null)[][]; }
export function renderInfra(host: HTMLElement, infra: Infra, s: Summary): void {
  clear(host);
  const p = palette();
  const panels: { key: string; title: string; unit: string; hue: string }[] = [
    { key: "instances", title: "Concurrent challenge instances", unit: "", hue: p.aqua },
    { key: "cpuCores", title: "CPU cores in use (cluster)", unit: "", hue: p.c1 },
    { key: "memGiB", title: "Memory used", unit: " GiB", hue: p.c2 },
    { key: "targets", title: "Live monitored targets", unit: "", hue: p.violet },
  ];
  const t0 = s.start, t1 = s.end;
  const grid = el("div", "ctf-smallmult");
  for (const panel of panels) {
    const ki = infra.keys.indexOf(panel.key);
    const series: [number, number][] = [];
    infra.t.forEach((tt, idx) => { const v = infra.rows[idx][ki]; if (v != null) series.push([tt, v]); });
    const cell = el("div", "ctf-sm-cell");
    cell.appendChild(el("div", "ctf-sm-title", panel.title));
    const b = plotBox(cell, 120, { ml: 38, mb: 20, mt: 8 });
    const svgEl = newSvg(b);
    const max = Math.max(...series.map((d) => d[1])) * 1.15 || 1;
    const X = (t: number) => b.ml + ((t - t0) / (t1 - t0)) * (b.w - b.ml - b.mr);
    const Y = (v: number) => b.h - b.mb - (v / max) * (b.h - b.mb - b.mt);
    for (const v of niceTicks(max, 2)) {
      const y = Y(v);
      svgEl.appendChild(svg("line", { x1: b.ml, y1: y, x2: b.w - b.mr, y2: y, stroke: p.grid, "stroke-width": 1 }));
      const l = svg("text", { x: b.ml - 5, y: y + 3, fill: p.muted, "font-size": 9, "text-anchor": "end" }); l.textContent = fmtf(v, 0); svgEl.appendChild(l);
    }
    let dLine = "", dArea = `M ${X(series[0][0])} ${b.h - b.mb}`;
    series.forEach((d, i) => { const x = X(d[0]), y = Y(d[1]); dLine += (i ? " L" : "M") + ` ${x} ${y}`; dArea += ` L ${x} ${y}`; });
    dArea += ` L ${X(series[series.length - 1][0])} ${b.h - b.mb} Z`;
    const gid = "grad-" + panel.key;
    const defs = document.createElementNS(NS, "defs");
    const lg = svg("linearGradient", { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
    lg.appendChild(svg("stop", { offset: "0%", "stop-color": panel.hue, "stop-opacity": 0.3 }));
    lg.appendChild(svg("stop", { offset: "100%", "stop-color": panel.hue, "stop-opacity": 0 }));
    defs.appendChild(lg); svgEl.appendChild(defs);
    svgEl.appendChild(svg("path", { d: dArea, fill: `url(#${gid})` }));
    svgEl.appendChild(svg("path", { d: dLine, fill: "none", stroke: panel.hue, "stroke-width": 1.8 }));
    // peak label
    const peak = series.reduce((a, c) => (c[1] > a[1] ? c : a), series[0]);
    const peakLab = svg("text", { x: X(peak[0]), y: Y(peak[1]) - 5, fill: p.ink2, "font-size": 10, "text-anchor": "middle", "font-weight": 600 });
    peakLab.textContent = "peak " + fmtf(peak[1], panel.key === "cpuCores" || panel.key === "memGiB" ? 1 : 0) + panel.unit;
    svgEl.appendChild(peakLab);
    cell.appendChild(svgEl);
    grid.appendChild(cell);
  }
  host.appendChild(grid);
}
