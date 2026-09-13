// Runner and view for lesson 13's side-by-side board.
//
// Free play rather than rounds, like the controller cascade: one shell built once,
// then the controls, the board and the report are repainted after every action.
// Markup is a runtime string, so the stylesheet is global and hand-namespaced
// under .se, and there is no bare <header> anywhere (global.css pins that as site
// chrome).
//
// The board is nodes down and workloads across, which is the layout that makes
// the lesson visible without a sentence: the DaemonSet column always has exactly
// one pod per Ready row, the StatefulSet column keeps its numbers, and the
// Deployment column is just names. Pods removed by the last action stay on the
// board struck through, in the row they were in, so the reader can see where
// something went and where its replacement landed.

import {
  act,
  can,
  idle,
  MAX_NODES,
  MAX_REPLICAS,
  OWNERS,
  start,
  type Action,
  type Owner,
  type Pod,
  type Report,
  type World,
} from "./engine";

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", [`"`]: "&quot;" })[c] ?? c);

const HEADS: Record<Owner, { kind: string; name: string; loop: string }> = {
  web: { kind: "Deployment", name: "web", loop: "Deployment and ReplicaSet" },
  logs: { kind: "DaemonSet", name: "logs", loop: "DaemonSet controller" },
  db: { kind: "StatefulSet", name: "db", loop: "StatefulSet controller" },
};

class SameEvent {
  private root: HTMLElement;
  private world: World = start();
  private report: Report | null = null;
  private last: Action | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="se-shell">
        <div class="se-head">
          <p class="se-title">One cluster, three workloads</p>
          <p class="se-sub">Click a pod to delete it</p>
        </div>
        <div class="se-controls" data-se-controls></div>
        <div class="se-board" data-se-board></div>
        <div class="se-report" data-se-report aria-live="polite"></div>
      </div>`;
    this.paint();
  }

  private do(a: Action): void {
    if (!can(this.world, a)) return;
    const r = act(this.world, a);
    this.world = r.world;
    this.report = r.report;
    this.last = a;
    this.paint();
  }

  private controlsHtml(): string {
    const w = this.world;
    const dis = (a: Action): string => (can(w, a) ? "" : " disabled");
    return `
      <button type="button" class="se-btn" data-go="add"${dis({ kind: "add" })}>Add a node</button>
      <button type="button" class="se-btn" data-go="down"${dis({ kind: "scale", by: -1 })}>Scale down</button>
      <button type="button" class="se-btn" data-go="up"${dis({ kind: "scale", by: 1 })}>Scale up</button>
      <button type="button" class="se-btn" data-go="reset">Start over</button>
      <span class="se-limits">up to ${MAX_NODES} nodes and ${MAX_REPLICAS} replicas</span>`;
  }

  private chip(p: Pod): string {
    const fresh = this.report?.created.includes(p.name) ?? false;
    const back = this.report?.returned.includes(p.name) ?? false;
    const verb = p.status === "Running" ? "delete" : "force delete";
    const tag = p.status !== "Running" ? p.status : back ? "back" : fresh ? "new" : "";
    return `<button type="button" class="se-pod" data-pod="${esc(p.name)}" data-status="${p.status}" data-fresh="${
      fresh ? "yes" : "no"
    }" title="${esc(`${p.name} is ${p.status}. Click to ${verb} it.`)}" aria-label="${esc(`${verb} ${p.name}`)}">
      <span class="se-pod-name">${esc(p.name)}</span>${tag ? `<span class="se-pod-tag">${tag}</span>` : ""}
    </button>`;
  }

  private ghost(p: Pod): string {
    return `<span class="se-pod" data-gone="yes" title="${esc(`${p.name} is gone`)}"><span class="se-pod-name">${esc(
      p.name,
    )}</span><span class="se-pod-tag">gone</span></span>`;
  }

  private cell(owner: Owner, node: string, alive: boolean): string {
    const pods = alive ? this.world.pods.filter((p) => p.owner === owner && p.node === node) : [];
    const gone = (this.report?.gone ?? []).filter((p) => p.owner === owner && p.node === node);
    const inner = [...gone.map((p) => this.ghost(p)), ...pods.sort((a, b) => a.name.localeCompare(b.name)).map((p) => this.chip(p))].join("");
    return `<div class="se-cell" data-label="${HEADS[owner].kind} ${HEADS[owner].name}">${
      inner || `<span class="se-empty">none</span>`
    }</div>`;
  }

  private boardHtml(): string {
    const w = this.world;
    const head = `<div class="se-row se-row-head">
      <span class="se-colhead">Nodes</span>
      ${OWNERS.map(
        (o) => `<span class="se-colhead"><b>${HEADS[o].kind}</b> ${HEADS[o].name}
          <span class="se-spec">${o === "logs" ? "no replicas field" : `replicas: ${w.replicas}`}</span></span>`,
      ).join("")}
    </div>`;

    const rows = w.nodes.map((n) => {
      const acts =
        n.state === "Ready"
          ? `<button type="button" class="se-mini" data-remove="${n.name}"${can(w, { kind: "remove", node: n.name }) ? "" : " disabled"}>Remove</button>
             <button type="button" class="se-mini" data-cut="${n.name}"${can(w, { kind: "cut", node: n.name }) ? "" : " disabled"}>Cut off</button>`
          : `<button type="button" class="se-mini" data-back="${n.name}">Reconnect</button>
             <button type="button" class="se-mini" data-remove="${n.name}"${can(w, { kind: "remove", node: n.name }) ? "" : " disabled"}>Remove</button>`;
      return `<div class="se-row" data-state="${n.state}">
        <div class="se-node">
          <span class="se-node-name">${esc(n.name)}</span>
          <span class="se-node-state">${n.state}</span>
          <span class="se-node-acts">${acts}</span>
        </div>
        ${OWNERS.map((o) => this.cell(o, n.name, true)).join("")}
      </div>`;
    });

    const removed = this.report?.removedNode;
    if (removed) {
      rows.push(`<div class="se-row" data-state="gone">
        <div class="se-node">
          <span class="se-node-name">${esc(removed)}</span>
          <span class="se-node-state">removed</span>
        </div>
        ${OWNERS.map((o) => this.cell(o, removed, false)).join("")}
      </div>`);
    }

    const disks = [...w.volumes]
      .sort()
      .map((v) => {
        const pod = w.pods.find((p) => `data-${p.name}` === v);
        return `<li data-attached="${pod ? "yes" : "no"}"><span class="se-disk-name">${esc(v)}</span><span class="se-disk-to">${
          pod ? `on ${esc(pod.name)}` : "not attached"
        }</span></li>`;
      })
      .join("");

    return `<div class="se-grid">${head}${rows.join("")}</div>
      <div class="se-disks">
        <p class="se-disks-head">StatefulSet disks</p>
        <ul class="se-disklist">${disks}</ul>
      </div>`;
  }

  private reportHtml(): string {
    const r = this.report;
    if (!r) {
      return `<p class="se-hint">Start by deleting one pod from each column. Then add a node, remove one, cut one
        off and reconnect it, and scale down and back up.</p>`;
    }
    const cols = OWNERS.map((o) => {
      const did = r.did[o];
      const body = did.length
        ? `<ul class="se-did-list">${did.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>`
        : "";
      const wait = r.waiting[o] ? `<p class="se-wait">${esc(r.waiting[o] ?? "")}</p>` : "";
      const none = !did.length && !wait ? `<p class="se-idle">${esc(idle(o, this.world, this.last))}</p>` : "";
      return `<div class="se-did" data-owner="${o}">
        <p class="se-did-head">${HEADS[o].loop}</p>${body}${wait}${none}
      </div>`;
    }).join("");
    return `<p class="se-happened">${esc(r.happened)}</p><div class="se-dids">${cols}</div>`;
  }

  private paint(): void {
    const q = <T extends HTMLElement>(sel: string): T | null => this.root.querySelector<T>(sel);

    const controls = q("[data-se-controls]");
    if (controls) {
      controls.innerHTML = this.controlsHtml();
      controls.querySelector(`[data-go="add"]`)?.addEventListener("click", () => this.do({ kind: "add" }));
      controls.querySelector(`[data-go="down"]`)?.addEventListener("click", () => this.do({ kind: "scale", by: -1 }));
      controls.querySelector(`[data-go="up"]`)?.addEventListener("click", () => this.do({ kind: "scale", by: 1 }));
      controls.querySelector(`[data-go="reset"]`)?.addEventListener("click", () => {
        this.world = start();
        this.report = null;
        this.last = null;
        this.paint();
      });
    }

    const board = q("[data-se-board]");
    if (board) {
      board.innerHTML = this.boardHtml();
      board.querySelectorAll<HTMLButtonElement>("[data-pod]").forEach((b) =>
        b.addEventListener("click", () => this.do({ kind: "delete", pod: b.dataset.pod ?? "" })),
      );
      board.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach((b) =>
        b.addEventListener("click", () => this.do({ kind: "remove", node: b.dataset.remove ?? "" })),
      );
      board.querySelectorAll<HTMLButtonElement>("[data-cut]").forEach((b) =>
        b.addEventListener("click", () => this.do({ kind: "cut", node: b.dataset.cut ?? "" })),
      );
      board.querySelectorAll<HTMLButtonElement>("[data-back]").forEach((b) =>
        b.addEventListener("click", () => this.do({ kind: "back", node: b.dataset.back ?? "" })),
      );
    }

    const report = q("[data-se-report]");
    if (report) report.innerHTML = this.reportHtml();
  }
}

const mount = (): void => {
  const host = document.querySelector<HTMLElement>("[data-sameevent]");
  const go = host?.querySelector<HTMLButtonElement>(`[data-go="start"]`);
  if (!host || !go) return;
  go.addEventListener("click", () => {
    const stage = host.querySelector<HTMLElement>("[data-se-stage]");
    if (stage) new SameEvent(stage);
  });
};

// Per page load: this module is evaluated once for the session, so a lesson
// arrived at by going back would otherwise render its Start button unwired.
document.addEventListener("astro:page-load", mount);
