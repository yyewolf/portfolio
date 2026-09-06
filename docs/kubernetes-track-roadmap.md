# Kubernetes track roadmap

The full plan for the `kubernetes` course track: 51 lessons of about ten
minutes, in 13 phases, across three depths. It ships in batches, so this file is
the plan of record and `src/content/lessons/kubernetes/` is what has actually
gone out.

Mechanics live in [AGENTS.md](../AGENTS.md#the-courses-subsystem). Phase
metadata (title, summary, depth, accent) is
`src/data/courses/kubernetes/phases.json`. A lesson names its phase in
frontmatter and inherits the depth from it.

## Status

| Depth | Phases | Lessons | Shipped |
|---|---|---|---|
| Core | 1 to 4 | 1 to 18 | 1 to 4 |
| Practical | 5 to 9 | 19 to 37 | none |
| Deep dive | 10 to 13 | 38 to 51 | none |

Lessons 9, 10, 15, 19 and 22 exist as `draft: true` files carrying prose from
the earlier six-lesson version of the track. They are numbered for their new
slots, but they need rewriting rather than just un-drafting. Their `<Term>` uses
still point at the old lesson numbering, so expect `[courses]` warnings when
they are published.

## Depth boundaries

The original sketch cut the depths at lessons 15, 35 and 51. Those land
mid-phase, so the boundaries moved to phase edges instead: 1 to 4, 5 to 9, and
10 to 13. The tier descriptions are unchanged, and Core comes out at 18 lessons
(roughly three hours) rather than 15.

## The lessons

### Core

Phase 1, what problem are we solving?

| # | Lesson | Modes |
|---|---|---|
| 1 | Why not just run containers? | operate |
| 2 | You are the devops | operate |
| 3 | Introducing Kubernetes | visualize |

Containers come first so the game has a problem to be the answer to. The game
must stay second: lesson 1 may name the job (something that checks what should
be running against what is) but never the method, because the game exists to
make the player derive it.

Phase 2, the fundamental mental model

| # | Lesson | Modes |
|---|---|---|
| 4 | Everything is an object | operate, inspect |
| 5 | The API server | inspect |
| 6 | etcd, the cluster's memory | inspect |
| 7 | Controllers | visualize, operate |
| 8 | Events aren't instructions | operate |

Lesson 8 is the one that carries the most weight in this phase. Noisy and
misleading events, teaching observe then compare then act instead of event then
response, and covering idempotency, eventual consistency and level-based
reconciliation.

Phase 3, workloads

| # | Lesson | Modes |
|---|---|---|
| 9 | Pods | operate |
| 10 | Deployments | operate |
| 11 | ReplicaSets and rolling updates | visualize, operate |
| 12 | Jobs and CronJobs | operate |
| 13 | DaemonSets and StatefulSets | visualize |

11 is split out from 10 deliberately. It is where the machinery gets explained
and where the reader controls the rollout strategy.

Phase 4, networking

| # | Lesson | Modes |
|---|---|---|
| 14 | Pod networking | visualize |
| 15 | Services | operate |
| 16 | DNS | operate |
| 17 | Ingress and the Gateway API | operate |
| 18 | Network policies | operate |

18 is a puzzle. Allow frontend to backend and frontend to database, deny
internet to database, and the reader writes the policy.

### Practical

Phase 5, storage and configuration

| # | Lesson | Modes |
|---|---|---|
| 19 | Configuration | operate |
| 20 | Why containers lose their data | visualize |
| 21 | Volumes | visualize |
| 22 | Persistent volumes and claims | operate, inspect |

Phase 6, scheduling and resources

| # | Lesson | Modes |
|---|---|---|
| 23 | How does Kubernetes choose a node? | operate |
| 24 | Requests and limits | visualize, operate |
| 25 | Taints, tolerations and affinity | operate |

23 hands the reader three nodes of different sizes and several pods, and lets
them schedule by hand before revealing that there is a scheduler. 24 wants a
capacity bar simulation: scheduling reads requests, limits constrain runtime,
CPU gets throttled and memory gets OOMKilled.

Phase 7, reliability

| # | Lesson | Modes |
|---|---|---|
| 26 | Kubernetes will break | operate |
| 27 | Probes | operate |
| 28 | Rolling updates and availability | operate |
| 29 | Autoscaling | visualize |

26 destroys pods, nodes, services and containers and watches the recovery, while
making the point that none of it makes an application highly available. 27 is a
game built on one question: the process is alive, but should traffic reach it?

Phase 8, security

| # | Lesson | Modes |
|---|---|---|
| 30 | Who are you? | inspect |
| 31 | ServiceAccounts and RBAC | operate, inspect |
| 32 | Pod security | operate |
| 33 | Network security | operate |

31 hands the reader a compromised pod and asks what it can do. 33 is the
distinction between RBAC and NetworkPolicy: whether a workload can call the API,
against whether it can connect to another workload.

Phase 9, operating Kubernetes

| # | Lesson | Modes |
|---|---|---|
| 34 | Debugging a broken pod | operate |
| 35 | Debugging networking | operate |
| 36 | Observability | inspect |
| 37 | Resource problems | operate |

34 and 35 give the reader a broken system and the real toolset (`get`,
`describe`, `logs`, `exec`, `events`) without telling them where to look. 37 is
OOMKilled, CPU throttling, Pending and Evicted, and working out which is which.

### Deep dive

Phase 10, what's actually underneath?

| # | Lesson | Minutes | Modes |
|---|---|---|---|
| 38 | The control plane | 15 | inspect |
| 39 | What actually happens when you create a pod? | 15 | visualize, inspect |
| 40 | kubelet | 10 | inspect |
| 41 | Container runtime and CRI | 10 | inspect |
| 42 | CNI | 10 | visualize, inspect |
| 43 | CSI | 10 | inspect |

39 is the flagship. One animation running from `kubectl` through the API server,
etcd, the scheduler, back through the API server, then the kubelet, CRI, the
runtime, CNI, and finally a process. Nothing in it is new by that point, which
is what makes it work: it is the assembly, not the introduction.

Phase 11, Kubernetes isn't magic

| # | Lesson | Modes |
|---|---|---|
| 44 | Operators | visualize |
| 45 | Build your own controller | operate |
| 46 | CRDs | operate, inspect |

45 is the payoff for lesson 2. A small simulated API, and the reader writes the
loop they were performing by hand in their first ten minutes on the track.

Phase 12, architecture and tradeoffs

| # | Lesson | Modes |
|---|---|---|
| 47 | Kubernetes is a distributed system | visualize |
| 48 | Kubernetes is complicated | visualize |
| 49 | When Kubernetes is a bad idea | none |
| 50 | Kubernetes vs the alternatives | none |

50 is not a lesson where Kubernetes wins. It covers VMs, Docker Compose, Nomad,
serverless and managed platforms. Kubernetes is a tool, not a destination.

Phase 13, the whole thing

| # | Lesson | Minutes | Modes |
|---|---|---|---|
| 51 | You are the Kubernetes engineer | 30 | operate, inspect |

A broken cluster with the hints turned off: deploy, expose, configure, persist,
secure, diagnose, scale, upgrade.

## Lesson 1, the outage walk

Five outages in the order they arrive, each one breaking the fix chosen for the
one before it. The reader is not operating a system, they are choosing what to
build, which is what keeps it distinct from the lesson 2 game sitting right
after it. Six fixes get built across the five stages and one is destroyed, so
the closing tally is the same five items the lesson's prose lists.

## Lesson 2, the operator game

The design principle is that the game never explains reconciliation. The player
has to discover that looking at the whole system, comparing wanted against
actual, changing one thing and then looking again is the winning strategy. No
Kubernetes branding appears until the reveal.

Four panels: what we want, what we have, the event feed, and the actions (start,
stop, create, delete, and do nothing). The player is not handed the state. They
click into servers and into the specification to read it.

### Levels

1. Obvious failure. Desired 3, actual 2, a server vanished. Create one.
2. Too many. Desired 3, actual 4, somebody started an extra. Delete one.
3. The event lies. Desired 3, actual 3, and an event says a server restarted.
   The correct action is to do nothing, which is the first real lesson.
4. Noise. Four events at once and the state is already correct. Do nothing.
5. Race. The player creates a replacement, then the original comes back and now
   there are four. Teaches re-reading the state after acting.
6. Nodes. Two nodes with capacity, one of them dies. Two servers to place and
   nowhere obvious to put them. This is scheduling, without the word.
7. Dependencies. Web servers require a database, so ordering starts to matter.

### After each level

A "what did you do?" prompt with four answers: reacted to the event, made actual
match desired, restarted everything, or waited for another event. Most players
pick the first one early on and converge on the second.

Score on reasoning (unnecessary actions), efficiency (time to converge),
stability (oscillation) and incidents (damage caused). Leave out XP and coins,
because the reward here is working the system out.

### The reveal

After the levels comes the loop diagram, then the word reconciliation, and only
then the word Kubernetes. The UI then re-skins itself in place: desired state
becomes a Deployment, servers become Pods, and the player becomes a controller.
The last beat is an "automate it" button. The loop starts running itself, the
player kills a pod, and it comes back.

## The simulation engine

The games are not one-offs. One engine models objects, controllers, nodes,
scheduling, networking, events and failures, and each lesson loads a scenario
into it and exposes one of three modes. Visualize is watching the system decide.
Operate is making the decisions yourself. Inspect is opening it up and seeing the
mechanics underneath.

`modes` in lesson frontmatter records which of those a lesson is planned to
offer. The role the player takes escalates across the track: the operator, then
the scheduler, then the kubelet, then the network, and finally the control plane.

Implementation is vanilla TypeScript islands under `src/scripts/courses/`,
matching the existing `progress.ts` idiom. There is no UI framework, because
prose-only lessons have to keep shipping no JavaScript at all.
