// Runner and view for lesson 4's object assembly.
//
// Same shape as the lesson 1 outage walk: one shell built once, and after that
// only [data-as-body] is replaced, so five screens do not feel like five pages.
// Markup is built at runtime, hence a global hand-namespaced stylesheet and no
// bare <header> anywhere (global.css pins that as site chrome, AGENTS.md
// gotcha 7).
//
// This is the third staged choose-and-explain interactive in the track, and the
// second with an accumulating panel. It is still written separately rather than
// sharing a runner with outages/walk.ts, because the two differ in what they
// accumulate and in what a stage draws: the walk paints a world of machines and
// containers, this paints YAML. If a fourth one turns up, extract the shell,
// the rail and the option list first, and leave the painting behind.

import { rounds, type Round } from "./rounds";

/** A file in the panel, plus the version it replaced so the diff can be drawn. */
interface Written {
  file: string;
  yaml: string;
  note: string;
  /** Set only for the round that rewrote this file. */
  prev?: string;
}

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", [`"`]: "&quot;" })[c] ?? c);

/**
 * Just enough YAML colouring to read as a manifest rather than a paragraph.
 * Shiki is build-time only and these strings are assembled in the browser, so
 * this highlights the two things that matter: keys, and list bullets.
 */
const yamlHtml = (yaml: string, added: Set<number>): string =>
  yaml
    .split("\n")
    .map((line, i) => {
      const painted = esc(line)
        .replace(/^(\s*)([\w.-]+)(:)/, `$1<b class="as-key">$2</b>$3`)
        .replace(/^(\s*)(- )/, `$1<span class="as-dash">$2</span>`);
      return added.has(i) ? `<ins class="as-add">${painted}</ins>` : painted;
    })
    .join("\n");

/**
 * Which lines of `next` are new. Every version of a file here is built from the
 * one before it, so the change is always a pure insertion and two pointers are
 * enough; no general diff is needed and none is attempted.
 */
const addedLines = (next: string, prev?: string): Set<number> => {
  const added = new Set<number>();
  if (prev === undefined) return added;
  const before = prev.split("\n");
  const after = next.split("\n");
  let i = 0;
  for (let j = 0; j < after.length; j += 1) {
    if (i < before.length && before[i] === after[j]) i += 1;
    else added.add(j);
  }
  return added;
};

class Assembly {
  private root: HTMLElement;
  private body: HTMLElement;
  private rail: HTMLElement;
  private written: Written[] = [];
  private i = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="as-shell">
        <div class="as-head">
          <ol class="as-rail" data-as-rail aria-label="Requirements"></ol>
        </div>
        <div class="as-body" data-as-body></div>
      </div>`;
    const body = root.querySelector<HTMLElement>("[data-as-body]");
    const rail = root.querySelector<HTMLElement>("[data-as-rail]");
    if (!body || !rail) throw new Error("assembly failed to mount");
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

  /** The manifests written so far. This is the thing the lesson is about. */
  private writtenHtml(): string {
    if (this.written.length === 0) return "";
    const files = this.written
      .map((m) => {
        const added = addedLines(m.yaml, m.prev);
        return `<li class="as-file"${m.prev ? ` data-updated="yes"` : ""}>
          <p class="as-file-name">
            ${esc(m.file)}${m.prev ? `<span class="as-file-tag">updated</span>` : ""}
          </p>
          <pre class="as-yaml"><code>${yamlHtml(m.yaml, added)}</code></pre>
          <p class="as-file-note">${esc(m.note)}</p>
        </li>`;
      })
      .join("");
    return `<div class="as-written">
      <p class="as-written-head">What you have written down</p>
      <ul class="as-files">${files}</ul>
    </div>`;
  }

  private round(): void {
    const r = rounds[this.i];
    if (!r) return this.summary();
    this.paintRail();
    // Last round's insertions stop being news once the reader moves on.
    for (const w of this.written) delete w.prev;

    this.body.innerHTML = `
      <div class="as-stage">
        <p class="as-kicker">Requirement ${r.n} of ${rounds.length}</p>
        <p class="as-need">${esc(r.need)}</p>
        <p class="as-ask">What do you write down?</p>
        <ul class="as-options">
          ${r.choices
            .map(
              (c, k) =>
                `<li><button type="button" class="as-option" data-k="${k}">${esc(c.text)}</button></li>`,
            )
            .join("")}
        </ul>
        <div data-as-foot></div>
        ${this.writtenHtml()}
      </div>`;

    this.body.querySelectorAll<HTMLButtonElement>(".as-option").forEach((btn) => {
      btn.addEventListener("click", () => this.pick(r, Number(btn.dataset.k), btn));
    });
  }

  /**
   * Wrong answers are spent, not fatal. Two of the three in every round are
   * things that would genuinely work, so the reply says what they cost and the
   * round stays open rather than scoring anybody.
   */
  private pick(r: Round, k: number, btn: HTMLButtonElement): void {
    const choice = r.choices[k];
    if (!choice || btn.disabled) return;

    btn.disabled = true;
    btn.dataset.picked = choice.right ? "right" : "wrong";
    btn
      .closest("li")
      ?.insertAdjacentHTML(
        "beforeend",
        `<p class="as-reply" data-tone="${choice.right ? "right" : "wrong"}">${esc(choice.reply)}</p>`,
      );

    if (!choice.right) return;

    this.body
      .querySelectorAll<HTMLButtonElement>(".as-option:not(:disabled)")
      .forEach((b) => (b.disabled = true));

    this.written.push({ file: r.manifest.file, yaml: r.manifest.yaml, note: r.note });
    if (r.edits) {
      const target = this.written.find((w) => w.file === r.edits?.file);
      // Nothing to grow if the file was never written, which would be a data
      // bug rather than something the reader can cause.
      if (target) {
        target.prev = target.yaml;
        target.yaml = r.edits.yaml;
        target.note = r.edits.note;
      }
    }

    const panel = this.body.querySelector(".as-written");
    if (panel) panel.outerHTML = this.writtenHtml();
    else this.body.querySelector(".as-stage")?.insertAdjacentHTML("beforeend", this.writtenHtml());

    const last = this.i === rounds.length - 1;
    this.body.querySelector("[data-as-foot]")?.insertAdjacentHTML(
      "beforeend",
      `<div class="as-foot">
         <button type="button" class="as-btn" data-tone="primary" data-go="next">
           ${last ? "See what you wrote" : "Next requirement"}
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
    this.body.innerHTML = `
      <div class="as-stage">
        <p class="as-kicker">Four requirements later</p>
        <h3 class="as-title">${this.written.length} records, and nothing was ever started</h3>
        <p class="as-need">
          You described a system out loud and ended up with a set of files. Not one
          of them is a command, and submitting them does not run anything. Each one
          says what should be true, and something that was already running is
          reading them.
        </p>
        ${this.writtenHtml()}
        <div class="as-foot">
          <button type="button" class="as-btn" data-go="again">Start over</button>
        </div>
      </div>`;
    this.body.querySelector<HTMLButtonElement>(`[data-go="again"]`)?.addEventListener("click", () => {
      this.written = [];
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
  const host = document.querySelector<HTMLElement>("[data-assemble]");
  const start = host?.querySelector<HTMLButtonElement>(`[data-go="start"]`);
  if (!host || !start) return;
  start.addEventListener("click", () => {
    const stage = host.querySelector<HTMLElement>("[data-as-stage]");
    if (stage) new Assembly(stage);
  });
};

mount();
