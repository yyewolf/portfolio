// The rules behind lesson 16's service desk.
//
// Given a round's pods and the reader's Service spec, this works out what the
// cluster would: which pods the EndpointSlice lists, which of those get traffic,
// what port each connection is sent to, whether a request from outside gets in
// at all, and what came back. Then it describes that in findings.
//
// Nothing here knows the intended spec. `run` computes the outcome from the
// mechanism, and a round is cleared when that outcome meets the round's `want`:
// every request answered by the right kind of pod, and every ready one of those
// in the slice. So any spec that routes correctly clears, and every spec gets a
// sentence about what it actually did.
//
// The mechanics, kept faithful:
//
// - A pod is selected when it has every label in the selector. An empty selector
//   gets no managed EndpointSlice at all.
// - A pod that matches but isn't ready is listed in the slice, marked not ready,
//   and gets no traffic.
// - `targetPort` absent is `port`. A name is looked up on each pod.
// - Each connection goes to one ready endpoint, picked at random. Here the pick
//   is a fixed shuffle so a replay is deterministic.
// - A Service with no ready endpoints refuses the connection.
// - From outside: a ClusterIP isn't reachable, a NodePort is only as reachable as
//   the nodes' addresses, and a LoadBalancer gets a public address. Its load
//   balancer uses the NodePort it gets by default, since the round never sets
//   `allocateLoadBalancerNodePorts: false`.

import type { PodSpec, Round, Spec, SvcType } from "./rounds";

export const REQUESTS = 8;
export const NODE_PORT = 31742;
export const LB_IP = "203.0.113.25";

export interface Endpoint {
  pod: PodSpec;
  /** The port the connection is sent to on this pod, once resolved. */
  port: number | null;
}

export interface Request {
  n: number;
  pod?: PodSpec;
  port?: number;
  ok: boolean;
  text: string;
}

export interface Finding {
  tone: "good" | "bad" | "flat";
  text: string;
}

export interface Outcome {
  slice: Endpoint[];
  /** Pods that aren't in the slice, and the label that kept each one out. */
  left: { pod: PodSpec; missing: string[] }[];
  requests: Request[];
  findings: Finding[];
  cleared: boolean;
}

const pair = (s: string): [string, string] => {
  const i = s.indexOf("=");
  return [s.slice(0, i), s.slice(i + 1)];
};

export const missingLabels = (pod: PodSpec, selector: string[]): string[] =>
  selector.filter((s) => {
    const [k, v] = pair(s);
    return pod.labels[k] !== v;
  });

const resolvePort = (pod: PodSpec, spec: Spec, round: Round): number | null => {
  const t = spec.targetPort ?? round.service.port;
  if (typeof t === "number") return t;
  return pod.portName === t ? pod.port : null;
};

/** A fixed shuffle, so eight requests land the same way every time for the same slice. */
const order = (n: number, seed: string): number[] => {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (Math.imul(h, 31) + seed.charCodeAt(i)) >>> 0;
  const out: number[] = [];
  for (let i = 0; i < REQUESTS; i += 1) {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    out.push(i < n ? i : h % n);
  }
  // Spread the first n so every endpoint is visibly used, then shuffle positions.
  for (let i = out.length - 1; i > 0; i -= 1) {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j] as number, out[i] as number];
  }
  return out;
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const code = (s: string): string => `\`${s}\``;

export const manifest = (round: Round, spec: Spec): string[] => {
  const lines = ["apiVersion: v1", "kind: Service", "metadata:", `  name: ${round.service.name}`, "spec:"];
  if (round.types) lines.push(`  type: ${spec.type}`);
  if (spec.selector.length) {
    lines.push("  selector:");
    for (const s of spec.selector) {
      const [k, v] = pair(s);
      lines.push(`    ${k}: ${v}`);
    }
  }
  lines.push("  ports:", `    - port: ${round.service.port}`);
  if (spec.targetPort !== undefined) lines.push(`      targetPort: ${spec.targetPort}`);
  return lines;
};

export const run = (round: Round, spec: Spec): Outcome => {
  const findings: Finding[] = [];
  const sel = spec.selector;
  const matched = sel.length ? round.pods.filter((p) => missingLabels(p, sel).length === 0) : [];
  const slice: Endpoint[] = matched.map((pod) => ({ pod, port: resolvePort(pod, spec, round) }));
  const left = round.pods
    .filter((p) => !matched.includes(p))
    .map((pod) => ({ pod, missing: missingLabels(pod, sel) }));
  const live = slice.filter((e) => e.pod.ready && e.port !== null);
  const wanted = round.pods.filter((p) => p.role === round.want.serve && p.ready);

  /* --- can a request get to the Service at all ---------------------------- */

  let blocked: string | null = null;
  if (round.from === "outside") {
    const t: SvcType = spec.type;
    if (t === "ClusterIP") {
      blocked = `A ClusterIP only exists inside the cluster. Nothing on the internet has a route to ${round.service.clusterIP}, so the provider's requests never arrive.`;
    } else if (t === "NodePort") {
      blocked = `Every node now listens on ${NODE_PORT}, but the nodes' addresses are 192.168.0.x, which are private. The provider has nowhere to send to.`;
    }
  }

  /* --- the requests ------------------------------------------------------- */

  const requests: Request[] = [];
  const picks = order(live.length || 1, `${round.n}:${sel.join(",")}:${String(spec.targetPort)}`);
  for (let i = 0; i < REQUESTS; i += 1) {
    const n = i + 1;
    if (blocked) {
      requests.push({ n, ok: false, text: round.from === "outside" && spec.type === "NodePort" ? "no route to the node" : "timed out" });
      continue;
    }
    const e = live[picks[i] ?? 0];
    if (!e || e.port === null) {
      requests.push({ n, ok: false, text: "connection refused, no endpoints" });
      continue;
    }
    if (e.port !== e.pod.port) {
      requests.push({ n, pod: e.pod, port: e.port, ok: false, text: `connection refused on ${e.port}` });
      continue;
    }
    requests.push({ n, pod: e.pod, port: e.port, ok: e.pod.role === round.want.serve, text: e.pod.answer });
  }

  /* --- findings ----------------------------------------------------------- */

  if (blocked) findings.push({ tone: "bad", text: blocked });
  if (round.from === "outside" && spec.type === "LoadBalancer") {
    findings.push({
      tone: "good",
      text: `The cloud gave the Service a load balancer at ${LB_IP}. It sends traffic to ${NODE_PORT} on the nodes, the NodePort the Service gets by default, and from there it's the same rules as any other connection.`,
    });
  }

  if (!sel.length) {
    findings.push({
      tone: "bad",
      text: `With no selector, Kubernetes doesn't manage an EndpointSlice for this Service at all. That's for pointing a Service at something by hand.${blocked ? "" : " Every connection is refused."}`,
    });
  } else if (!matched.length) {
    findings.push({
      tone: "bad",
      text: `No pod has every label in the selector (${sel.map(code).join(", ")}), so the slice is empty${blocked ? "" : " and every connection is refused"}.`,
    });
  }

  for (const p of matched.filter((x) => !x.ready)) {
    findings.push({
      tone: "flat",
      text: `${code(p.name)} matches but isn't ready yet, so it's in the slice marked not ready and gets nothing.`,
    });
  }

  if (!blocked) {
    const refusedPort = slice.find((e) => e.pod.ready && e.port !== null && e.port !== e.pod.port);
    if (refusedPort) {
      const why =
        spec.targetPort === undefined
          ? `There's no ${code("targetPort")}, so it's the same as ${code("port")}, ${round.service.port}.`
          : `${code(`targetPort: ${String(spec.targetPort)}`)} sends them to ${refusedPort.port}.`;
      findings.push({
        tone: "bad",
        text: `The requests reached pods and were refused. ${why} Nothing in ${code(refusedPort.pod.name)} listens there, it listens on ${refusedPort.pod.port}.`,
      });
    }
    const unnamed = slice.find((e) => e.port === null);
    if (unnamed) {
      findings.push({
        tone: "bad",
        text: `${code(unnamed.pod.name)} has no port called ${code(String(spec.targetPort))}, so there's no port to send to.`,
      });
    }

    // Requests that reached the wrong kind of pod, grouped by what came back.
    const strays = new Map<string, { pods: PodSpec[]; count: number }>();
    for (const r of requests) {
      if (!r.pod || r.pod.role === round.want.serve || r.port !== r.pod.port) continue;
      const s = strays.get(r.pod.answer) ?? { pods: [], count: 0 };
      s.count += 1;
      if (!s.pods.includes(r.pod)) s.pods.push(r.pod);
      strays.set(r.pod.answer, s);
    }
    for (const [answer, { pods, count }] of strays) {
      const first = pods[0];
      if (!first) continue;
      const matchedOn = sel.filter((s) => !missingLabels(first, [s]).length);
      findings.push({
        tone: "bad",
        text: `${plural(count, "request", "requests")} went to ${pods.map((p) => code(p.name)).join(" and ")} and got ${answer}. ${
          pods.length === 1 ? "It's" : "They're"
        } in the slice because ${pods.length === 1 ? "it has" : "they have"} ${matchedOn.map(code).join(" and ")}, and that's all the selector asks for.`,
      });
    }

    if (round.want.all) {
      for (const p of wanted.filter((x) => !matched.includes(x))) {
        const miss = missingLabels(p, sel);
        findings.push({
          tone: "bad",
          text: `${code(p.name)} never gets a request. It's left out of the slice because it doesn't have ${miss.map(code).join(" or ")}.`,
        });
      }
    }
  }

  const cleared =
    requests.every((r) => r.ok) && (!round.want.all || wanted.every((p) => live.some((e) => e.pod === p)));

  if (cleared) {
    const served = new Set(requests.map((r) => r.pod?.name));
    const byAnswer = new Map<string, number>();
    for (const r of requests) byAnswer.set(r.text, (byAnswer.get(r.text) ?? 0) + 1);
    const split =
      byAnswer.size > 1
        ? ` ${[...byAnswer.entries()].map(([a, c]) => `${c} got ${a}`).join(", ")}.`
        : "";
    findings.push({
      tone: "good",
      text: `All ${REQUESTS} requests were answered by ${round.want.serve} pods, spread over ${plural(served.size, "pod", "pods")}.${split}`,
    });
    if (typeof spec.targetPort === "string") {
      findings.push({
        tone: "flat",
        text: `${code(`targetPort: ${spec.targetPort}`)} was looked up on each pod and came out as ${slice[0]?.port ?? "?"}.`,
      });
    }
  }

  // A true sentence next to a failure shouldn't read as praise.
  if (!cleared) for (const f of findings) if (f.tone === "good") f.tone = "flat";

  if (!findings.length) {
    const wrong = requests.filter((r) => !r.ok).length;
    findings.push({ tone: "bad", text: `${plural(wrong, "request", "requests")} didn't get what the brief asked for.` });
  }

  return { slice, left, requests, findings, cleared };
};

/** `kubectl get endpointslices` for the Service, the way it prints. */
export const sliceTable = (round: Round, o: Outcome): string[] => {
  const name = `${round.service.name}-${round.n === 1 ? "x7k2p" : round.n === 2 ? "m4q8d" : round.n === 3 ? "b9t5w" : "h2v6c"}`;
  const ports = [...new Set(o.slice.map((e) => e.port).filter((p): p is number => p !== null))];
  const eps = o.slice.map((e) => e.pod.ip).join(",") || "<unset>";
  const cols = [
    ["NAME", name],
    ["ADDRESSTYPE", "IPv4"],
    ["PORTS", ports.length ? ports.join(",") : "<unset>"],
    ["ENDPOINTS", eps],
  ];
  const widths = cols.map(([h, v]) => Math.max((h ?? "").length, (v ?? "").length) + 3);
  const head = cols.map(([h], i) => (h ?? "").padEnd(widths[i] ?? 0)).join("") + "AGE";
  const row = cols.map(([, v], i) => (v ?? "").padEnd(widths[i] ?? 0)).join("") + "4s";
  return [`$ kubectl get endpointslices -l kubernetes.io/service-name=${round.service.name}`, head, row];
};
