// Lesson 4's assembly rounds, as data.
//
// One requirement in plain English per round, one object that answers it, and
// two wrong answers that are things people actually reach for. The wrong
// answers carry the lesson: several of them work, and the reply says what they
// cost rather than that they are wrong.
//
// Vocabulary: lesson 4 may name every kind in its own table (Pod, ReplicaSet,
// Deployment, Service, ConfigMap, Secret) because the table does. It may not
// explain RBAC, rollouts or selectors, which are later lessons; it can say what
// they buy without teaching them.

export interface Choice {
  text: string;
  right: boolean;
  /** What actually happens if you pick this. Never a verdict on its own. */
  reply: string;
}

export interface Manifest {
  file: string;
  yaml: string;
}

/**
 * A rewrite of a file an earlier round already wrote. Creating a ConfigMap or a
 * Secret does nothing on its own: something has to say it wants it. The panel
 * diffs the new yaml against the old and marks the lines that appeared, so the
 * reader sees the Deployment grow rather than being told that it would.
 */
export interface Edit {
  file: string;
  yaml: string;
  note: string;
}

export interface Round {
  n: number;
  /** The requirement, as somebody would say it out loud. */
  need: string;
  choices: Choice[];
  /** Written down once the round is answered. */
  manifest: Manifest;
  /** An existing file this round also has to change. */
  edits?: Edit;
  /** One line placed under the manifest, tying it back to the lesson. */
  note: string;
}

const yaml = (lines: string[]): string => lines.join("\n");

// The Deployment is written once and then grown twice. Each version is built
// from the one before it, so the panel's line diff can only ever show
// insertions, and the reader watches the file gain the lines that matter.
const DEPLOY = [
  "kind: Deployment",
  "metadata:",
  "  name: web",
  "spec:",
  "  replicas: 3",
  "  template:",
  "    metadata:",
  "      labels:",
  "        app: web",
  "    spec:",
  "      containers:",
  "        - name: api",
  "          image: web:1.4",
];

const DEPLOY_WITH_CONFIG = [
  ...DEPLOY,
  "          envFrom:",
  "            - configMapRef:",
  "                name: web-config",
];

const DEPLOY_WITH_SECRET = [
  ...DEPLOY_WITH_CONFIG,
  "            - secretRef:",
  "                name: web-db",
];

export const rounds: Round[] = [
  {
    n: 1,
    need: "Three copies of a web API, always. If one dies it should come back, and you will be shipping new versions of it regularly.",
    choices: [
      {
        text: "Three Pods",
        right: false,
        reply:
          "Three records, each describing one set of containers, and nothing watching any of them. When the node under one goes away, so does the pod, and it stays gone. That is the second outage from lesson one with extra steps.",
      },
      {
        text: "A ReplicaSet",
        right: false,
        reply:
          "Closer, and it genuinely keeps three alive. But it has no notion of a new version, so shipping one means deleting and recreating things yourself, a few at a time, watching as you go. You already listed that job in lesson one and called it a rollout.",
      },
      {
        text: "A Deployment",
        right: true,
        reply:
          "The Deployment owns a ReplicaSet, the ReplicaSet owns the pods. The layer you just added is the one that knows how to replace them gradually and stop if the new ones do not come up.",
      },
    ],
    manifest: {
      file: "deployment.yaml",
      yaml: yaml(DEPLOY),
    },
    note: "Says three. Starts nothing.",
  },

  {
    n: 2,
    need: "Other services in the cluster need to call that API. Its pods get replaced on every deploy, and land on whichever node had room.",
    choices: [
      {
        text: "Nothing extra, callers use the pod addresses",
        right: false,
        reply:
          "Works right up until the next deploy. Every replaced pod takes its address with it, and every caller that wrote one down is now talking to nothing. This is the fifth outage from lesson one, arriving exactly on schedule.",
      },
      {
        text: "A Service",
        right: true,
        reply:
          "One name, resolved at the moment it is used, to whichever pods are alive right then. The pods keep churning underneath and nothing calling them has to know.",
      },
      {
        text: "A second Deployment in front of it, as a proxy",
        right: false,
        reply:
          "Now there are two things to keep alive, and the new one has the same problem the old one had: its own pods move too. You have added a layer without removing the reason you needed one.",
      },
    ],
    manifest: {
      file: "service.yaml",
      yaml: "kind: Service\nmetadata:\n  name: web\nspec:\n  selector:\n    app: web\n  ports:\n    - port: 80",
    },
    note: "Points at pods by a label the Deployment was already stamping on them.",
  },

  {
    n: 3,
    need: "The API reads a log level when it starts. You want to change that without rebuilding anything.",
    choices: [
      {
        text: "Bake it into the image",
        right: false,
        reply:
          "Then changing a log level is a rebuild, a push and a redeploy. It also means the image is no longer identical everywhere it runs, which was the one thing lesson one said containers were actually good for.",
      },
      {
        text: "A ConfigMap",
        right: true,
        reply:
          "Data as its own object, handed to the pods rather than built into them. Note what else had to change, though: a ConfigMap nobody references is data sitting in a store. The Deployment has to say it wants it.",
      },
      {
        text: "A Secret",
        right: false,
        reply:
          "It would work. It also files a log level next to your passwords, so everyone who needs to tweak logging needs access to the pile you were being careful about.",
      },
    ],
    manifest: {
      file: "configmap.yaml",
      yaml: "kind: ConfigMap\nmetadata:\n  name: web-config\ndata:\n  LOG_LEVEL: info",
    },
    edits: {
      file: "deployment.yaml",
      yaml: yaml(DEPLOY_WITH_CONFIG),
      note: "Changed, because the ConfigMap does nothing until something asks for it.",
    },
    note: "Data. No spec, no status, nothing driving it anywhere.",
  },

  {
    n: 4,
    need: "The API needs a database password, and it must not be inside the image.",
    choices: [
      {
        text: "A ConfigMap",
        right: false,
        reply:
          "It works exactly as well as the right answer, which is the trap. It also means anyone allowed to read ConfigMaps can read the password, and that is usually a much longer list of people.",
      },
      {
        text: "An environment variable written into the Deployment",
        right: false,
        reply:
          "The password now lives in the Deployment, which is a record like any other, in the same store, readable by anyone who can read Deployments. You have moved it rather than protected it.",
      },
      {
        text: "A Secret",
        right: true,
        reply:
          "Not because it is encrypted, because by default it is not. Because it is a different kind, and permissions are written against kinds. Like the ConfigMap, it sits there doing nothing until the Deployment asks for it.",
      },
    ],
    manifest: {
      file: "secret.yaml",
      yaml: "kind: Secret\nmetadata:\n  name: web-db\ndata:\n  password: c3VwZXJzZWNyZXQ=",
    },
    edits: {
      file: "deployment.yaml",
      yaml: yaml(DEPLOY_WITH_SECRET),
      note: "Two references now. The Deployment is the only thing that knows both exist.",
    },
    note: "That is base64, not encryption. You can read it too.",
  },
];
