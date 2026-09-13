// Lesson 8's triage rounds, as data.
//
// Each round is a real-looking `kubectl get events` window, a question, three
// answers, and — behind a button the reader has to press — what the object
// actually says right now. The reader may always read before answering, and the
// closing screen counts how often they did not.
//
// This is deliberately not the lesson 2 game rebuilt. There the reader *is* the
// loop and the world is hidden; here the reader is a person at a terminal with
// the real toolset, and nothing is hidden — it is simply behind a second
// command they have to think to run. The failure being taught is not "you
// cannot see the state", it is "you had a way to see the state and you reacted
// to the feed instead".
//
// Every event text below is close to something the real thing emits. The
// aggregation shapes (`x847 over 14m`) and the expiry behaviour in round three
// are the two that carry the most weight, because both of them make a feed lie
// without saying anything false.

export interface EventLine {
  age: string;
  type: "Normal" | "Warning";
  reason: string;
  object: string;
  message: string;
  /** Present when the API server has folded repeats into one object. */
  count?: number;
  /** The span those repeats cover, which is rarely the same as `age`. */
  over?: string;
  /** The one line the round is baiting the reader with. */
  loud?: boolean;
}

export interface Choice {
  text: string;
  right: boolean;
  /** What actually happens if you pick this. Never a bare verdict. */
  reply: string;
}

/** What `kubectl describe` would have said, which is the round's truth. */
export interface Truth {
  command: string;
  body: string;
  /** The sentence the reader was supposed to arrive at. */
  reading: string;
}

export interface Round {
  n: number;
  /** The situation, in the words a colleague would use. */
  setup: string;
  events: EventLine[];
  ask: string;
  choices: Choice[];
  truth: Truth;
  /** The idea the round exists to plant, shown after it is solved. */
  lesson: string;
}

export const rounds: Round[] = [
  {
    n: 1,
    setup:
      "You are on call. Nothing has paged, but you are looking at the shop namespace anyway.",
    events: [
      {
        age: "2m",
        type: "Normal",
        reason: "Killing",
        object: "pod/web-6c8f4b-2xk9",
        message: "Stopping container api",
        loud: true,
      },
      {
        age: "2m",
        type: "Normal",
        reason: "Scheduled",
        object: "pod/web-6c8f4b-9q7d",
        message: "Successfully assigned shop/web-6c8f4b-9q7d to node-3",
      },
      {
        age: "2m",
        type: "Normal",
        reason: "Pulled",
        object: "pod/web-6c8f4b-9q7d",
        message: "Container image \"web:1.4\" already present on machine",
      },
      {
        age: "2m",
        type: "Normal",
        reason: "Started",
        object: "pod/web-6c8f4b-9q7d",
        message: "Started container api",
      },
    ],
    ask: "A pod was killed two minutes ago. What do you do?",
    choices: [
      {
        text: "Create a replacement pod",
        right: false,
        reply:
          "There would then be four pods where the record asks for three, and the ReplicaSet controller would delete one of them within the second. You would have caused a deletion by trying to prevent one.",
      },
      {
        text: "Read the Deployment before doing anything",
        right: true,
        reply:
          "Three ready out of three. The kill and the four lines under it are one story, not two: a node was drained, a loop noticed the gap, and it was closed before you opened the terminal.",
      },
      {
        text: "Roll back to the previous version",
        right: false,
        reply:
          "Nothing here says anything about a version. You would be replacing every pod in the Deployment, for real, to undo something that had already fixed itself.",
      },
    ],
    truth: {
      command: "kubectl get deployment web",
      body: `NAME   READY   UP-TO-DATE   AVAILABLE   AGE
web    3/3     3            3           11d`,
      reading:
        "Three wanted, three ready. There is no gap, and there was one for about four seconds.",
    },
    lesson:
      "The feed showed you a true thing that had already stopped being true. Every event is a fact about a moment that has passed; the object is the only thing describing now.",
  },

  {
    n: 2,
    setup: "A colleague sends you a screenshot with the words 'this looks bad'.",
    events: [
      {
        age: "14m",
        type: "Warning",
        reason: "FailedScheduling",
        object: "pod/report-nightly-29598317-lm4xk",
        message:
          "0/3 nodes are available: 3 Insufficient cpu. preemption: not helpful for scheduling",
        count: 847,
        over: "14m",
        loud: true,
      },
    ],
    ask: "How many things are wrong?",
    choices: [
      {
        text: "Eight hundred and forty-seven",
        right: false,
        reply:
          "That is the number the line is designed to make you feel. It is a field on a single object, not a count of anything that exists.",
      },
      {
        text: "One, and it has been wrong for fourteen minutes",
        right: true,
        reply:
          "One pod that cannot be placed. The scheduler has looked at it 847 times, found no room 847 times, and the API server folded all of that into one record with a counter on it.",
      },
      {
        text: "None, since it is only a warning",
        right: false,
        reply:
          "It is one real problem. A pod has been unschedulable for a quarter of an hour, and no loop in the cluster can fix that by trying harder.",
      },
    ],
    truth: {
      command: "kubectl get pods -l job-name=report-nightly",
      body: `NAME                            READY   STATUS    RESTARTS   AGE
report-nightly-29598317-lm4xk   0/1     Pending   0          14m`,
      reading:
        "One pod. Pending, and it has been Pending since it was created.",
    },
    lesson:
      "Repeats are folded into one object with a count, so a large number is a duration rather than a magnitude. It tells you how long something has been retrying, and retrying is what everything here does when it cannot make progress.",
  },

  {
    n: 3,
    setup:
      "A service has been returning errors intermittently all morning. You check the namespace's events first, because that is what everyone does.",
    events: [
      {
        age: "6m",
        type: "Normal",
        reason: "SawCompletedJob",
        object: "cronjob/cleanup",
        message: "Saw completed job: cleanup-29598300, status: Complete",
      },
      {
        age: "21m",
        type: "Normal",
        reason: "ScalingReplicaSet",
        object: "deployment/checkout",
        message: "Scaled up replica set checkout-7f9c2d to 4",
      },
    ],
    ask: "The events look fine. What does that tell you about the last three hours?",
    choices: [
      {
        text: "Nothing was wrong in the last three hours",
        right: false,
        reply:
          "The window you are looking at is about an hour deep. Anything older than that has been deleted, because events carry an expiry and the cluster does not keep them.",
      },
      {
        text: "Nothing, and you should go and look at the workload itself",
        right: true,
        reply:
          "An empty feed is an empty feed. It is not a clean bill of health, and in this case the pod has been restarting since before breakfast.",
      },
      {
        text: "The problem is in a different namespace",
        right: false,
        reply:
          "Possible, but nothing here suggests it. You are inferring a location from an absence, and the absence has a much more ordinary explanation.",
      },
    ],
    truth: {
      command: "kubectl describe pod checkout-7f9c2d-p8vk",
      body: `Containers:
  api:
    State:          Waiting
      Reason:       CrashLoopBackOff
    Last State:     Terminated
      Reason:       Error
      Exit Code:    137
      Finished:     Mon, 11 Apr 2026 09:26:41 +0000
    Restart Count:  148
Conditions:
  Type           Status
  Ready          False
  ContainersReady False`,
      reading:
        "A hundred and forty-eight restarts, and not one of them is in the feed you were reading.",
    },
    lesson:
      "Events expire, typically after an hour. A problem older than the window leaves no trace in the feed at all, while the object it happened to still says exactly what is wrong. Absence of events is not evidence of anything.",
  },

  {
    n: 4,
    setup: "You are watching a deploy go out, with the feed open beside it.",
    events: [
      {
        age: "30s",
        type: "Warning",
        reason: "Unhealthy",
        object: "pod/web-8d1a3f-k2mn",
        message: "Readiness probe failed: dial tcp 10.244.1.19:8080: connect: connection refused",
        count: 3,
        over: "8s",
        loud: true,
      },
      {
        age: "34s",
        type: "Normal",
        reason: "Started",
        object: "pod/web-8d1a3f-k2mn",
        message: "Started container api",
      },
      {
        age: "36s",
        type: "Normal",
        reason: "Scheduled",
        object: "pod/web-8d1a3f-k2mn",
        message: "Successfully assigned shop/web-8d1a3f-k2mn to node-1",
      },
    ],
    ask: "There is a warning at the top of the feed. Is the pod unhealthy?",
    choices: [
      {
        text: "Yes, and the rollout should be stopped",
        right: false,
        reply:
          "You would be halting a deploy on the strength of three failed checks that happened while a process was still opening its listening socket. Every rollout in the cluster produces those.",
      },
      {
        text: "Unknown from this, so read the pod",
        right: true,
        reply:
          "It is ready now. The warning is a true record of the four seconds between the container starting and the application being willing to answer, which is a thing that happens every single time.",
      },
      {
        text: "No, because warnings are only informational",
        right: false,
        reply:
          "Right conclusion, wrong reason, and the reason is what matters. Warnings often do mean something. This one is dismissible because the object says otherwise, not because of its type.",
      },
    ],
    truth: {
      command: "kubectl get pod web-8d1a3f-k2mn",
      body: `NAME               READY   STATUS    RESTARTS   AGE
web-8d1a3f-k2mn    1/1     Running   0          38s

Conditions:
  Type           Status
  Ready          True
  ContainersReady True`,
      reading: "Ready. It has been for about twenty-five seconds.",
    },
    lesson:
      "The newest line in a feed is not the current state, it is the most recent thing to have happened. Those are different claims, and sorting by time makes them look like the same one.",
  },

  {
    n: 5,
    setup:
      "Half an hour after a release, the feed finally has something that deserves attention.",
    events: [
      {
        age: "28m",
        type: "Warning",
        reason: "Failed",
        object: "pod/web-3b7e91-qq4t",
        message: "Failed to pull image \"web:1.7\": not found",
        count: 12,
        over: "28m",
        loud: true,
      },
      {
        age: "28m",
        type: "Warning",
        reason: "Failed",
        object: "pod/web-3b7e91-qq4t",
        message: "Error: ErrImagePull",
        count: 12,
        over: "28m",
      },
      {
        age: "3m",
        type: "Normal",
        reason: "BackOff",
        object: "pod/web-3b7e91-qq4t",
        message: "Back-off pulling image \"web:1.7\"",
        count: 94,
        over: "28m",
      },
    ],
    ask: "This one is real. What do you change?",
    choices: [
      {
        text: "Delete the failing pod so it gets recreated",
        right: false,
        reply:
          "The record still names an image that does not exist, so its replacement fails the same way, and the one after that. You have restarted a loop that was already looping.",
      },
      {
        text: "The Deployment, so that it names an image that exists",
        right: true,
        reply:
          "The only thing you ever change is a record. Correct the image and the loops do the rest, in the order you watched them do it last lesson, without anyone deleting anything by hand.",
      },
      {
        text: "Scale up, so at least something is serving",
        right: false,
        reply:
          "Every new pod comes from the same record and fails at the same step. The two old pods still serving are the ones from the previous version, and they are unaffected either way.",
      },
    ],
    truth: {
      command: "kubectl get deployment web -o wide",
      body: `NAME   READY   UP-TO-DATE   AVAILABLE   IMAGES
web    2/3     1            2           web:1.7

Conditions:
  Type           Status   Reason
  Available      True     MinimumReplicasAvailable
  Progressing    False    ProgressDeadlineExceeded`,
      reading:
        "Two of three, and it stopped progressing half an hour ago. The old pods are still up, which is why nobody has noticed.",
    },
    lesson:
      "Even when the event is correct and urgent, it is not the thing you act on. It told you where to look, the object told you what was true, and the fix was a change to the record that both of them came from.",
  },
];
