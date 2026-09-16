// Lesson 17's name lookup, as data.
//
// One cluster's worth of DNS, and four things a pod needs to reach. The reader
// types the name they'd put in the config and watches the pod's resolver work
// through its search list, one query at a time.
//
// A round says which address the name has to end up at, and sometimes how many
// queries it may take. It never says what to type. engine.ts resolves whatever
// the reader wrote against the zone below, so every spelling that really works
// clears and every one that doesn't gets told what it resolved to instead.
//
// Each round is decided by one thing:
//
// 1. The short name works from the same namespace. A warm-up, and it puts the
//    search list on screen.
// 2. The short name from another namespace, which here resolves, to the wrong
//    Service. billing has an `api` of its own.
// 3. A headless Service. `db` answers with every pod, and the one to follow is
//    `db-0.db`.
// 4. `ndots`. An outside name with two dots goes through the whole search list
//    before it's tried as written, and a trailing dot skips that.

export interface ServiceRecord {
  ns: string;
  name: string;
  clusterIP?: string;
  /** A headless Service: each pod's hostname and address. */
  pods?: { hostname: string; ip: string }[];
}

export interface FromPod {
  name: string;
  ns: string;
  ip: string;
}

export interface Round {
  n: number;
  title: string;
  brief: string;
  from: FromPod;
  /** What the lookup has to come back with, as a set. */
  want: string[];
  /** When the round is about cost, the most queries a lookup may take. */
  maxQueries?: number;
  /** What's in the box to begin with. */
  first: string;
  note: string;
}

export const services: ServiceRecord[] = [
  { ns: "shop", name: "web", clusterIP: "10.96.44.120" },
  { ns: "shop", name: "api", clusterIP: "10.96.88.3" },
  {
    ns: "shop",
    name: "db",
    pods: [
      { hostname: "db-0", ip: "10.244.1.9" },
      { hostname: "db-1", ip: "10.244.2.14" },
      { hostname: "db-2", ip: "10.244.3.6" },
    ],
  },
  { ns: "billing", name: "api", clusterIP: "10.96.140.21" },
  { ns: "billing", name: "invoices", clusterIP: "10.96.7.200" },
  { ns: "kube-system", name: "kube-dns", clusterIP: "10.96.0.10" },
];

/** What the upstream resolver knows. Everything else outside the cluster is NXDOMAIN. */
export const external: Record<string, string> = {
  "api.stripe.com": "198.51.100.24",
};

export const rounds: Round[] = [
  {
    n: 1,
    title: "The api, from next door",
    brief: "The shop's front end calls the api. Both live in the shop namespace.",
    from: { name: "web-7c9d4f-hwxdr", ns: "shop", ip: "10.244.1.23" },
    want: ["10.96.88.3"],
    first: "",
    note: "The pod's own namespace is first in the search list, so a bare Service name finds the one next to it.",
  },
  {
    n: 2,
    title: "The api, from billing",
    brief:
      "The invoicing service in the billing namespace needs to look orders up in the shop's api. Someone copied the config from the front end.",
    from: { name: "invoices-6f8d9c-t4wkz", ns: "billing", ip: "10.244.3.51" },
    want: ["10.96.88.3"],
    first: "api",
    note: "A short name means this namespace's Service. When another namespace has one with the same name, nothing errors, you just get the wrong one.",
  },
  {
    n: 3,
    title: "The primary",
    brief:
      "db is a StatefulSet running Postgres, and db is also its headless Service. db-1 is a replica and has to stream changes from the primary, which is db-0.",
    from: { name: "db-1", ns: "shop", ip: "10.244.2.14" },
    want: ["10.244.1.9"],
    first: "db",
    note: "Each pod of a StatefulSet gets a name under its headless Service, and that name keeps pointing at the same pod number whatever its address is today.",
  },
  {
    n: 4,
    title: "The payment provider",
    brief:
      "The front end calls api.stripe.com on every checkout, a couple of thousand times a minute, and DNS is showing up in its traces. Get each lookup down to a single query.",
    from: { name: "web-7c9d4f-hwxdr", ns: "shop", ip: "10.244.1.23" },
    want: ["198.51.100.24"],
    maxQueries: 1,
    first: "api.stripe.com",
    note: "Most resolvers also ask for an IPv6 address alongside every one of those, so the search list really costs twice what's shown. A trailing dot, or lowering `ndots` in the pod's `dnsConfig`, is how you skip it.",
  },
];
