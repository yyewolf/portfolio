// Lesson 10's stale set, as data.
//
// One ReplicaSet, three pods, and three acts the reader steps through. The panel
// exists to show one fact that no amount of prose lands as well: editing a
// ReplicaSet's template does nothing at all to the pods it has already made. The
// reader changes the image, watches nothing happen, deletes a pod, and only then
// sees the new image arrive, on the replacement.
//
// That fact is the whole argument for the next lesson, so the panel has to let
// the reader sit in the middle state where the set and its pods disagree and
// nothing anywhere is working to fix it. A version that animated the pods over
// to the new image would be a deployment, which is exactly the thing this object
// is not.
//
// Vocabulary: lesson 10 owns ReplicaSet and pod template. Rollout is lesson 11,
// so the word never appears. Selectors are lesson 16, so pods belong to the set
// by owner reference, which lesson 7 already taught.

export interface Act {
  n: number;
  /** What the reader is asked to do, as an instruction rather than a question. */
  ask: string;
  /** The button that carries the act out. `{pod}` becomes a real pod name. */
  action: string;
  /** What the set's controller did about it, once the act is done. */
  happened: string;
  /** The point, stated. Shown under the world once the act is done. */
  note: string;
}

export const IMAGE_OLD = "shop/web:2.8";
export const IMAGE_NEW = "shop/web:2.9";

export const acts: Act[] = [
  {
    n: 1,
    ask: "The set asks for three pods and three are running. Change the template to 2.9 and see what it does to them.",
    action: "Set the template image to 2.9",
    happened:
      "Nothing. The controller counted three pods, wanted three pods, and went back to sleep.",
    note: "The template is only the instructions for making a pod. All three are still running 2.8 and nothing anywhere disagrees with that.",
  },
  {
    n: 2,
    ask: "So the set says 2.9 and every pod says 2.8. Wait as long as you like, or delete one of the pods.",
    action: "Delete {pod}",
    happened:
      "Two pods, three wanted, so it made one. It read the template as it reads now, so the new pod came up on 2.9.",
    note: "That's the only way a pod ever gets the new image: by being a new pod. The two originals are untouched and will stay on 2.8 until something deletes them.",
  },
  {
    n: 3,
    ask: "You've got a set running two versions at once. Get the other two onto 2.9.",
    action: "Delete the other two pods",
    happened: "Two gone, two made, both on 2.9. The set is finally all one version.",
    note: "You just did a release by deleting things by hand and hoping. Nothing counted how many were up while you did it, and for a moment the set was down to one pod serving.",
  },
];
