// Runner and view for lesson 8's event triage.
//
// One shell built once, and after that only [data-tr-body] is replaced, the
// same idiom as the outage walk and the object assembly. Markup is a runtime
// string, so triage.css is global and hand-namespaced, and there is no bare
// `<header>` anywhere (AGENTS.md gotcha 7).
//
// The mechanic that carries the lesson is the read button. Every round offers
// the object's real state behind one extra command, always available and never
// required, and the closing screen counts the rounds the reader answered
// without pressing it. Nothing punishes them for it in the moment — a right
// answer from a lucky guess still clears the round — because the point is not
// that guessing fails, it is that guessing is what everyone does and that it is
// indistinguishable from knowing until it is not.
//
// Consequently `read` is recorded at the moment the reader answers, not at the
// end of the round: pressing describe *after* choosing tells you nothing about
// how the choice was made.

import { rounds, type Round } from "./rounds";

const esc = (s: string): string =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", [`"`]: "&quot;" })[c] ?? c,
  );

interface Result {
  n: number;
  /** Had the reader read the object before they answered? */
  readFirst: boolean;
  /** Wrong answers spent before the round cleared. */
  wrong: number;
}

class Triage {
  private root: HTMLElement;
  private body: HTMLElement;
  private rail: HTMLElement;
  private i = 0;
  private results: Result[] = [];
  /** Reset per round, and frozen into a Result the moment an answer is given. */
  private read = false;
  private wrong = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="tr-shell">
        <div class="tr-head">
          <ol class="tr-rail" data-tr-rail aria-label="Rounds"></ol>
        </div>
        <div class="tr-body" data-tr-body></div>
      </div>`;
    const body = root.querySelector<HTMLElement>("[data-tr-body]");
    const rail = root.querySelector<HTMLElement>("[data-tr-rail]");
    if (!body || !rail) throw new Error("triage failed to mount");
    this.body = body;
    this.rail = rail;
    this.round();
  }

  private paintRail(): void {
    this.rail.innerHTML = rounds
      .map((r) => {
        const state =
          r.n - 1 < this.i ? "done" : r.n - 1 === this.i ? "current" : "todo";
        return `<li data-state="${state}"><span>${r.n}</span></li>`;
      })
      .join("");
  }

  /** The feed. Deliberately the same shape as `kubectl get events` output. */
  private feedHtml(r: Round): string {
    const lines = r.events
      .map((e) => {
        const age = e.count
          ? `${esc(e.age)} <span class="tr-count">(x${e.count} over ${esc(e.over ?? e.age)})</span>`
          : esc(e.age);
        return `<li class="tr-event" data-type="${e.type}"${e.loud ? ` data-loud="yes"` : ""}>
            <span class="tr-ev-age">${age}</span>
            <span class="tr-ev-type">${e.type}</span>
            <span class="tr-ev-reason">${esc(e.reason)}</span>
            <span class="tr-ev-object">${esc(e.object)}</span>
            <span class="tr-ev-message">${esc(e.message)}</span>
          </li>`;
      })
      .join("");
    return `<div class="tr-feed">
        <p class="tr-cmd"><span>$</span> kubectl get events --sort-by=.lastTimestamp</p>
        <ul class="tr-events">${lines}</ul>
      </div>`;
  }

  private truthHtml(r: Round): string {
    return `<div class="tr-truth">
        <p class="tr-cmd"><span>$</span> ${esc(r.truth.command)}</p>
        <pre class="tr-out"><code>${esc(r.truth.body)}</code></pre>
        <p class="tr-reading">${esc(r.truth.reading)}</p>
      </div>`;
  }

  private round(): void {
    const r = rounds[this.i];
    if (!r) return this.summary();
    this.read = false;
    this.wrong = 0;
    this.paintRail();

    this.body.innerHTML = `
      <div class="tr-stage">
        <p class="tr-kicker">Round ${r.n} of ${rounds.length}</p>
        <p class="tr-setup">${esc(r.setup)}</p>
        ${this.feedHtml(r)}
        <div class="tr-readrow">
          <button type="button" class="tr-btn" data-go="read">${esc(r.truth.command)}</button>
          <span class="tr-readnote">You can always look. It costs a command.</span>
        </div>
        <div data-tr-truth></div>
        <p class="tr-ask">${esc(r.ask)}</p>
        <ul class="tr-options">
          ${r.choices
            .map(
              (c, k) =>
                `<li><button type="button" class="tr-option" data-k="${k}">${esc(c.text)}</button></li>`,
            )
            .join("")}
        </ul>
        <div data-tr-foot></div>
      </div>`;

    const readBtn = this.body.querySelector<HTMLButtonElement>(`[data-go="read"]`);
    readBtn?.addEventListener("click", () => {
      this.read = true;
      readBtn.disabled = true;
      const slot = this.body.querySelector<HTMLElement>("[data-tr-truth]");
      if (slot) slot.innerHTML = this.truthHtml(r);
    });

    this.body.querySelectorAll<HTMLButtonElement>(".tr-option").forEach((btn) => {
      btn.addEventListener("click", () => this.pick(r, Number(btn.dataset.k), btn));
    });
  }

  /**
   * Wrong answers are spent, not fatal. Two of the three in every round are
   * things a competent person would try, so the reply says what they would
   * actually cause and the round stays open.
   */
  private pick(r: Round, k: number, btn: HTMLButtonElement): void {
    const choice = r.choices[k];
    if (!choice || btn.disabled) return;

    // Recorded on the first answer, before the round can teach them anything.
    if (this.wrong === 0 && !this.results.some((x) => x.n === r.n)) {
      this.results.push({ n: r.n, readFirst: this.read, wrong: 0 });
    }
    const result = this.results.find((x) => x.n === r.n);

    btn.disabled = true;
    btn.dataset.picked = choice.right ? "right" : "wrong";
    btn
      .closest("li")
      ?.insertAdjacentHTML(
        "beforeend",
        `<p class="tr-reply" data-tone="${choice.right ? "right" : "wrong"}">${esc(choice.reply)}</p>`,
      );

    if (!choice.right) {
      this.wrong += 1;
      if (result) result.wrong = this.wrong;
      return;
    }

    this.body
      .querySelectorAll<HTMLButtonElement>(".tr-option:not(:disabled)")
      .forEach((b) => (b.disabled = true));

    // The truth is shown whether or not they asked for it, because the round is
    // over and the answer is worthless without it.
    const slot = this.body.querySelector<HTMLElement>("[data-tr-truth]");
    if (slot && slot.innerHTML === "") slot.innerHTML = this.truthHtml(r);
    const readBtn = this.body.querySelector<HTMLButtonElement>(`[data-go="read"]`);
    if (readBtn) readBtn.disabled = true;

    const last = this.i === rounds.length - 1;
    this.body.querySelector("[data-tr-foot]")?.insertAdjacentHTML(
      "beforeend",
      `<div class="tr-lesson">${esc(r.lesson)}</div>
       <div class="tr-foot">
         <button type="button" class="tr-btn" data-tone="primary" data-go="next">
           ${last ? "See how you read it" : "Next round"}
         </button>
       </div>`,
    );
    this.body
      .querySelector<HTMLButtonElement>(`[data-go="next"]`)
      ?.addEventListener("click", () => {
        this.i += 1;
        this.round();
        this.scrollIntoFrame();
      });
  }

  private summary(): void {
    this.paintRail();
    const blind = this.results.filter((r) => !r.readFirst);
    const wrongTotal = this.results.reduce((n, r) => n + r.wrong, 0);

    // Both numbers come out of what was recorded at answer time, never out of
    // what a choice was supposed to mean.
    const headline =
      blind.length === 0
        ? "You read the object every time"
        : blind.length === 1
          ? "Once, you answered without looking"
          : `${blind.length} times, you answered without looking`;

    const detail =
      blind.length === 0
        ? "Which is the habit the whole lesson is arguing for, and it is a slower one than it feels like it should be. The feed told you where to look. It never once told you what was true."
        : `Rounds ${blind.map((r) => r.n).join(", ")}. Not a scolding: the feed was sorted by time, the top line was relevant, and reacting to it is what the interface invites. It is also the thing no controller in the cluster is permitted to do, for exactly the reasons those rounds showed you.`;

    this.body.innerHTML = `
      <div class="tr-stage">
        <p class="tr-kicker">Five rounds later</p>
        <h3 class="tr-title">${esc(headline)}</h3>
        <p class="tr-setup">${esc(detail)}</p>
        <ul class="tr-tally">
          <li><b>${this.results.length}</b> rounds</li>
          <li><b>${this.results.length - blind.length}</b> answered after reading the object</li>
          <li><b>${wrongTotal}</b> wrong answers along the way</li>
        </ul>
        <p class="tr-close">
          Every round had the answer available before you chose, behind one
          command. That is the position every controller in the cluster is in,
          permanently, and it is why none of them listens to any of this.
        </p>
        <div class="tr-foot">
          <button type="button" class="tr-btn" data-go="again">Start over</button>
        </div>
      </div>`;

    this.body
      .querySelector<HTMLButtonElement>(`[data-go="again"]`)
      ?.addEventListener("click", () => {
        this.results = [];
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
  const host = document.querySelector<HTMLElement>("[data-triage]");
  const start = host?.querySelector<HTMLButtonElement>(`[data-go="start"]`);
  if (!host || !start) return;
  start.addEventListener("click", () => {
    const stage = host.querySelector<HTMLElement>("[data-tr-stage]");
    if (stage) new Triage(stage);
  });
};

// Per page load: the module is evaluated once for the session, so a lesson
// reached by going back would otherwise render its start button unwired.
document.addEventListener("astro:page-load", mount);
