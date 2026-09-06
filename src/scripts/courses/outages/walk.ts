// Runner and view for the lesson 1 outage walk.
//
// Same shape as the lesson 2 game and for the same reasons: one shell is built
// once, and after that only [data-ow-body] is ever replaced, so five stages and
// a summary do not feel like six pages. Markup is built at runtime, which is
// why outages.css is global and hand-namespaced rather than an Astro scoped
// style, and why nothing here renders a bare <header> (global.css pins that to
// the top of the viewport as site chrome; see AGENTS.md gotcha 7).

import { stages, type Built, type Snapshot, type Stage } from "./stages";

const HOLD = 1100;

/** Cards earned so far. `dead` is set when a later outage destroys one. */
interface Card extends Built {
  dead?: boolean;
}

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", [`"`]: "&quot;" })[c] ?? c);

/** `code` spans in reply text, so option copy can name a flag without HTML. */
const ticks = (s: string): string =>
  esc(s).replace(/`([^`]+)`/g, `<code class="ow-code">$1</code>`);

const boxHtml = (snap: Snapshot): string => {
  const boxes = snap.boxes
    .map((b) => {
      const chips = b.chips
        .map(
          (c) =>
            `<li class="ow-chip" data-state="${c.state}"><span>${esc(c.id)}</span></li>`,
        )
        .join("");
      const empty =
        b.chips.length === 0
          ? `<li class="ow-chip" data-state="empty"><span>empty</span></li>`
          : "";
      return `<div class="ow-box" data-state="${b.state}">
        <div class="ow-box-head">
          <span class="ow-box-name">${esc(b.id)}</span>
          <span class="ow-box-state">${b.state === "up" ? "ready" : "not responding"}</span>
        </div>
        <ul class="ow-chips">${chips}${empty}</ul>
      </div>`;
    })
    .join("");

  const caller = snap.caller
    ? `<div class="ow-caller" data-state="${snap.caller.state}">
         <span class="ow-caller-name">${esc(snap.caller.label)}</span>
         <span class="ow-caller-arrow" aria-hidden="true">&rarr;</span>
         <code class="ow-code">${esc(snap.caller.target)}</code>
         <span class="ow-caller-note">${
           snap.caller.state === "lost" ? "no answer" : "resolves"
         }</span>
       </div>`
    : "";

  return `<div class="ow-world" data-dense="${snap.dense ? "yes" : "no"}">
    <div class="ow-boxes">${boxes}</div>${caller}
  </div>`;
};

class Walk {
  private root: HTMLElement;
  private body: HTMLElement;
  private rail: HTMLElement;
  private cards: Card[] = [];
  private i = 0;
  private timer: number | undefined;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="ow-shell">
        <div class="ow-head">
          <ol class="ow-rail" data-ow-rail aria-label="Outages"></ol>
        </div>
        <div class="ow-body" data-ow-body></div>
      </div>`;
    const body = root.querySelector<HTMLElement>("[data-ow-body]");
    const rail = root.querySelector<HTMLElement>("[data-ow-rail]");
    if (!body || !rail) throw new Error("outage walk failed to mount");
    this.body = body;
    this.rail = rail;
    this.paintRail();
    this.stage();
  }

  private paintRail(): void {
    this.rail.innerHTML = stages
      .map((s) => {
        const state = s.n - 1 < this.i ? "done" : s.n - 1 === this.i ? "current" : "todo";
        return `<li data-state="${state}"><span>${s.n}</span></li>`;
      })
      .join("");
  }

  /** The tally, rebuilt whenever it changes. Dead cards stay, struck through. */
  private tallyHtml(): string {
    if (this.cards.length === 0) return "";
    const items = this.cards
      .map(
        (c) => `<li class="ow-card"${c.dead ? ` data-dead="yes"` : ""}>
          <b>${esc(c.label)}</b>
          <span>${esc(c.sub)}</span>
          ${c.dead ? `<em class="ow-card-dead">died with the machine</em>` : ""}
        </li>`,
      )
      .join("");
    return `<div class="ow-tally">
      <p class="ow-tally-head">What you are now running</p>
      <ul class="ow-cards">${items}</ul>
    </div>`;
  }

  private stage(): void {
    const s = stages[this.i];
    if (!s) return this.summary();
    this.paintRail();

    // Calm first, so the breakage is something the reader watches land rather
    // than something that is simply already true when the screen appears.
    this.body.innerHTML = `
      <div class="ow-stage">
        <p class="ow-kicker">Outage ${s.n} of ${stages.length}</p>
        <h3 class="ow-title">${esc(s.title)}</h3>
        <p class="ow-setup">${esc(s.setup)}</p>
        ${boxHtml(s.calm)}
        <div class="ow-alert" data-ow-alert hidden></div>
        <div data-ow-choices></div>
        ${this.tallyHtml()}
      </div>`;

    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.breakIt(s), HOLD);
  }

  private breakIt(s: Stage): void {
    const world = this.body.querySelector(".ow-world");
    if (world) world.outerHTML = boxHtml(s.broken);

    if (s.defeats?.length) {
      for (const c of this.cards) if (s.defeats.includes(c.id)) c.dead = true;
      const tally = this.body.querySelector(".ow-tally");
      if (tally) tally.outerHTML = this.tallyHtml();
    }

    const alert = this.body.querySelector<HTMLElement>("[data-ow-alert]");
    if (alert) {
      alert.innerHTML = `<b>${esc(s.event)}</b><span>${esc(s.detail)}</span>`;
      alert.hidden = false;
    }
    this.choices(s);
  }

  private choices(s: Stage): void {
    const host = this.body.querySelector<HTMLElement>("[data-ow-choices]");
    if (!host) return;
    host.innerHTML = `
      <p class="ow-ask">What do you build?</p>
      <ul class="ow-options">
        ${s.options
          .map(
            (o, k) =>
              `<li><button type="button" class="ow-option" data-k="${k}">${esc(o.text)}</button></li>`,
          )
          .join("")}
      </ul>`;

    host.querySelectorAll<HTMLButtonElement>(".ow-option").forEach((btn) => {
      btn.addEventListener("click", () => this.pick(s, Number(btn.dataset.k), btn));
    });
  }

  /**
   * Wrong answers are spent rather than fatal. Every one of them is something a
   * reasonable person would try, so each shows what actually happens instead of
   * being scored, and the stage stays open until the player finds the fix.
   */
  private pick(s: Stage, k: number, btn: HTMLButtonElement): void {
    const opt = s.options[k];
    if (!opt || btn.disabled) return;

    const li = btn.closest("li");
    btn.disabled = true;
    btn.dataset.picked = opt.right ? "right" : "wrong";
    li?.insertAdjacentHTML(
      "beforeend",
      `<p class="ow-reply" data-tone="${opt.right ? "right" : "wrong"}">${ticks(opt.reply)}</p>`,
    );

    if (!opt.right) return;

    this.body
      .querySelectorAll<HTMLButtonElement>(".ow-option:not(:disabled)")
      .forEach((b) => (b.disabled = true));

    const world = this.body.querySelector(".ow-world");
    if (world) world.outerHTML = boxHtml(s.fixed);

    for (const b of s.built) this.cards.push({ ...b });
    const tally = this.body.querySelector(".ow-tally");
    if (tally) tally.outerHTML = this.tallyHtml();
    else this.body.querySelector(".ow-stage")?.insertAdjacentHTML("beforeend", this.tallyHtml());

    const last = this.i === stages.length - 1;
    this.body.querySelector("[data-ow-choices]")?.insertAdjacentHTML(
      "beforeend",
      `<div class="ow-foot">
         <button type="button" class="ow-btn" data-tone="primary" data-go="next">
           ${last ? "See the list" : "Next outage"}
         </button>
       </div>`,
    );
    this.body.querySelector<HTMLButtonElement>(`[data-go="next"]`)?.addEventListener("click", () => {
      this.i += 1;
      this.stage();
      this.scrollIntoFrame();
    });
  }

  /**
   * Opens the held section and says so. `complete: false` on purpose: the walk
   * is the first third of lesson 1, not the whole of it, so reaching the end of
   * it earns the held prose but does not claim the reader has done the lesson.
   * The consequence is that a reader returning to an unfinished lesson 1 sees
   * the section held again until they either replay or mark the lesson done.
   */
  private announceDone(): void {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-hold]"))) {
      el.hidden = false;
    }
    document.dispatchEvent(new CustomEvent("lesson:reveal", { detail: { complete: false } }));
  }

  private summary(): void {
    this.paintRail();
    this.announceDone();
    this.body.innerHTML = `
      <div class="ow-stage">
        <p class="ow-kicker">Five outages later</p>
        <h3 class="ow-title">You did not write any of this on purpose</h3>
        <p class="ow-setup">
          Every answer you picked was the reasonable one. One of them did not
          survive the outage that came after it. Here is what is left.
        </p>
        ${this.tallyHtml()}
        <div class="ow-foot">
          <button type="button" class="ow-btn" data-go="again">Start over</button>
        </div>
      </div>`;
    this.body.querySelector<HTMLButtonElement>(`[data-go="again"]`)?.addEventListener("click", () => {
      this.cards = [];
      this.i = 0;
      this.stage();
      this.scrollIntoFrame();
    });
  }

  /**
   * global.css pins the site header, so aligning the shell to the top of the
   * viewport would park the rail behind it. Same correction the lesson 2 game
   * makes for the same reason.
   */
  private scrollIntoFrame(): void {
    const head = document.querySelector("body > header");
    const offset = head instanceof HTMLElement ? head.offsetHeight + 12 : 12;
    const top = this.root.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: "smooth" });
  }
}

const mount = (): void => {
  const host = document.querySelector<HTMLElement>("[data-outages]");
  if (!host) return;
  const start = host.querySelector<HTMLButtonElement>(`[data-go="start"]`);
  if (!start) return;
  start.addEventListener("click", () => {
    const stage = host.querySelector<HTMLElement>("[data-ow-stage]");
    if (stage) new Walk(stage);
  });
};

mount();
