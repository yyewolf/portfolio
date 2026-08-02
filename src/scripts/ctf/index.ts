// Bootstrap for the /ctf showcase. Imports the extracted data, renders the
// static graphs, and wires up the three animations. Re-inits on Astro view
// transitions (astro:page-load) and re-renders on theme toggle / resize.
import {
  renderNumbers, renderActivity, renderScatter, renderCategories,
  renderScoreTail, renderFunnel, renderInfra,
} from "./charts";
import { setupRace, setupGrid, setupTicker, setupNetwork, type Viz } from "./animations";
import { onThemeChange, onResize, whenVisible, type Cleanup } from "./util";

import summaryData from "@data/ctf/summary.json";
import timelineData from "@data/ctf/timeline.json";
import challengesData from "@data/ctf/challenges.json";
import categoriesData from "@data/ctf/categories.json";
import teamsData from "@data/ctf/teams.json";
import infraData from "@data/ctf/infra.json";
import firstbloodsData from "@data/ctf/firstbloods.json";
import raceData from "@data/ctf/race.json";
import instancesData from "@data/ctf/instances.json";
import networkData from "@data/ctf/network.json";

/* eslint-disable @typescript-eslint/no-explicit-any */
const summary = summaryData as any;
const timeline = timelineData as any;
const challenges = challengesData as any;
const categories = categoriesData as any;
const teams = teamsData as any;
const infra = infraData as any;
const firstbloods = firstbloodsData as any;
const race = raceData as any;
const instances = instancesData as any;
const network = networkData as any;

let teardown: Cleanup[] = [];

function q(id: string): HTMLElement | null { return document.getElementById(id); }

function boot(): void {
  const root = document.querySelector(".ctf");
  if (!root) return;
  // clean any previous instance (view-transition re-entry)
  teardown.forEach((t) => t());
  teardown = [];

  const vizs: Viz[] = [];

  // ---- static graphs (re-rendered on theme/resize) ----
  const statics: (() => void)[] = [];
  const bind = (id: string, fn: (host: HTMLElement) => void) => {
    const host = q(id);
    if (host) { const run = () => fn(host); statics.push(run); run(); }
  };
  bind("ctf-numbers", (h) => renderNumbers(h, summary));
  bind("ctf-activity", (h) => renderActivity(h, timeline, summary));
  bind("ctf-scatter", (h) => renderScatter(h, challenges));
  bind("ctf-categories", (h) => renderCategories(h, categories));
  bind("ctf-scoretail", (h) => renderScoreTail(h, teams));
  bind("ctf-funnel", (h) => renderFunnel(h, summary));
  bind("ctf-infra", (h) => renderInfra(h, infra, summary));

  // ---- animations (lazy: build when they scroll near view) ----
  const lazy = (id: string, make: (host: HTMLElement) => Viz) => {
    const host = q(id);
    if (!host) return;
    teardown.push(whenVisible(host, () => { const v = make(host); vizs.push(v); }));
  };
  lazy("ctf-race", (h) => setupRace(h, race));
  lazy("ctf-grid", (h) => setupGrid(h, instances, challenges));
  lazy("ctf-network", (h) => setupNetwork(h, network));
  lazy("ctf-ticker", (h) => setupTicker(h, firstbloods, summary.start));

  const rerender = () => { statics.forEach((s) => s()); vizs.forEach((v) => v.redraw()); };
  teardown.push(onThemeChange(rerender));
  teardown.push(onResize(rerender));
  teardown.push(() => vizs.forEach((v) => v.destroy()));
}

document.addEventListener("astro:page-load", boot);
