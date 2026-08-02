// Shared helpers for the CTF showcase visualizations.
// Colors are read from CSS custom properties on the .ctf root so everything
// stays theme-aware (the site toggles `html.dark`).

export type Cleanup = () => void;

const NS = "http://www.w3.org/2000/svg";

/** Resolve a CSS custom property (e.g. "--c1") from the .ctf root, live. */
export function cssvar(name: string): string {
  const root = document.querySelector(".ctf") ?? document.documentElement;
  return getComputedStyle(root).getPropertyValue(name).trim() || "#888";
}

/** Palette roles, resolved fresh each call so theme toggles are picked up. */
export function palette() {
  return {
    surface: cssvar("--ctf-surface"),
    ink: cssvar("--ctf-ink"),
    ink2: cssvar("--ctf-ink2"),
    muted: cssvar("--ctf-muted"),
    grid: cssvar("--ctf-grid"),
    axis: cssvar("--ctf-axis"),
    c1: cssvar("--ctf-c1"),
    c2: cssvar("--ctf-c2"),
    aqua: cssvar("--ctf-aqua"),
    gold: cssvar("--ctf-gold"),
    good: cssvar("--ctf-good"),
    crit: cssvar("--ctf-crit"),
    violet: cssvar("--ctf-violet"),
    nodeBg: cssvar("--ctf-nodebg"),
    flash: cssvar("--ctf-flash"),
    seq: [
      cssvar("--ctf-seq1"), cssvar("--ctf-seq2"), cssvar("--ctf-seq3"),
      cssvar("--ctf-seq4"), cssvar("--ctf-seq5"),
    ],
  };
}
export type Palette = ReturnType<typeof palette>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, html?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
}

export function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  return n;
}

export function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

/** Round to at most `d` decimals and group thousands. */
export function fmtf(n: number, d = 1): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: d });
}

export function pad2(n: number): string { return n < 10 ? "0" + n : "" + n; }

/** Format a unix-second timestamp as "Day HH:MM" in UTC. */
export function clockUTC(unix: number): string {
  const d = new Date(unix * 1000);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  return `${day} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** Elapsed h:mm from a start unix ts. */
export function elapsed(unix: number, start: number): string {
  const s = Math.max(0, unix - start);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `+${h}:${pad2(m)}`;
}

export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** Size a canvas for the device pixel ratio; returns the CSS width/height. */
export function fitCanvas(cv: HTMLCanvasElement): { w: number; h: number; dpr: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = cv.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const ctx = cv.getContext("2d");
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h, dpr };
}

/** Re-run `fn` whenever the theme class on <html> changes. Returns a cleanup. */
export function onThemeChange(fn: () => void): Cleanup {
  const obs = new MutationObserver(() => fn());
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}

/** Debounced resize listener. Returns a cleanup. */
export function onResize(fn: () => void): Cleanup {
  let t = 0;
  const h = () => { clearTimeout(t); t = window.setTimeout(fn, 150); };
  window.addEventListener("resize", h);
  return () => window.removeEventListener("resize", h);
}

/** Reveal `fn` once the element scrolls into view (used to defer heavy renders). */
export function whenVisible(target: Element, fn: () => void): Cleanup {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { fn(); io.disconnect(); break; }
    }
  }, { rootMargin: "120px" });
  io.observe(target);
  return () => io.disconnect();
}

// ---- lightweight shared tooltip -----------------------------------------
let tipEl: HTMLDivElement | null = null;
function tip(): HTMLDivElement {
  if (!tipEl) {
    tipEl = el("div", "ctf-tip");
    tipEl.setAttribute("role", "status");
    document.body.appendChild(tipEl);
  }
  return tipEl;
}
export function showTip(x: number, y: number, html: string): void {
  const t = tip();
  t.innerHTML = html;
  t.style.opacity = "1";
  const pad = 14;
  const rect = t.getBoundingClientRect();
  let left = x + pad;
  let top = y + pad;
  if (left + rect.width > window.innerWidth - 8) left = x - rect.width - pad;
  if (top + rect.height > window.innerHeight - 8) top = y - rect.height - pad;
  t.style.left = Math.max(8, left) + "px";
  t.style.top = Math.max(8, top) + "px";
}
export function hideTip(): void {
  if (tipEl) tipEl.style.opacity = "0";
}

/** Format a number of bytes/seconds axis nicely; returns "nice" ticks. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}
