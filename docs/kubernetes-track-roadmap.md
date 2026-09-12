# Kubernetes track roadmap

The full plan for the `kubernetes` course track: 51 lessons in 13 phases, across
three depths. It ships in batches, so this file is the plan of record and
`src/content/lessons/kubernetes/` is what has actually gone out.

Lesson length is not uniform — a lesson that is mostly an interactive runs well
past a lesson that is mostly prose. Each lesson's `minutes` is estimated from its
own contents; the recipe is in
[AGENTS.md](../AGENTS.md#estimating-minutes).

Mechanics live in [AGENTS.md](../AGENTS.md#the-courses-subsystem). Phase
metadata (title, summary, depth, accent) is
`src/data/courses/kubernetes/phases.json`. A lesson names its phase in
frontmatter and inherits the depth from it.

## Status

| Depth | Phases | Lessons | Shipped |
|---|---|---|---|
| Core | 1 to 4 | 1 to 18 | 1 to 9 |
| Practical | 5 to 9 | 19 to 37 | none |
| Deep dive | 10 to 13 | 38 to 51 | none |

Lessons 10, 15, 19 and 22 exist as `draft: true` files carrying prose from the
earlier six-lesson version of the track. They are numbered for their new slots,
but they need rewriting rather than just un-drafting. Their `<Term>` uses still
point at the old lesson numbering, so expect `[courses]` warnings when they are
published.

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

All five are shipped. Their interactives are described at the bottom of this
file.

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

9 is shipped. Its interactive is described at the bottom of this file.

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

## Phase 2's four interactives

Phase 2 is the phase where the reader stops being handed a simulation and starts
being shown the real thing, so all four pieces are built out of real API paths,
real key layouts, real `kubectl` output and real event text. None of them is a
world the reader operates; three are things they open up, and the fourth is a
terminal they read.

**Lesson 5, the request path** (`RequestPath.astro`). Six requests, six gates,
and the reader picks a request and watches it stop where it stops. Server
rendered, like the cluster map, because it is a labelled diagram rather than a
simulation: it works with JavaScript off, Pagefind indexes every outcome, and
the requests are real buttons. The gate order is the load-bearing part, and the
two requests that matter most are the one mutating admission *changes* and the
one validating admission refuses, because together they explain why that gate
runs last.

**Lesson 6, the store browser** (`StoreBrowser.astro`). Eight keys from a
cluster where the reader has applied one Deployment. Two of the eight were
written by a person, which is the entire argument, so the author of each key is
on the row. The Secret's row exists to land the backup point, and the Lease row
exists so that "the revision moves all day on an idle cluster" is something the
reader sees rather than something the prose asserts.

**Lesson 7, the controller cascade** (`src/scripts/courses/cascade/`). Five
loops, one world, and the reader edits records and watches which loop notices.
Three rules hold it up:

- *A controller does at most one thing per sweep.* That is what makes the
  cascade legible; a loop that fixed everything at once would look like an
  orchestrator, which is the exact idea the panel exists to kill.
- *No loop calls another.* Every `reconcile` in `engine.ts` takes the world and
  reads it. If one ever takes a hint about what changed, the panel stops being
  an honest picture.
- *The pause switches are the point.* Stopping the ReplicaSet controller and
  deleting a pod has to leave the pod gone, with nothing covering for it. Any
  change that lets another loop pick up the slack removes the only thing this
  interactive can show that prose cannot.

The deployment controller does replace one ReplicaSet with another one pod at a
time — add, wait for it to run, then remove — even though rollout mechanics are
lesson 11's. Not for completeness: a version that zeroes the old set in one move
lets deletions outrun creations, and the reader watches availability collapse
during an operation the track keeps calling safe. The knobs stay out of it; the
behaviour cannot.

**Lesson 8, the event triage** (`src/scripts/courses/triage/`). Five feeds, five
questions, and a second command per round that tells the reader what is actually
true. It is deliberately not the lesson 2 game rebuilt: there the world is
hidden and the reader is the loop, here nothing is hidden and the reader is a
person at a terminal. The failure being drilled is not "you could not see the
state", it is "you could, and you answered from the feed anyway".

So the read is recorded **at the moment the reader answers**, never at the end of
the round: pressing describe after choosing says nothing about how the choice was
made. A right answer from a guess still clears the round, because the closing
screen's claim is about habit rather than correctness, and punishing the guess in
the moment would turn it into a quiz.

The three traps are one per failure mode, and each needs its round: a count of
847 that is one problem (aggregation), an empty feed hiding a three-hour outage
(expiry), and a stale warning above a healthy pod (ordering by time).

## Lesson 9, the packing exercise

Four applications, and for each one the reader decides which processes share a
pod. It is the first interactive in the track that judges something the reader
built rather than something they picked off a list, and the design turns on one
refusal: nothing anywhere records what a good answer looks like.

A round is four facts per process. How many of it the system needs, which others
it reaches on `127.0.0.1`, which directory it shares with which, whether it exits
when it is done, and what port it binds. The engine turns an arrangement into
consequences, and a round clears when it produces no bad ones. So the reader is
never told they are wrong; they are told what they would have built.

Each round is decided by one rule, and the temptation is the same one every time,
which is that the processes belong to the same application so they feel like they
belong in the same pod:

1. A front end that needs three copies and a cache that needs one. The pod is the
   thing that gets copied, so the two cannot be one pod whatever else is true.
2. An API and the shipper tailing its log directory. That directory is something
   the pod makes, and nothing outside the pod can reach it.
3. An API that binds loopback only, the proxy that forwards to it, and a docs
   site that also wants port 8080. The rule that puts the first two together is
   the rule that keeps the third one out.
4. A config fetch that has to finish before the worker starts, and a nightly
   report that exits when it is done. Two things that exit, and only one of them
   belongs inside somebody else's lifetime. This is where init containers appear,
   and they appear as a slot rather than as a paragraph.

The closing screen is the only place the rule is stated outright, and it is
stated as the four questions the rounds asked rather than as advice.

The lesson's compose section is the frame for all of this and has to stay a
question. A reader arriving from Docker Compose reads a pod as a compose project
with a Kubernetes accent, so the section puts six services up, says that most of
them become a pod of their own, and stops. It deliberately does not say which
pair in its list belongs together, because that is round 2 of the exercise. An
earlier draft answered it in the prose and took the exercise's second round with
it.

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
