// Lesson 14's workload picker, as data.
//
// Six things a team needs running, and for each one the reader picks the object
// they'd write. It's the phase 3 recap, so every object from the phase shows up
// as a choice somewhere, and the tempting wrong ones are the ones people really
// reach for: a Deployment with a sleep loop instead of a CronJob, a Deployment
// sized to the node count instead of a DaemonSet.
//
// Wrong answers are spent, not fatal, the same rule as the outage walk and the
// triage. Every reply says what that object would actually do with the workload,
// never just that it's wrong.

export interface Choice {
  object: string;
  right: boolean;
  /** What writing this would actually get you. Never a bare verdict. */
  reply: string;
}

export interface Round {
  n: number;
  /** The workload, the way someone on the team would describe it. */
  setup: string;
  choices: Choice[];
}

export const rounds: Round[] = [
  {
    n: 1,
    setup:
      "The shop's front end. Three copies behind the load balancer, and a new version goes out every Thursday.",
    choices: [
      {
        object: "ReplicaSet",
        right: false,
        reply:
          "It'll keep three running just fine. Then Thursday's release changes the template, nothing happens to the pods, and you're deleting them by hand.",
      },
      {
        object: "StatefulSet",
        right: false,
        reply:
          "It works, but you're paying for things you don't use. Every pod gets a fixed name, releases go one pod at a time from the top number down, and the front end doesn't care what any of its pods are called.",
      },
      {
        object: "Deployment",
        right: true,
        reply:
          "Three interchangeable copies and a new template every week, which is exactly what it's for. Each release is a new ReplicaSet, and the old one sits at zero in case you need it back.",
      },
      {
        object: "Pod",
        right: false,
        reply: "One copy, and when its node goes it's gone for good. Nothing makes another.",
      },
    ],
  },

  {
    n: 2,
    setup:
      "A log shipper that reads /var/log off the machine it's running on and sends it to the log store. Every machine, including the ones you haven't added yet.",
    choices: [
      {
        object: "Deployment, with replicas set to the node count",
        right: false,
        reply:
          "The scheduler spreads them out, but nothing says one per node. Two can land on the same machine and leave another with none, and the node you add next month gets nothing until someone remembers to bump the number.",
      },
      {
        object: "DaemonSet",
        right: true,
        reply:
          "One per node, a new one on every node that joins, and it stays put while a node gets drained.",
      },
      {
        object: "Job",
        right: false,
        reply: "It ships the logs that exist right now, exits 0, and the Job is Complete. Tomorrow's logs go nowhere.",
      },
      {
        object: "StatefulSet",
        right: false,
        reply:
          "Same problem as the Deployment with extra steps. Its pod numbers have nothing to do with nodes, so nothing keeps one on each.",
      },
    ],
  },

  {
    n: 3,
    setup:
      "Postgres, with one primary and two replicas. Each keeps its own copy of the data, and the replicas are set up to follow db-0.",
    choices: [
      {
        object: "Deployment",
        right: false,
        reply:
          "All three pods get the same volumes from the one template, so they either share a disk or have none. And when the primary's replaced it comes back with a random name, so the replicas are following a pod that no longer exists.",
      },
      {
        object: "DaemonSet",
        right: false,
        reply: "You get one per node, so how many database copies you run is now decided by how many machines you have.",
      },
      {
        object: "StatefulSet",
        right: true,
        reply:
          "db-0, db-1 and db-2, each with its own disk that follows the name. Postgres still does its own replicating, but at least the names it replicates between stay put.",
      },
    ],
  },

  {
    n: 4,
    setup: "The sales report, built every night at 02:00 and emailed to finance.",
    choices: [
      {
        object: "Deployment running a loop that sleeps until 02:00",
        right: false,
        reply:
          "It works until the pod gets replaced at 01:59 and the loop starts counting from scratch. And when a run fails the pod is still Running, so nothing anywhere shows it.",
      },
      {
        object: "Job",
        right: false,
        reply: "It runs once, right now. Then someone has to apply it again tomorrow night.",
      },
      {
        object: "CronJob",
        right: true,
        reply:
          "A new Job every night at 02:00, and each one ends up Complete or Failed on its own, so a bad night is something you can see.",
      },
    ],
  },

  {
    n: 5,
    setup:
      "Recompute prices on two million old orders, once, this afternoon. The script takes a chunk number and only does that chunk, and there are twenty chunks.",
    choices: [
      {
        object: "CronJob",
        right: false,
        reply:
          "You'd have to make up a schedule, then remember to delete it before it runs the whole backfill again tomorrow.",
      },
      {
        object: "Job",
        right: true,
        reply:
          "`completions: 20` in Indexed mode, and each pod gets its chunk number. The Job is Complete when all twenty have exited 0, and a chunk that fails is retried on its own.",
      },
      {
        object: "Deployment",
        right: false,
        reply:
          "Each pod finishes its chunk, exits, and gets started again, so the first chunk gets recomputed all afternoon.",
      },
    ],
  },

  {
    n: 6,
    setup:
      "You need a shell with curl inside the cluster for ten minutes, to work out why one service can't reach another.",
    choices: [
      {
        object: "Deployment",
        right: false,
        reply:
          "It works, but it's a lot of object for ten minutes. When you delete the pod to clean up, a new one shows up, and you have to remember it was the Deployment you needed to delete.",
      },
      {
        object: "Pod",
        right: true,
        reply:
          "`kubectl run debug --rm -it --image=curlimages/curl -- sh`. A bare pod, deleted when you exit, and nothing brings it back. For once that's exactly what you want.",
      },
      {
        object: "Job",
        right: false,
        reply:
          "Your shell exits when you're done, and the Job has to decide whether that was a success or something to retry. You wanted neither.",
      },
    ],
  },
];
