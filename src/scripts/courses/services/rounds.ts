// Lesson 16's service desk, as data.
//
// Four Services somebody needs working, each starting from the spec somebody
// would write first. The reader edits the selector, the target port and, in the
// last one, the type, then sends eight requests and reads where they went.
//
// A round says what has to be true afterwards (`want`), never which edit gets
// there. engine.ts works out the EndpointSlice and the requests from the spec
// and the pods, so two different specs that route the same way both clear.
//
// Each round is decided by one thing:
//
// 1. A selector that's too broad. Everything in the shop is `app: shop`, so the
//    front end's Service picks up the api pods too.
// 2. `targetPort`. Left out, it's the same as `port`, and nothing listens on 80.
// 3. A selector that's too narrow. The canary is missing `track: stable`, so it
//    never gets a request, and the fix is taking a label away.
// 4. The type. A payment provider on the internet has to reach it, and the
//    nodes only have private addresses.

export type SvcType = "ClusterIP" | "NodePort" | "LoadBalancer";

export interface PodSpec {
  name: string;
  ip: string;
  labels: Record<string, string>;
  ready: boolean;
  /** The container port, and its name if it has one. */
  port: number;
  portName?: string;
  /** What this pod is, in the brief's words. `want.serve` is matched against it. */
  role: string;
  /** What it sends back when a request reaches its port. */
  answer: string;
}

export interface Spec {
  /** "key=value" pairs. Order is only for display. */
  selector: string[];
  /** Absent means the same as `port`. */
  targetPort?: number | string;
  type: SvcType;
}

export interface Round {
  n: number;
  title: string;
  brief: string;
  service: { name: string; clusterIP: string; port: number };
  pods: PodSpec[];
  start: Spec;
  /** Labels the reader can put in the selector. */
  labels: string[];
  /** Choices for targetPort. `null` is leaving it out. */
  targetPorts: (number | string | null)[];
  /** Only offered when the round is about the type. */
  types?: SvcType[];
  /** Where the requests come from. */
  from: "inside" | "outside";
  want: {
    /** Every request must be answered by a pod with this role. */
    serve: string;
    /** And every ready pod with that role must be in the slice. */
    all: boolean;
  };
  /** Shown once the round clears. */
  note: string;
}

export const rounds: Round[] = [
  {
    n: 1,
    title: "The front end",
    brief:
      "The shop's front end runs as three pods and needs one address the load balancer can send to. Everything in the shop was labelled app=shop when it was set up.",
    service: { name: "web", clusterIP: "10.96.44.120", port: 80 },
    pods: [
      { name: "web-7c9d4f-hwxdr", ip: "10.244.1.23", labels: { app: "shop", tier: "web" }, ready: true, port: 8080, portName: "http", role: "web", answer: "200, the shop's home page" },
      { name: "web-7c9d4f-k2r8s", ip: "10.244.2.14", labels: { app: "shop", tier: "web" }, ready: true, port: 8080, portName: "http", role: "web", answer: "200, the shop's home page" },
      { name: "web-7c9d4f-zq5vn", ip: "10.244.3.9", labels: { app: "shop", tier: "web" }, ready: true, port: 8080, portName: "http", role: "web", answer: "200, the shop's home page" },
      { name: "api-5b8f6d-lgsc5", ip: "10.244.2.41", labels: { app: "shop", tier: "api" }, ready: true, port: 8080, portName: "http", role: "api", answer: "404, the api has no home page" },
      { name: "api-5b8f6d-q7tnm", ip: "10.244.3.17", labels: { app: "shop", tier: "api" }, ready: true, port: 8080, portName: "http", role: "api", answer: "404, the api has no home page" },
    ],
    start: { selector: ["app=shop"], targetPort: 8080, type: "ClusterIP" },
    labels: ["app=shop", "tier=web", "tier=api"],
    targetPorts: [8080],
    from: "inside",
    want: { serve: "web", all: true },
    note: "Which Deployment made a pod never comes into it. The Service only sees labels, so anything carrying the right ones is in, including things you didn't mean to include.",
  },
  {
    n: 2,
    title: "The docs site",
    brief:
      "The docs site is a Node server listening on 3000. Someone wrote its Service by copying the front end's and swapping the labels, and people inside the company say it doesn't load.",
    service: { name: "docs", clusterIP: "10.96.201.7", port: 80 },
    pods: [
      { name: "docs-6d5c8b-4vx9t", ip: "10.244.1.31", labels: { app: "docs" }, ready: true, port: 3000, portName: "http", role: "docs", answer: "200, the docs index" },
      { name: "docs-6d5c8b-b8wmr", ip: "10.244.2.52", labels: { app: "docs" }, ready: true, port: 3000, portName: "http", role: "docs", answer: "200, the docs index" },
      { name: "docs-6d5c8b-tj7ks", ip: "10.244.3.28", labels: { app: "docs" }, ready: false, port: 3000, portName: "http", role: "docs", answer: "200, the docs index" },
    ],
    start: { selector: ["app=docs"], type: "ClusterIP" },
    labels: ["app=docs"],
    targetPorts: [null, 80, 3000, "http"],
    from: "inside",
    want: { serve: "docs", all: true },
    note: "Leave `targetPort` out and it's the same number as `port`, which is rarely what the app listens on. A named port is looked up on each pod, so the Service keeps working when the number changes.",
  },
  {
    n: 3,
    title: "The canary",
    brief:
      "api 3.2 is running as one canary pod next to three pods of 3.1. The team wants it taking its share of real traffic so they can watch its error rate before rolling it out. So far it hasn't had a single request.",
    service: { name: "api", clusterIP: "10.96.88.3", port: 80 },
    pods: [
      { name: "api-5b8f6d-lgsc5", ip: "10.244.2.41", labels: { app: "api", track: "stable" }, ready: true, port: 8080, portName: "http", role: "api", answer: "200 from 3.1" },
      { name: "api-5b8f6d-q7tnm", ip: "10.244.3.17", labels: { app: "api", track: "stable" }, ready: true, port: 8080, portName: "http", role: "api", answer: "200 from 3.1" },
      { name: "api-5b8f6d-xw2hc", ip: "10.244.1.40", labels: { app: "api", track: "stable" }, ready: true, port: 8080, portName: "http", role: "api", answer: "200 from 3.1" },
      { name: "api-canary-8d4b7c-rn6zp", ip: "10.244.2.63", labels: { app: "api", track: "canary" }, ready: true, port: 8080, portName: "http", role: "api", answer: "200 from 3.2" },
    ],
    start: { selector: ["app=api", "track=stable"], targetPort: "http", type: "ClusterIP" },
    labels: ["app=api", "track=stable", "track=canary"],
    targetPorts: ["http"],
    from: "inside",
    want: { serve: "api", all: true },
    note: "Taking a label out of a selector makes it match more pods. The canary gets about one request in four because it's one pod in four. Traffic is split evenly between pods, whichever Deployment they came from.",
  },
  {
    n: 4,
    title: "The webhooks",
    brief:
      "The payment provider has to send webhooks to the hooks service from the internet. The cluster runs on a cloud, and the nodes only have private addresses.",
    service: { name: "hooks", clusterIP: "10.96.150.33", port: 80 },
    pods: [
      { name: "hooks-59c7d8-mv8xq", ip: "10.244.1.12", labels: { app: "hooks" }, ready: true, port: 8080, portName: "http", role: "hooks", answer: "202, webhook accepted" },
      { name: "hooks-59c7d8-sd4lw", ip: "10.244.3.44", labels: { app: "hooks" }, ready: true, port: 8080, portName: "http", role: "hooks", answer: "202, webhook accepted" },
    ],
    start: { selector: ["app=hooks"], targetPort: 8080, type: "ClusterIP" },
    labels: ["app=hooks"],
    targetPorts: [8080],
    types: ["ClusterIP", "NodePort", "LoadBalancer"],
    from: "outside",
    want: { serve: "hooks", all: true },
    note: "That's a whole load balancer from the cloud for one Service, billed as one, and it only knows about addresses and ports. It can't tell one hostname or URL from another.",
  },
];
