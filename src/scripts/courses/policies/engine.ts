// The rules behind lesson 19's policy puzzle.
//
// Given a round and the reader's setup (entries on, directions isolated), this
// evaluates every connection the round checks, the way the NetworkPolicy spec
// says to:
//
// - A pod is isolated for ingress if any policy that selects it isolates
//   ingress, and the same for egress. A pod nothing isolates allows everything in
//   that direction.
// - An isolated pod allows a connection when at least one rule, from any policy
//   that selects it, allows it. Rules only ever add.
// - A rule allows a peer when any item under `from`/`to` matches it, and the port
//   when any of its ports matches, or when it lists none.
// - An item with both `namespaceSelector` and `podSelector` needs both to match.
//   A `podSelector` on its own means pods in the policy's namespace.
//   `namespaceSelector: {}` is every namespace. `ipBlock` is matched against
//   addresses outside the cluster only, since what it does with pod addresses
//   depends on the plugin.
// - A connection needs the sender's egress and the receiver's ingress to allow
//   it. Replies on an allowed connection are always let through.
// - An app connecting by name has to look the name up first, which is a
//   connection to CoreDNS on 53, and it has to be allowed like any other.
//
// Nothing here knows the intended setup. A round clears when every check comes
// out the way the round wants.

import {
  endpoints,
  NS,
  nsLabels,
  type Check,
  type Direction,
  type Endpoint,
  type Entry,
  type Labels,
  type Peer,
  type PolicyDef,
  type Round,
  type Setup,
} from "./rounds";

export interface Result {
  check: Check;
  allowed: boolean;
  /** Set when the name lookup is what failed. */
  dnsFailed: boolean;
  ok: boolean;
  /** One sentence on why it came out this way. */
  why: string;
}

export interface Finding {
  tone: "good" | "bad" | "flat";
  text: string;
}

export interface Outcome {
  results: Result[];
  findings: Finding[];
  cleared: boolean;
}

const code = (s: string): string => `\`${s}\``;

const ep = (id: string): Endpoint => {
  const e = endpoints.find((x) => x.id === id);
  if (!e) throw new Error(`no endpoint ${id}`);
  return e;
};

const hasLabels = (have: Labels | undefined, want: Labels): boolean =>
  Object.entries(want).every(([k, v]) => have?.[k] === v);

const ipIn = (ip: string, cidr: string): boolean => {
  const [base = "", bits = "32"] = cidr.split("/");
  const n = (s: string): number => s.split(".").reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
  const b = Number(bits);
  const mask = b === 0 ? 0 : (~0 << (32 - b)) >>> 0;
  return ((n(ip) & mask) >>> 0) === ((n(base) & mask) >>> 0);
};

const peerMatches = (peer: Peer, e: Endpoint): boolean => {
  if (peer.cidr) return !!e.ip && ipIn(e.ip, peer.cidr);
  if (!e.ns) return false;
  const nsOk =
    peer.namespaces === undefined
      ? e.ns === NS && peer.pods !== undefined
      : peer.namespaces === "all" || hasLabels(nsLabels(e.ns), peer.namespaces);
  const podsOk = peer.pods === undefined || hasLabels(e.labels, peer.pods);
  return nsOk && podsOk;
};

const entryAllows = (entry: Entry, other: Endpoint, port: number, protocol: string): boolean =>
  (entry.peers.length === 0 || entry.peers.some((p) => peerMatches(p, other))) &&
  (entry.ports.length === 0 || entry.ports.some((p) => p.port === port && p.protocol === protocol));

const selecting = (round: Round, e: Endpoint): PolicyDef[] =>
  e.ns === NS ? round.policies.filter((p) => hasLabels(e.labels, p.selects)) : [];

interface Side {
  allowed: boolean;
  isolatedBy: PolicyDef[];
  allowedBy?: Entry;
}

const side = (round: Round, setup: Setup, self: Endpoint, dir: Direction, other: Endpoint, port: number, protocol: string): Side => {
  const pols = selecting(round, self);
  const isolatedBy = pols.filter((p) => setup.isolated.includes(`${p.name}:${dir}`));
  if (!isolatedBy.length) return { allowed: true, isolatedBy };
  const entries = round.entries.filter(
    (x) => setup.on.includes(x.id) && x.dir === dir && isolatedBy.some((p) => p.name === x.policy),
  );
  const by = entries.find((x) => entryAllows(x, other, port, protocol));
  return { allowed: !!by, isolatedBy, allowedBy: by };
};

/** Pods are named like code, places on the internet like places. */
const label = (e: Endpoint): string => (e.ip ? e.name : code(e.name));

const connect = (round: Round, setup: Setup, from: Endpoint, to: Endpoint, port: number, protocol: string) => {
  const out = side(round, setup, from, "egress", to, port, protocol);
  const inn = to.ip ? { allowed: true, isolatedBy: [] as PolicyDef[] } : side(round, setup, to, "ingress", from, port, protocol);
  return { out, inn, allowed: out.allowed && inn.allowed };
};

export const evaluate = (round: Round, setup: Setup): Outcome => {
  const results: Result[] = round.checks.map((check) => {
    const from = ep(check.from);
    const to = ep(check.to);
    const target = `${label(to)} on ${check.port}`;

    if (check.byName) {
      const dns = connect(round, setup, from, ep("coredns"), 53, "UDP");
      if (!dns.allowed) {
        const allowed = false;
        return {
          check,
          allowed,
          dnsFailed: true,
          ok: allowed === check.want,
          why: `${label(from)} can't even look up ${code(check.byName)}. Its egress is isolated and nothing allows port 53 to CoreDNS, so the lookup times out before a connection is tried.`,
        };
      }
    }

    const c = connect(round, setup, from, to, check.port, check.protocol);
    let why: string;
    if (!c.out.allowed) {
      why = `${label(from)}'s egress is isolated by ${code(c.out.isolatedBy.map((p) => p.name).join(", "))}, and no rule there allows ${target}.`;
    } else if (!c.inn.allowed) {
      why = `${label(to)}'s ingress is isolated by ${code(c.inn.isolatedBy.map((p) => p.name).join(", "))}, and no rule there allows ${label(from)}${
        from.ns && from.ns !== NS ? ` from ${code(from.ns)}` : ""
      } on ${check.port}.`;
    } else {
      const reasons: string[] = [];
      if (c.out.allowedBy) reasons.push(`the egress rule ${code(c.out.allowedBy.label)}`);
      if ("allowedBy" in c.inn && c.inn.allowedBy) reasons.push(`the ingress rule ${code(c.inn.allowedBy.label)}`);
      why = reasons.length
        ? `Allowed by ${reasons.join(" and ")}.`
        : to.ip
          ? `Nothing isolates ${label(from)}'s egress, so it's allowed.`
          : `Nothing isolates ${label(from)}'s egress or ${label(to)}'s ingress, so it's allowed.`;
    }
    return { check, allowed: c.allowed, dnsFailed: false, ok: c.allowed === check.want, why };
  });

  const findings: Finding[] = [];
  for (const r of results.filter((x) => !x.ok)) {
    const from = ep(r.check.from);
    const to = ep(r.check.to);
    const verdict = r.allowed ? "gets through and shouldn't" : "is blocked and shouldn't be";
    let extra = "";
    if (r.allowed) {
      const inn = connect(round, setup, from, to, r.check.port, r.check.protocol).inn;
      const entry = "allowedBy" in inn ? inn.allowedBy : undefined;
      if (entry && entry.peers.length > 1) {
        const hit = entry.peers.find((p) => peerMatches(p, from));
        extra =
          hit?.namespaces && !hit.pods
            ? ` That rule is two entries, and the first one, the whole ${code(from.ns ?? "")} namespace, matches ${label(from)} on its own.`
            : "";
      } else if (entry?.peers.some((p) => p.namespaces && !p.pods)) {
        extra = ` That rule lets in every pod in ${entry.peers.some((p) => p.namespaces === "all") ? "every namespace" : code(from.ns ?? "")}, ${label(from)} included.`;
      }
    }
    findings.push({
      tone: "bad",
      text: `${label(from)} to ${label(to)} on ${r.check.port} ${verdict}. ${r.why}${extra}`,
    });
  }

  const cleared = results.every((r) => r.ok);
  if (cleared) {
    findings.push({ tone: "good", text: `All ${results.length} connections do what the brief says.` });
    const replies = results.find((r) => {
      const to = ep(r.check.to);
      return r.allowed && selecting(round, to).some((p) => setup.isolated.includes(`${p.name}:egress`));
    });
    if (replies) {
      findings.push({
        tone: "flat",
        text: `${label(ep(replies.check.to))} can't open anything, and its replies to ${label(ep(replies.check.from))} still get back, because the connection was allowed when it was opened.`,
      });
    }
  }
  return { results, findings, cleared };
};

/* --- manifests ------------------------------------------------------------ */

const labelsYaml = (labels: Labels, indent: string): string[] => [
  `${indent}matchLabels:`,
  ...Object.entries(labels).map(([k, v]) => `${indent}  ${k}: ${v}`),
];

const peerYaml = (p: Peer): string[] => {
  if (p.cidr) return ["- ipBlock:", `    cidr: ${p.cidr}`];
  const out: string[] = [];
  if (p.namespaces !== undefined) {
    out.push(...(p.namespaces === "all" ? ["namespaceSelector: {}"] : ["namespaceSelector:", ...labelsYaml(p.namespaces, "  ")]));
  }
  if (p.pods) out.push("podSelector:", ...labelsYaml(p.pods, "  "));
  return out.map((l, i) => (i === 0 ? `- ${l}` : `  ${l}`));
};

export const policyYaml = (round: Round, policy: PolicyDef, setup: Setup): string[] => {
  const types = (["ingress", "egress"] as Direction[]).filter((d) => setup.isolated.includes(`${policy.name}:${d}`));
  const out = [
    "apiVersion: networking.k8s.io/v1",
    "kind: NetworkPolicy",
    "metadata:",
    `  name: ${policy.name}`,
    `  namespace: ${NS}`,
    "spec:",
    "  podSelector:",
    ...labelsYaml(policy.selects, "    "),
  ];
  if (!types.length) return [`# No ${policy.name} policy yet, so nothing isolates pods app=${policy.selects.app ?? ""}.`];
  out.push("  policyTypes:", ...types.map((d) => `    - ${d === "ingress" ? "Ingress" : "Egress"}`));
  for (const dir of types) {
    const entries = round.entries.filter((e) => e.policy === policy.name && e.dir === dir && setup.on.includes(e.id));
    if (!entries.length) continue;
    out.push(`  ${dir}:`);
    for (const e of entries) {
      const key = dir === "ingress" ? "from" : "to";
      out.push(`    - ${key}:`, ...e.peers.flatMap(peerYaml).map((l) => `        ${l}`));
      if (e.ports.length) {
        out.push("      ports:", ...e.ports.flatMap((p) => [`        - protocol: ${p.protocol}`, `          port: ${p.port}`]));
      }
    }
  }
  return out;
};
