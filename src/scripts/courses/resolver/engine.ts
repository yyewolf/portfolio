// The resolver behind lesson 17's name lookup.
//
// This is what a pod's resolver and the cluster's DNS do with a name, faithfully
// enough that a reader who types something odd gets the real answer:
//
// - The pod's /etc/resolv.conf has three search domains, starting with its own
//   namespace, and `ndots:5`.
// - A name ending in a dot is tried exactly as written, once.
// - A name with fewer than five dots goes through the search list first and is
//   tried as written last. A name with five or more is tried as written first.
// - The first query that gets an answer ends the lookup.
// - Inside `cluster.local`, `<service>.<namespace>.svc.cluster.local` answers with
//   the ClusterIP, or with every pod's address for a headless Service, and
//   `<hostname>.<service>.<namespace>.svc.cluster.local` answers for one pod of a
//   headless Service. Everything else under `cluster.local` is NXDOMAIN.
// - Anything outside `cluster.local` is forwarded upstream.
//
// No round's intended spelling is written down anywhere. `lookup` resolves and
// `judge` compares the result against what the round wants.

import { external, services, type FromPod, type Round } from "./rounds";

export const NDOTS = 5;
export const DOMAIN = "cluster.local";

export interface Query {
  name: string;
  answer: string[] | null;
  /** Who answered: the cluster's own records, or the upstream resolver. */
  by: "cluster" | "upstream";
}

export interface Lookup {
  typed: string;
  error?: string;
  queries: Query[];
  answer: string[] | null;
}

export interface Finding {
  tone: "good" | "bad" | "flat";
  text: string;
}

export interface Verdict {
  findings: Finding[];
  cleared: boolean;
}

export const searchList = (pod: FromPod): string[] => [`${pod.ns}.svc.${DOMAIN}`, `svc.${DOMAIN}`, DOMAIN];

export const resolvConf = (pod: FromPod): string[] => [
  "nameserver 10.96.0.10",
  `search ${searchList(pod).join(" ")}`,
  `options ndots:${NDOTS}`,
];

/** One query against the cluster's records, or upstream. `fqdn` has no trailing dot. */
const answer = (fqdn: string): Query => {
  const suffix = `.svc.${DOMAIN}`;
  if (fqdn === DOMAIN || fqdn.endsWith(`.${DOMAIN}`)) {
    if (!fqdn.endsWith(suffix)) return { name: fqdn, answer: null, by: "cluster" };
    const parts = fqdn.slice(0, -suffix.length).split(".");
    if (parts.length === 2) {
      const [name, ns] = parts;
      const s = services.find((x) => x.name === name && x.ns === ns);
      if (!s) return { name: fqdn, answer: null, by: "cluster" };
      return { name: fqdn, answer: s.clusterIP ? [s.clusterIP] : (s.pods ?? []).map((p) => p.ip), by: "cluster" };
    }
    if (parts.length === 3) {
      const [host, name, ns] = parts;
      const pod = services.find((x) => x.name === name && x.ns === ns)?.pods?.find((p) => p.hostname === host);
      return { name: fqdn, answer: pod ? [pod.ip] : null, by: "cluster" };
    }
    return { name: fqdn, answer: null, by: "cluster" };
  }
  const ip = external[fqdn];
  return { name: fqdn, answer: ip ? [ip] : null, by: "upstream" };
};

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export const lookup = (pod: FromPod, raw: string): Lookup => {
  const typed = raw.trim().toLowerCase();
  const bare = typed.replace(/^[a-z]+:\/\//, "").replace(/[:/].*$/, "");
  if (!typed) return { typed, error: "Type a name first.", queries: [], answer: null };
  if (bare !== typed) {
    return { typed, error: `Just the name. The resolver only ever sees ${bare || "the part before the port or path"}.`, queries: [], answer: null };
  }
  const absolute = typed.endsWith(".");
  const name = absolute ? typed.slice(0, -1) : typed;
  if (!name.split(".").every((l) => LABEL.test(l))) {
    return { typed, error: "That isn't a name DNS can look up. Letters, digits, dashes, and dots between them.", queries: [], answer: null };
  }

  const dots = name.split(".").length - 1;
  const searched = searchList(pod).map((s) => `${name}.${s}`);
  const order = absolute ? [name] : dots >= NDOTS ? [name, ...searched] : [...searched, name];

  const queries: Query[] = [];
  for (const q of order) {
    const r = answer(q);
    queries.push(r);
    if (r.answer) return { typed, queries, answer: r.answer };
  }
  return { typed, queries, answer: null };
};

/** Name an address the way a person on the team would. */
const whose = (ip: string): string => {
  for (const s of services) {
    if (s.clusterIP === ip) return `\`${s.name}\` in namespace \`${s.ns}\``;
    const p = s.pods?.find((x) => x.ip === ip);
    if (p) return `pod \`${p.hostname}\``;
  }
  const ext = Object.entries(external).find(([, v]) => v === ip);
  return ext ? `\`${ext[0]}\`` : ip;
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export const judge = (round: Round, l: Lookup): Verdict => {
  if (l.error) return { findings: [{ tone: "flat", text: l.error }], cleared: false };
  const findings: Finding[] = [];
  const n = l.queries.length;
  const misses = l.queries.filter((q) => !q.answer).length;
  const got = l.answer;

  if (!got) {
    findings.push({
      tone: "bad",
      text: `NXDOMAIN. All ${plural(n, "name", "names")} tried came back with nothing, so the app gets an error saying the host doesn't exist.`,
    });
    return { findings, cleared: false };
  }

  const same = got.length === round.want.length && got.every((ip) => round.want.includes(ip));

  if (!same) {
    if (got.length > 1) {
      const self = got.includes(round.from.ip);
      findings.push({
        tone: "bad",
        text: `That's a headless Service, so the answer is every pod's address: ${got.map(whose).join(", ")}. Most clients just take the first one, which could be any of them${
          self ? `, including ${round.from.name} itself` : ""
        }.`,
      });
    } else {
      const ip = got[0] ?? "";
      const hit = l.queries[l.queries.length - 1];
      const short = l.typed.replace(/\.$/, "");
      const shadowed =
        hit?.name === `${short}.${round.from.ns}.svc.${DOMAIN}` &&
        services.some((x) => x.name === short && x.ns !== round.from.ns);
      findings.push({
        tone: "bad",
        text: `It resolved to ${ip}, which is ${whose(ip)}. ${
          shadowed
            ? `The pod's own namespace is first in its search list, and it has one called \`${short}\` too, so that's the one it found.`
            : "A real answer, just for something else."
        }`,
      });
    }
  }

  if (same && round.maxQueries !== undefined && n > round.maxQueries) {
    const dots = l.typed.replace(/\.$/, "").split(".").length - 1;
    findings.push({
      tone: "bad",
      text: `Right address, after ${plural(n, "query", "queries")}. The name has ${plural(dots, "dot", "dots")}, fewer than ${NDOTS}, so the search list went first and ${plural(
        misses,
        "query",
        "queries",
      )} came back NXDOMAIN before the name was tried as written. That happens on every single lookup.`,
    });
  }

  const cleared = same && (round.maxQueries === undefined || n <= round.maxQueries);
  if (cleared) {
    findings.push({
      tone: "good",
      text: `${got.length === 1 ? got[0] : got.join(", ")}, which is ${got.map(whose).join(", ")}, in ${plural(n, "query", "queries")}${
        misses ? `, ${misses} of them NXDOMAIN on the way` : ""
      }.`,
    });
  }
  return { findings, cleared };
};
