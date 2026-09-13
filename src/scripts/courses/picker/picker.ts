// Runner and view for lesson 14's workload picker.
//
// The triage's shape without its read button: one shell built once, only
// [data-pw-body] replaced after that, the stylesheet global and namespaced under
// .pw, and no bare <header> anywhere (global.css pins that as site chrome).
//
// A wrong pick shows its reply and the round stays open. The right one shows its
// reply, closes the round and offers the next. The closing screen is the only
// place the rule behind all six is stated, as two questions.

import { rounds, type Round } from "./rounds";

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", [`"`]: "&quot;" })[c] ?? c);

const prose = (s: string): string => esc(s).replace(/`([^`]+)`/g, `<code class="pw-code">$1</code>`);

class Picker {
  private root: HTMLElement;
  private body: HTMLElement;
  private rail: HTMLElement;
  private i = 0;
  private wrong = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="pw-shell">
        <div class="pw-head">
          <ol class="pw-rail" data-pw-rail aria-label="Workloads"></ol>
        </div>
        <div class="pw-body" data-pw-body></div>
      </div>`;
    const body = root.querySelector<HTMLElement>("[data-pw-body]");
    const rail = root.querySelector<HTMLElement>("[data-pw-rail]");
    if (!body || !rail) throw new Error("picker failed to mount");
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
    this.paintRail();
    this.body.innerHTML = `
      <div class="pw-stage">
        <p class="pw-kicker">Workload ${r.n} of ${rounds.length}</p>
        <p class="pw-setup">${esc(r.setup)}</p>
        <p class="pw-ask">What do you write?</p>
        <ul class="pw-options">
          ${r.choices
            .map((c, k) => `<li><button type="button" class="pw-option" data-k="${k}">${esc(c.object)}</button></li>`)
            .join("")}
        </ul>
        <div data-pw-foot></div>
      </div>`;
    this.body.querySelectorAll<HTMLButtonElement>(".pw-option").forEach((btn) => {
      btn.addEventListener("click", () => this.pick(r, Number(btn.dataset.k), btn));
    });
  }

  private pick(r: Round, k: number, btn: HTMLButtonElement): void {
    const choice = r.choices[k];
    if (!choice || btn.disabled) return;
    btn.disabled = true;
    btn.dataset.picked = choice.right ? "right" : "wrong";
    btn
      .closest("li")
      ?.insertAdjacentHTML(
        "beforeend",
        `<p class="pw-reply" data-tone="${choice.right ? "right" : "wrong"}">${prose(choice.reply)}</p>`,
      );

    if (!choice.right) {
      this.wrong += 1;
      return;
    }

    this.body.querySelectorAll<HTMLButtonElement>(".pw-option:not(:disabled)").forEach((b) => (b.disabled = true));
    const last = this.i === rounds.length - 1;
    this.body.querySelector("[data-pw-foot]")?.insertAdjacentHTML(
      "beforeend",
      `<div class="pw-foot">
         <button type="button" class="pw-btn" data-tone="primary" data-go="next">
           ${last ? "What they had in common" : "Next workload"}
         </button>
       </div>`,
    );
    this.body.querySelector<HTMLButtonElement>(`[data-go="next"]`)?.addEventListener("click", () => {
      this.i += 1;
      this.round();
      this.scrollIntoFrame();
    });
  }

  private summary(): void {
    this.paintRail();
    const tally =
      this.wrong === 0
        ? "You didn't pick a wrong one once."
        : `You tried ${this.wrong} wrong ${this.wrong === 1 ? "one" : "ones"} along the way.`;
    this.body.innerHTML = `
      <div class="pw-stage">
        <p class="pw-kicker">Six workloads later</p>
        <h3 class="pw-title">Two questions</h3>
        <p class="pw-setup">
          Is it supposed to finish? Then it's a Job, or a CronJob if it runs on a
          clock. Does it matter which machine it's on, or which copy it is? Then
          it's a DaemonSet or a StatefulSet. If neither, it's a Deployment, and a
          bare pod is for the rare time you really want nothing bringing it back.
        </p>
        <p class="pw-setup">${esc(tally)}</p>
        <div class="pw-foot">
          <button type="button" class="pw-btn" data-go="again">Start over</button>
        </div>
      </div>`;
    this.body.querySelector<HTMLButtonElement>(`[data-go="again"]`)?.addEventListener("click", () => {
      this.i = 0;
      this.wrong = 0;
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
  const host = document.querySelector<HTMLElement>("[data-picker]");
  const go = host?.querySelector<HTMLButtonElement>(`[data-go="start"]`);
  if (!host || !go) return;
  go.addEventListener("click", () => {
    const stage = host.querySelector<HTMLElement>("[data-pw-stage]");
    if (stage) new Picker(stage);
  });
};

// Per page load: this module is evaluated once for the session, so a lesson
// arrived at by going back would otherwise render its Start button unwired.
document.addEventListener("astro:page-load", mount);
