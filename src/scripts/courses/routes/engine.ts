// The Gateway behind lesson 18's route table.
//
// Given a round, the reader's version of the shop's HTTPRoute, and the listener's
// `allowedRoutes`, this decides which routes attach, which rule each request
// matches, which backend it goes to, what path that backend sees, and what it
// answers. Then it writes findings about why.
//
// The matching follows the Gateway API spec:
//
// - A route attaches only if the listener allows its namespace: `Same` is the
//   Gateway's own namespace, `All` is any, and `Selector` is namespaces with a
//   matching label.
// - A `PathPrefix` matches whole path segments: `/api` matches `/api` and
//   `/api/orders`, and doesn't match `/apidocs`. The query string isn't part of
//   the path.
// - Across every matching rule on every attached route: an `Exact` match beats a
//   prefix, a longer prefix beats a shorter one, then the oldest route wins, then
//   namespace/name alphabetically, then the rule's position.
// - Backends are picked by weight. When every weight is 0 the Gateway answers 500.
// - `ReplacePrefixMatch` swaps the matched prefix for the replacement.
//
// Nothing here knows the intended route. A round clears when every request lands
// on the backend it names and gets a real answer, or when the canary's share of a
// sample falls in the round's range.

import type { Allowed, Match, Namespace, Round, Route, Rule } from "./rounds";

export const GATEWAY_NS = "infra";
export const ACCESS_LABEL = "gateway-access";
export const ACCESS_VALUE = "public";

export interface State {
  route: Route;
  allowed: Allowed;
}

export interface Hit {
  path: string;
  want?: string;
  route?: Route;
  rule?: Rule;
  backend?: string;
  sent?: string;
  status: number;
  text: string;
  ok: boolean;
}

export interface Finding {
  tone: "good" | "bad" | "flat";
  text: string;
}

export interface Outcome {
  attached: Route[];
  detached: Route[];
  hits: Hit[];
  /** For a share round: requests per backend out of the sample. */
  counts?: Record<string, number>;
  findings: Finding[];
  cleared: boolean;
}

const code = (s: string): string => `\`${s}\``;

const pathOf = (p: string): string => p.split("?")[0] ?? p;

export const allows = (allowed: Allowed, ns: Namespace | undefined): boolean => {
  if (!ns) return false;
  if (allowed === "All") return true;
  if (allowed === "Same") return ns.name === GATEWAY_NS;
  return ns.labels[ACCESS_LABEL] === ACCESS_VALUE;
};

export const matches = (rule: { match: Match; path: string }, request: string): boolean => {
  const p = pathOf(request);
  if (rule.match === "Exact") return p === rule.path;
  const prefix = rule.path.replace(/\/+$/, "");
  return prefix === "" || p === prefix || p.startsWith(`${prefix}/`);
};

const rewrite = (rule: Rule, request: string): string => {
  if (!rule.rewrite || rule.match !== "PathPrefix") return request;
  const prefix = rule.path.replace(/\/+$/, "");
  const [p = "", q] = request.split("?");
  const rest = p.slice(prefix.length).replace(/^\/+/, "");
  return `/${rest}${q !== undefined ? `?${q}` : ""}`;
};

interface Candidate {
  route: Route;
  rule: Rule;
  index: number;
}

/** Negative when `a` should win. */
const precedence = (a: Candidate, b: Candidate): number => {
  const exact = (c: Candidate): number => (c.rule.match === "Exact" ? 0 : 1);
  if (exact(a) !== exact(b)) return exact(a) - exact(b);
  if (a.rule.path.length !== b.rule.path.length) return b.rule.path.length - a.rule.path.length;
  if (a.route !== b.route) {
    if (a.route.created !== b.route.created) return a.route.created < b.route.created ? -1 : 1;
    const an = `${a.route.ns}/${a.route.name}`;
    const bn = `${b.route.ns}/${b.route.name}`;
    return an < bn ? -1 : 1;
  }
  return a.index - b.index;
};

const candidates = (routes: Route[], request: string): Candidate[] =>
  routes
    .flatMap((route) => route.rules.map((rule, index) => ({ route, rule, index })))
    .filter((c) => matches(c.rule, request))
    .sort(precedence);

/** What each backend says to the path it's handed. */
const serve = (backend: string, sent: string): { status: number; text: string } => {
  const p = pathOf(sent);
  const api = p === "/api" || p.startsWith("/api/");
  switch (backend) {
    case "web":
      return api ? { status: 404, text: "404, web has no page there" } : { status: 200, text: "200, the shop's page" };
    case "api":
      return api ? { status: 200, text: "200, orders from 3.1" } : { status: 404, text: "404 from api" };
    case "api-canary":
      return api ? { status: 200, text: "200, orders from 3.2" } : { status: 404, text: "404 from api-canary" };
    case "search":
      return p === "/" || p === "/suggest"
        ? { status: 200, text: p === "/" ? "200, search results" : "200, suggestions" }
        : { status: 404, text: `404, search has nothing at ${p}` };
    case "demo":
      return { status: 200, text: "200, the old demo page" };
    default:
      return { status: 503, text: "503" };
  }
};

const describe = (c: Candidate): string =>
  `${code(`${c.rule.match} ${c.rule.path}`)} in ${code(`${c.route.ns}/${c.route.name}`)}`;

const whyLost = (winner: Candidate, loser: Candidate): string => {
  if (winner.rule.match !== loser.rule.match) return "an exact match beats a prefix";
  if (winner.rule.path.length !== loser.rule.path.length) return "the longer prefix wins";
  if (winner.route !== loser.route) {
    return winner.route.created !== loser.route.created
      ? `when two routes tie, the older one wins, and ${code(`${winner.route.ns}/${winner.route.name}`)} was created on ${winner.route.created}`
      : "when two routes tie, they're taken in alphabetical order";
  }
  return "the first matching rule in the list wins a tie";
};

/** Picks a backend by weight for request `n` of a run, spread evenly. */
const pick = (rule: Rule, n: number, sample: number): string | null => {
  const live = rule.backends.filter((b) => b.weight > 0);
  const total = live.reduce((s, b) => s + b.weight, 0);
  if (!total) return null;
  // Largest remainder over the sample, then interleave, so 100 requests at 9:1 is exactly 90/10.
  const slot = ((n * 7919) % sample) / sample;
  let acc = 0;
  for (const b of live) {
    acc += b.weight / total;
    if (slot < acc) return b.name;
  }
  return live[live.length - 1]?.name ?? null;
};

export const run = (round: Round, state: State): Outcome => {
  const all = [state.route, ...round.others];
  const ns = (r: Route): Namespace | undefined => round.namespaces.find((n) => n.name === r.ns);
  const attached = all.filter((r) => allows(state.allowed, ns(r)));
  const detached = all.filter((r) => !attached.includes(r));
  const findings: Finding[] = [];

  const send = (path: string, n: number, sample: number, want?: string): Hit => {
    const cs = candidates(attached, path);
    const win = cs[0];
    if (!win) {
      return { path, want, status: 404, text: "404 from the Gateway, no rule matched", ok: false };
    }
    const backend = pick(win.rule, n, sample);
    if (!backend) {
      return { path, want, route: win.route, rule: win.rule, status: 500, text: "500 from the Gateway, every backend has weight 0", ok: false };
    }
    const sent = rewrite(win.rule, path);
    const r = serve(backend, sent);
    return {
      path,
      want,
      route: win.route,
      rule: win.rule,
      backend,
      sent,
      status: r.status,
      text: r.text,
      ok: (want === undefined || backend === want) && r.status < 400,
    };
  };

  /* --- attachment --------------------------------------------------------- */

  const describeAllowed =
    state.allowed === "Same"
      ? `routes from its own namespace, ${code(GATEWAY_NS)}`
      : state.allowed === "All"
        ? "routes from every namespace"
        : `routes from namespaces labelled ${code(`${ACCESS_LABEL}=${ACCESS_VALUE}`)}`;

  if (detached.includes(state.route)) {
    findings.push({
      tone: "bad",
      text: `${code(`${state.route.ns}/${state.route.name}`)} isn't attached. The listener only takes ${describeAllowed}, so the route's status says ${code("Accepted: False")} with reason ${code("NotAllowedByListeners")}.`,
    });
  }
  for (const r of round.others.filter((x) => attached.includes(x))) {
    findings.push({ tone: "flat", text: `${code(`${r.ns}/${r.name}`)} is attached too, since the listener takes ${describeAllowed}.` });
  }

  /* --- requests ----------------------------------------------------------- */

  let hits: Hit[];
  let counts: Record<string, number> | undefined;
  let cleared: boolean;

  if (round.share) {
    const { backend, min, max, sample } = round.share;
    const path = "/api/orders";
    const results = Array.from({ length: sample }, (_, i) => send(path, i, sample));
    counts = {};
    for (const h of results) {
      const key = h.backend ?? String(h.status);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    const got = counts[backend] ?? 0;
    const failed = results.filter((h) => h.status >= 400).length;
    hits = results.slice(0, 10);
    cleared = failed === 0 && got >= min && got <= max;
    const rule = results[0]?.rule;
    if (failed) {
      findings.push({ tone: "bad", text: `${failed} of ${sample} requests failed: ${results.find((h) => h.status >= 400)?.text ?? ""}.` });
    } else if (rule) {
      const weights = rule.backends.map((b) => `${code(b.name)} ${b.weight}`).join(" and ");
      const total = rule.backends.reduce((s, b) => s + b.weight, 0);
      findings.push({
        tone: cleared ? "good" : "bad",
        text: `${code(backend)} got ${got} of ${sample}. The weights are ${weights}, so it gets ${
          rule.backends.find((b) => b.name === backend)?.weight ?? 0
        } out of every ${total}${cleared ? "." : `, and the brief wants roughly one in ten.`}`,
      });
    }
  } else {
    hits = round.requests.map((q, i) => send(q.path, i, round.requests.length, q.want));
    for (const h of hits.filter((x) => !x.ok)) {
      const cs = candidates(attached, h.path);
      const win = cs[0];
      if (!win) {
        findings.push({
          tone: "bad",
          text: attached.length
            ? `${code(h.path)} doesn't match any rule, so the Gateway answers 404 itself.`
            : `${code(h.path)} gets a 404 from the Gateway, because no route is attached to it at all.`,
        });
        continue;
      }
      if (h.backend && h.backend !== h.want) {
        const wanted = cs.find((c) => c.rule.backends.some((b) => b.name === h.want));
        const why = wanted
          ? ` ${describe(wanted)} matches it too, but ${whyLost(win, wanted)}.`
          : state.route.rules.some((r) => r.backends.some((b) => b.name === h.want) && r.match === "Exact")
            ? ` An ${code("Exact")} match only ever matches that one path.`
            : "";
        findings.push({
          tone: "bad",
          text: `${code(h.path)} matched ${describe(win)} and went to ${code(h.backend)}, which answered ${h.text}.${why}`,
        });
        continue;
      }
      if (h.backend && h.status >= 400) {
        findings.push({
          tone: "bad",
          text: `${code(h.path)} reached ${code(h.backend)}, which was handed ${code(h.sent ?? h.path)} and answered ${h.text}.${
            h.sent === h.path && h.rule?.path !== "/" ? ` The path goes through as it was, ${code(h.rule?.path ?? "")} and all.` : ""
          }`,
        });
      }
    }
    cleared = hits.every((h) => h.ok);
    if (cleared) {
      const rewritten = hits.filter((h) => h.sent !== undefined && h.sent !== h.path);
      findings.push({
        tone: "good",
        text: `Every request landed where it should.${
          rewritten.length
            ? ` ${rewritten.map((h) => `${code(h.path)} reached ${code(h.backend ?? "")} as ${code(h.sent ?? "")}`).join(", ")}.`
            : ""
        }`,
      });
    }
  }

  if (!cleared) for (const f of findings) if (f.tone === "good") f.tone = "flat";
  if (!findings.length) findings.push({ tone: "bad", text: "Not every request got what the brief asked for." });

  return { attached, detached, hits, counts, findings, cleared };
};

/* --- manifests ------------------------------------------------------------ */

export const routeYaml = (round: Round, route: Route): string[] => {
  const out = [
    "apiVersion: gateway.networking.k8s.io/v1",
    "kind: HTTPRoute",
    "metadata:",
    `  name: ${route.name}`,
    `  namespace: ${route.ns}`,
    "spec:",
    "  parentRefs:",
    "    - name: public",
    `      namespace: ${GATEWAY_NS}`,
    "  hostnames:",
    `    - ${round.host}`,
    "  rules:",
  ];
  for (const r of route.rules) {
    out.push("    - matches:", "        - path:", `            type: ${r.match}`, `            value: ${r.path}`);
    if (r.rewrite) {
      out.push(
        "      filters:",
        "        - type: URLRewrite",
        "          urlRewrite:",
        "            path:",
        "              type: ReplacePrefixMatch",
        "              replacePrefixMatch: /",
      );
    }
    out.push("      backendRefs:");
    for (const b of r.backends) {
      out.push(`        - name: ${b.name}`, "          port: 80");
      if (r.backends.length > 1) out.push(`          weight: ${b.weight}`);
    }
  }
  return out;
};

export const gatewayYaml = (allowed: Allowed): string[] => {
  const out = [
    "apiVersion: gateway.networking.k8s.io/v1",
    "kind: Gateway",
    "metadata:",
    "  name: public",
    `  namespace: ${GATEWAY_NS}`,
    "spec:",
    "  gatewayClassName: cloud-lb",
    "  listeners:",
    "    - name: http",
    "      protocol: HTTP",
    "      port: 80",
    "      allowedRoutes:",
    "        namespaces:",
    `          from: ${allowed}`,
  ];
  if (allowed === "Selector") {
    out.push("          selector:", "            matchLabels:", `              ${ACCESS_LABEL}: ${ACCESS_VALUE}`);
  }
  return out;
};
