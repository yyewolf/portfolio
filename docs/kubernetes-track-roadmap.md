# Kubernetes track roadmap

The full plan for the `kubernetes` course track: 52 lessons in 13 phases, across
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
| Core | 1 to 4 | 1 to 19 | 1 to 19 |
| Practical | 5 to 9 | 20 to 38 | none |
| Deep dive | 10 to 13 | 39 to 52 | none |

Lessons 20 and 23 exist as `draft: true` files carrying prose from the
earlier six-lesson version of the track. They are numbered for their new slots,
but they need rewriting rather than just un-drafting. Their `<Term>` uses still
point at the old lesson numbering, so expect `[courses]` warnings when they are
published. The old lesson 10 draft was one of these; it has been replaced by the
Deployments lesson now sitting at 11.

## Depth boundaries

The original sketch cut the depths at lessons 15, 35 and 51. Those land
mid-phase, so the boundaries moved to phase edges instead: 1 to 4, 5 to 9, and
10 to 13. The tier descriptions are unchanged, and Core comes out at 19 lessons
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
| 10 | ReplicaSets | visualize, operate |
| 11 | Deployments and rollouts | operate |
| 12 | Jobs and CronJobs | operate |
| 13 | DaemonSets and StatefulSets | visualize |
| 14 | Picking a workload | operate |

Phase 3 runs bottom up: the thing, then keep a count of the thing, then change
which thing safely. The original plan had Deployments at 10 and "ReplicaSets and
rolling updates" at 11, and that was wrong twice over. It cut across an object
and a different object's feature, because a ReplicaSet cannot do a rolling
update; and it made lesson 10 withhold a word lesson 7 had already used three
times while its cascade put ReplicaSet objects on screen.

Bottom up also buys the Deployments lesson its mechanism. It can say that a
template change makes a new ReplicaSet and drains the old one, which is what
turns "every pod got replaced" from a rule into a consequence, and it explains
the middle segment of a pod name instead of pointing at it.

9 to 14 are shipped. Their interactives are described at the bottom of this
file.

Phase 4, networking

| # | Lesson | Modes |
|---|---|---|
| 15 | Pod networking | visualize |
| 16 | Services | operate |
| 17 | DNS | operate |
| 18 | Ingress and the Gateway API | operate |
| 19 | Network policies | operate |

19 is a puzzle. Lock the database to the backend, deny the database the
internet, and the reader writes the policy. The original sketch said frontend to
database, which is an architecture the lesson shouldn't be teaching, so the
backend is the one that talks to it.

15 to 19 are shipped. The address board is described below, and the four
round-based panels after it.

### Practical

Phase 5, storage and configuration

| # | Lesson | Modes |
|---|---|---|
| 20 | Configuration | operate |
| 21 | Why containers lose their data | visualize |
| 22 | Volumes | visualize |
| 23 | Persistent volumes and claims | operate, inspect |

Phase 6, scheduling and resources

| # | Lesson | Modes |
|---|---|---|
| 24 | How does Kubernetes choose a node? | operate |
| 25 | Requests and limits | visualize, operate |
| 26 | Taints, tolerations and affinity | operate |

24 hands the reader three nodes of different sizes and several pods, and lets
them schedule by hand before revealing that there is a scheduler. 25 wants a
capacity bar simulation: scheduling reads requests, limits constrain runtime,
CPU gets throttled and memory gets OOMKilled.

25 also owns in-place resize, which is the one place the track should say that a
running container's CPU and memory can be changed without restarting it, along
with `resizePolicy` and why a memory limit going down is the awkward direction.
Lesson 10 deliberately does not explain it. It mentions in one clause that the
field is editable, because its own argument used to be "a pod cannot be edited"
and that was already wrong and getting wronger. The durable version of lesson
10's claim is about the Deployment rather than the pod: creating and deleting
pods is the only thing a Deployment does to one, so it replaces pods even for
fields it could have patched. That survives whatever the API server opens up
next, and it is the claim every string in the change desk now makes.

Phase 7, reliability

| # | Lesson | Modes |
|---|---|---|
| 27 | Kubernetes will break | operate |
| 28 | Probes | operate |
| 29 | Rolling updates and availability | operate |
| 30 | Autoscaling | visualize |

27 destroys pods, nodes, services and containers and watches the recovery, while
making the point that none of it makes an application highly available. 28 is a
game built on one question: the process is alive, but should traffic reach it?

Phase 8, security

| # | Lesson | Modes |
|---|---|---|
| 31 | Who are you? | inspect |
| 32 | ServiceAccounts and RBAC | operate, inspect |
| 33 | Pod security | operate |
| 34 | Network security | operate |

32 hands the reader a compromised pod and asks what it can do. 34 is the
distinction between RBAC and NetworkPolicy: whether a workload can call the API,
against whether it can connect to another workload.

Phase 9, operating Kubernetes

| # | Lesson | Modes |
|---|---|---|
| 35 | Debugging a broken pod | operate |
| 36 | Debugging networking | operate |
| 37 | Observability | inspect |
| 38 | Resource problems | operate |

35 and 36 give the reader a broken system and the real toolset (`get`,
`describe`, `logs`, `exec`, `events`) without telling them where to look. 38 is
OOMKilled, CPU throttling, Pending and Evicted, and working out which is which.

### Deep dive

Phase 10, what's actually underneath?

| # | Lesson | Minutes | Modes |
|---|---|---|---|
| 39 | The control plane | 15 | inspect |
| 40 | What actually happens when you create a pod? | 15 | visualize, inspect |
| 41 | kubelet | 10 | inspect |
| 42 | Container runtime and CRI | 10 | inspect |
| 43 | CNI | 10 | visualize, inspect |
| 44 | CSI | 10 | inspect |

40 is the flagship. One animation running from `kubectl` through the API server,
etcd, the scheduler, back through the API server, then the kubelet, CRI, the
runtime, CNI, and finally a process. Nothing in it is new by that point, which
is what makes it work: it is the assembly, not the introduction.

Phase 11, Kubernetes isn't magic

| # | Lesson | Modes |
|---|---|---|
| 45 | Operators | visualize |
| 46 | Build your own controller | operate |
| 47 | CRDs | operate, inspect |

46 is the payoff for lesson 2. A small simulated API, and the reader writes the
loop they were performing by hand in their first ten minutes on the track.

Phase 12, architecture and tradeoffs

| # | Lesson | Modes |
|---|---|---|
| 48 | Kubernetes is a distributed system | visualize |
| 49 | Kubernetes is complicated | visualize |
| 50 | When Kubernetes is a bad idea | none |
| 51 | Kubernetes vs the alternatives | none |

51 is not a lesson where Kubernetes wins. It covers VMs, Docker Compose, Nomad,
serverless and managed platforms. Kubernetes is a tool, not a destination.

Phase 13, the whole thing

| # | Lesson | Minutes | Modes |
|---|---|---|---|
| 52 | You are the Kubernetes engineer | 30 | operate, inspect |

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

## Lesson 10, the stale set

Three steps against one ReplicaSet, and the panel exists to show one fact that no
paragraph lands as well: editing a ReplicaSet's template does nothing at all to
the pods it has already made. The reader changes the image and watches the
controller run and do nothing, deletes one pod and watches the replacement arrive
on the new image, then has to delete the rest by hand to finish the job.

That is the whole argument for lesson 11, which is why the panel has to let the
reader sit in the middle state where the set and its pods disagree and nothing
anywhere is working to fix it. A version that animated the pods over to the new
image would be a deployment, which is exactly the thing this object is not.

Two rules hold it up:

- *`reconcile` never reads a pod's image.* It counts, compares against `replicas`,
  and creates or deletes one pod. The real controller does not look either, and
  the moment this one does the lesson is gone.
- *A pod records the image it was made with, and is never updated.* That is what
  lets the set and its pods disagree, and the disagreement is the subject.

The set is named `web-6c8f4b`, which is the string lesson 7 already put in front
of the reader in its owner reference example. Pods belong to the set by owner
reference rather than by selector, because selectors are lesson 16.

It is much smaller than the change desk on purpose. Three acts, one world, no
scoring, and the reader is never wrong about anything.

## Lesson 11, the change desk

Five change requests against one Deployment that keeps its history across the
rounds, and the reader edits the spec rather than operating a world. The rule the
whole panel exists to teach is that `spec.template` is a box: change anything
inside it and every pod is replaced, change anything outside it and the running
pods never notice. A label and an image cost exactly the same, which is the part
nobody expects.

The requests are ordered so each one is decided by one thing, and none of them is
phrased as a question about the template:

1. Five instead of three. The count is outside the template, so nothing that was
   running is touched. The warm-up, and it establishes the baseline.
2. Ship 2.9. The image is inside, so all five are replaced, and that is correct
   rather than a mistake. This is where the word rollout earns itself.
3. Debug logging, and back down to three. Both kinds of change in one apply, and
   the engine attributes them separately because the reader cannot.
4. A team label for a dashboard, on the pods. The load-bearing round. Either you
   put it on the Deployment and the dashboard still cannot see it, or you put it
   on the template and a cosmetic label costs you every pod.
5. Just restart it. There is no restart field. The reader has to reach for a
   template annotation, which is exactly what `kubectl rollout restart` does, and
   it pays off lesson 9's closing claim that the restart you have seen is a
   different pod in bulk.

Three things hold it up:

- *Nothing records which edits are right.* A round declares what the team asked
  for as a **state the spec has to end up in**, never an edit to pick, so two
  routes to the same spec are both correct and an arrangement nobody pictured
  still gets a truthful account. `engine.ts` computes consequences from which
  fields were touched and has no opinion about which button that was.
- *The only rule is `inTemplate`.* One function, one `startsWith`. Any version
  that weighs a change by how important it looks destroys the lesson, because the
  lesson is that nothing weighs it.
- *The pod name is the proof.* Its middle segment is a hash of the template
  fields computed in `engine.ts`, not a string in `rounds.ts`, so it moves exactly
  when the template moves and the reader can check that against the diff they can
  see. By the time this panel runs the reader knows that segment is the
  ReplicaSet's name, so the closing screen says so rather than teasing it.

Two details worth not undoing. An unasked change is only a failure when it
reaches something running, which means the template or the count; labelling the
Deployment as well as its pods is normal and clears the round, and an earlier
version failed it. And the rollout finding loses its approving tone whenever
anything bad is in the same list, because a rollout the reader was asked for is
still a good thing to have done and praising it next to a mistake is how a panel
ends up congratulating play it never checked.

The manifest is rendered with the template block tinted, which is the one thing
the panel can do that no sentence about it matches: the reader sees where the
walls are. `selector` is rendered because a Deployment without one is not a
Deployment, and nothing anywhere discusses it, since labels and selectors are
lesson 16.

## Lesson 12, the run sheet

Five tasks, and for each one the reader edits a spec, runs it against a scripted
stretch of time, and reads a timeline of what the pods and Jobs did. Every task
starts from the spec somebody would write first, so pressing Run straight away is
the expected first move and it always goes wrong in a way worth seeing.

Each task is decided by one thing, and none of them is phrased as a question
about the field that decides it:

1. Run the migration. It starts out as a copied Deployment, which restarts the
   container every time the migration exits 0, until it sits in
   `CrashLoopBackOff`. The fix is the kind.
2. Send the invoices. A node drain evicts the pod 600 invoices in. With retries
   on, the replacement starts the list from the top and 600 customers get two;
   with `backoffLimit: 0`, 400 get none. The only clean answer is a change to the
   command (`--skip-sent`), which is the lesson: Kubernetes can make work
   finish, only your code can make it safe to repeat.
3. Push the orders export. Monday is a normal 40-minute run, Tuesday hangs. No
   deadline leaves Tuesday `Running` forever; ten minutes kills Monday while it's
   healthy; two hours is right. The engine decides which by whether the pod was
   hung when the deadline landed, not by the number.
4. Sync the stock every hour. The warehouse is six times slower for part of the
   afternoon, so the 14:00 sync runs past 15:00. `Allow` overlaps, `Replace` kills
   a sync halfway through rewriting the file, `Forbid` skips an hour, and the
   brief says skipping is fine.
5. The morning digest. `0 9 * * *` with no `timeZone` lands at 11:00 in Paris in
   September and 10:00 in November; `0 7` is right until the clocks change. Only
   `timeZone: Europe/Paris` holds on both dates. Conversions go through `Intl`,
   so the daylight saving shift is the real one.

Two things hold it up:

- *Findings are written about mechanisms, never settings.* A pod was evicted, a
  replacement started from item zero, two Jobs overlapped, a deadline ran out
  while work was still progressing. Nothing in `engine.ts` knows which choice is
  the intended one, the same rule as the packing and the change desk.
- *The numbers are the real ones.* Job back-off doubles from 10 seconds to six
  minutes and the kubelet's from 10 seconds to five, an eviction counts against
  `backoffLimit`, a failed Job's `DURATION` counts to now, and a CronJob's Job is
  named after its scheduled minute since 1970. The timeline is only worth
  anything if a reader who later meets the real thing recognises it.

## Lesson 13, the side-by-side board

Free play, like the controller cascade. One cluster of three nodes running a
Deployment, a DaemonSet and a StatefulSet, and the reader does things to the
cluster: deletes a pod, adds a node, removes one, cuts one off and reconnects it,
scales down and back up. After each action the board shows what each of the
three controllers did about it, side by side.

It's laid out nodes down and workloads across, because that layout makes the
lesson without a sentence. The DaemonSet column has exactly one pod per Ready
row, the StatefulSet column keeps its numbers and its disks, and the Deployment
column is just names landing wherever there's room.

The action worth building the whole board for is cutting a node off. The
Deployment's pod there is evicted and replaced elsewhere straight away, the
DaemonSet's pod just shows Unknown and nothing replaces it, and the StatefulSet
waits, because its pod still exists as far as it can tell and it will not risk
two pods with one name. Reconnecting or force-deleting is what lets it move.
That's the at-most-one rule, and no paragraph lands it as well as watching the
column next to it not care.

Two rules hold it up:

- *No controller reads the action.* `act()` changes the world and says what
  happened, then `settle()` runs all three reconcilers against the world until a
  pass changes nothing, so any sequence of actions gets an honest account.
- *Disks are never deleted.* Scaling down and back up has to reattach the old
  disk to the returning name.

## Lesson 14, the workload picker

The phase 3 recap. Phase 3 is five workload objects in a row, which is a lot to
hold, so the phase closes on a short lesson that stacks them (which object
writes which), puts them in one table, and then asks. Six workloads a team would
really run, and for each one the reader picks what they'd write: a weekly-release
front end, a log shipper on every machine, Postgres with replicas following
`db-0`, a nightly report, a one-off chunked backfill, and a ten-minute debug
shell.

Wrong picks are spent, not fatal, and every reply is a consequence rather than a
verdict. The wrong choices are the ones people really reach for: a Deployment
sized to the node count instead of a DaemonSet, a Deployment with a sleep loop
instead of a CronJob. The rule behind all six is stated once, on the closing
screen, as two questions: is it supposed to finish, and does it matter which
machine or which copy it is.

## Lesson 15, the address board

Free play, like the lesson 13 board, drawn as a small network diagram. Three
nodes side by side on the node network, each with its range printed on it, and a
shop pod whose config holds an api pod's address. shop sends a request every
couple of seconds, and each one is a dot: out of shop's pod, down to its node,
along the node network, up into whichever node owns that range, into the pod and
back as a reply. A request that gets lost stops where it got lost and says why,
with no route to host at a node that has nothing on that address and a timeout at
the gateway when no node owns the range any more.

The first version was a report: a hop-by-hop list and a counter on every pod
after each action. It said everything and showed nothing, and the dots replaced
it. Keep the controls sparse: global actions in one bar, pod actions only once a
pod is clicked, and a node's remove as a × on the node.

The actions are the ordinary life of a Deployment: delete the api pod, crash its
container, ship a new version, scale, add or remove a node, and point shop at a
different pod. A crash keeps the address, everything else makes a pod and so a new
address, and the request to the old one either finds no route or reaches a node
where nothing has it. Pointing shop somewhere new is a template change, so it
replaces shop's own pod too, by the same rule the change desk is about.

Two rules hold it up:

- *The trace reads the world, never the action.* `send()` takes an address and
  walks the routes, so any sequence of actions gets a true account.
- *Addresses come out of the node's range in order.* That's how host-local
  allocation works, and it means a pod's address says which node it's on. It also
  means the board never reuses an address within a session, so address reuse is
  a sentence in the prose rather than something the board fakes.

## Phase 4's round panels

Lessons 16 to 19 share one shape, which is the change desk's: a brief that says
what has to be true afterwards, controls for exactly the fields that round is
about, a manifest generated from the reader's own choices, and a result computed
by an engine that has no answer key. Any setup that routes correctly clears, and
every setup gets sentences about what it actually did.

Lesson 16 also has a figure before the desk, `ServiceTypes.astro`: the same two
nodes drawn for each type, with only the path changing. A pod calling a
ClusterIP, a laptop on a node's port, a browser through the cloud load balancer,
all ending in the same kube-proxy rules, with a caption each for where it's
reachable from and what it's for. It's a figure, so it has no rounds.

**Lesson 16, the service desk.** Four Services, each as it was first written. The
reader edits the selector, `targetPort` and type, sends eight requests, and reads
the EndpointSlice as kubectl prints it and where each request went.

1. The front end's selector is `app: shop`, which the api pods have too, so some
   requests get a 404 from the api.
2. The docs Service has no `targetPort`, so traffic goes to 80 and nothing listens.
   A number and a named port both clear.
3. The canary is left out because the selector asks for `track: stable`. The fix
   is removing a label.
4. Webhooks from the internet, with private nodes. ClusterIP never arrives,
   NodePort has nowhere public to arrive at, LoadBalancer works.

**Lesson 17, the name lookup.** The reader types the host name into a real input,
and the resolver walks the pod's search list query by query. Free text is the
point: the zone and the resolver are modelled, so whatever spelling someone tries
gets the true sequence of queries and the true answer.

1. `api` from shop. The warm-up that puts the search list on screen.
2. `api` from billing resolves, to billing's own api. Nothing errors.
3. `db` is headless and answers with all three pods, db-1 included. `db-0.db`.
4. `api.stripe.com` takes four queries because it has two dots. A trailing dot
   takes one.

**Lesson 18, the route table.** An HTTPRoute on one Gateway, with the Gateway API's
real precedence: exact beats prefix, the longest prefix wins, then the oldest
route. Each round unlocks one kind of edit.

1. Rules. `Exact /api/orders` misses `/api/orders/41`, and a prefix matches whole
   segments, so `/api` leaves `/apidocs` alone.
2. Rewrites. search answers at its own root and gets handed `/search?q=boots`.
3. Weights. Two backends default to 1 each, half the traffic on the canary.
   A hundred requests at 9 and 1 are exactly 90 and 10.
4. `allowedRoutes`. `Same` attaches nothing, `All` lets a months-old demo route in
   sandbox win `/` on age, `Selector` is right.

**Lesson 19, the policy puzzle.** Policies are edited by switching rule entries on
and isolating directions, with the entries being rules people really write. The
rounds build on each other and each starts from a working answer to the last.

1. Isolation. Only the backend reaches the database. `namespaceSelector: {}` is the
   tempting wrong entry.
2. One dash. Prometheus in, Grafana out, from the same namespace. The one-entry
   AND clears and the two-entry OR lets Grafana in, and the generated YAML shows
   the dash that makes the difference.
3. Egress with no rules on the database. Replies to accepted connections still
   flow, which people don't expect.
4. The backend's egress, started for the reader. It breaks DNS, so both named
   connections fail until 53 to kube-dns is allowed, and "anywhere on 443" has to
   narrow to the provider's range.

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
