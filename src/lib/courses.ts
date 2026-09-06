import { getCollection, type CollectionEntry } from "astro:content";

export type Track = CollectionEntry<"courses">;
export type Lesson = CollectionEntry<"lessons">;

export type Depth = "core" | "practical" | "deep";

export type Phase = {
  number: number;
  title: string;
  /** Optional, and worth omitting unless it says something the phase title and
   *  its lesson titles do not already say. */
  summary?: string;
  depth: Depth;
  accent: string;
};

/**
 * The three depth tiers, in order. A reader who only wants a working mental
 * model of Kubernetes can stop at the end of "core" and have lost nothing.
 */
export const DEPTHS: { key: Depth; label: string; blurb: string }[] = [
  {
    key: "core",
    label: "Core",
    blurb: "Enough to understand what Kubernetes is and how it thinks.",
  },
  {
    key: "practical",
    label: "Practical",
    blurb: "What you need to actually run something: storage, scheduling, failure, security, debugging.",
  },
  {
    key: "deep",
    label: "Deep dive",
    blurb: "The machinery underneath, extending it with your own controllers, and when not to use any of it.",
  },
];

export type GlossaryTerm = {
  term: string;
  introducedIn: number;
  short: string;
  long?: string;
  related?: string[];
};

const glossaries = import.meta.glob<{ default: GlossaryTerm[] }>(
  "../data/courses/*/glossary.json",
  { eager: true }
);

const phaseFiles = import.meta.glob<{ default: Phase[] }>(
  "../data/courses/*/phases.json",
  { eager: true }
);

/** The last path segment of a lesson slug: "kubernetes/02-pods" -> "02-pods". */
export function lessonSlug(lesson: Lesson): string {
  return lesson.slug.split("/").pop() as string;
}

export function lessonHref(lesson: Lesson): string {
  return `/courses/${lesson.data.track}/${lessonSlug(lesson)}`;
}

export async function getTracks(): Promise<Track[]> {
  return (await getCollection("courses"))
    .filter((track) => !track.data.draft)
    .sort((a, b) => a.data.order - b.data.order);
}

export async function getTrack(slug: string): Promise<Track | undefined> {
  return (await getTracks()).find((track) => track.slug === slug);
}

export async function getLessons(trackSlug: string): Promise<Lesson[]> {
  return (await getCollection("lessons"))
    .filter((lesson) => !lesson.data.draft && lesson.data.track === trackSlug)
    .sort((a, b) => a.data.order - b.data.order);
}

export function getGlossary(trackSlug: string): GlossaryTerm[] {
  const mod = glossaries[`../data/courses/${trackSlug}/glossary.json`];
  if (!mod) return [];
  return [...mod.default].sort((a, b) => a.term.localeCompare(b.term));
}

/** Terms a reader has earned by the time they reach `order`. */
export function unlockedTerms(trackSlug: string, order: number): GlossaryTerm[] {
  return getGlossary(trackSlug).filter((term) => term.introducedIn <= order);
}

export function findTerm(trackSlug: string, name: string): GlossaryTerm | undefined {
  const wanted = name.trim().toLowerCase();
  return getGlossary(trackSlug).find((term) => term.term.toLowerCase() === wanted);
}

/**
 * Look a term up across every track's glossary. <Term> is authored inside a
 * lesson with no way to receive page context through MDX, so it resolves by
 * name alone; `validateTermRefs` is what catches names that are wrong for the
 * lesson they appear in.
 */
export function findTermAnywhere(name: string): GlossaryTerm | undefined {
  const wanted = name.trim().toLowerCase();
  for (const mod of Object.values(glossaries)) {
    const found = mod.default.find((term) => term.term.toLowerCase() === wanted);
    if (found) return found;
  }
  return undefined;
}

export function getPhases(trackSlug: string): Phase[] {
  const mod = phaseFiles[`../data/courses/${trackSlug}/phases.json`];
  if (!mod) return [];
  return [...mod.default].sort((a, b) => a.number - b.number);
}

/** The depth tier a lesson inherits from its phase. */
export function depthOf(trackSlug: string, lesson: Lesson): Depth | undefined {
  return getPhases(trackSlug).find((phase) => phase.number === lesson.data.phase)?.depth;
}

export type PhaseGroup = {
  phase: Phase;
  lessons: Lesson[];
  minutes: number;
};

export type DepthGroup = {
  depth: Depth;
  label: string;
  blurb: string;
  phases: PhaseGroup[];
  lessonCount: number;
  minutes: number;
};

const sumMinutes = (lessons: Lesson[]) =>
  lessons.reduce((total, lesson) => total + lesson.data.minutes, 0);

/**
 * The shape the track page renders: depth tiers, each holding phases, each
 * holding its lessons. Phases with no lessons yet are dropped, so a phase can
 * be declared before it is written.
 */
export function outline(trackSlug: string, lessons: Lesson[]): DepthGroup[] {
  const phases = getPhases(trackSlug);

  const groups = DEPTHS.map(({ key, label, blurb }) => {
    const phaseGroups: PhaseGroup[] = phases
      .filter((phase) => phase.depth === key)
      .map((phase) => {
        const inPhase = lessons.filter((lesson) => lesson.data.phase === phase.number);
        return { phase, lessons: inPhase, minutes: sumMinutes(inPhase) };
      })
      .filter((group) => group.lessons.length > 0);

    return {
      depth: key,
      label,
      blurb,
      phases: phaseGroups,
      lessonCount: phaseGroups.reduce((total, group) => total + group.lessons.length, 0),
      minutes: phaseGroups.reduce((total, group) => total + group.minutes, 0),
    };
  });

  return groups.filter((group) => group.lessonCount > 0);
}

export type TrackStats = {
  lessonCount: number;
  /** Phases that actually have a published lesson in them, not phases declared. */
  phaseCount: number;
  totalMinutes: number;
  termCount: number;
};

export function trackStats(trackSlug: string, lessons: Lesson[]): TrackStats {
  return {
    lessonCount: lessons.length,
    phaseCount: new Set(lessons.map((lesson) => lesson.data.phase)).size,
    totalMinutes: sumMinutes(lessons),
    termCount: getGlossary(trackSlug).length,
  };
}

export type LessonNeighbours = {
  index: number;
  prev?: Lesson;
  next?: Lesson;
};

export function neighbours(lessons: Lesson[], current: Lesson): LessonNeighbours {
  const index = lessons.findIndex((lesson) => lesson.slug === current.slug);
  return {
    index,
    prev: index > 0 ? lessons[index - 1] : undefined,
    next: index >= 0 && index < lessons.length - 1 ? lessons[index + 1] : undefined,
  };
}

const TERM_TAG = /<Term(?:\s+[^>]*)?>([\s\S]*?)<\/Term>/g;
const TERM_ATTR = /\bterm=["']([^"']+)["']/;

/**
 * Warn (never fail) about <Term> usages that point at a term the reader cannot
 * have met yet, or at no term at all. Runs against the raw MDX source, so it
 * needs no render-time context.
 */
export function validateTermRefs(trackSlug: string, lessons: Lesson[]): string[] {
  const problems: string[] = [];

  for (const lesson of lessons) {
    for (const match of lesson.body.matchAll(TERM_TAG)) {
      const [tag, children] = match;
      const explicit = tag.match(TERM_ATTR)?.[1];
      const name = (explicit ?? children).trim();
      if (!name) continue;

      const found = findTerm(trackSlug, name);
      if (!found) {
        problems.push(`${lesson.slug}: <Term> "${name}" is not in the glossary`);
      } else if (found.introducedIn > lesson.data.order) {
        problems.push(
          `${lesson.slug}: <Term> "${found.term}" is introduced in lesson ${found.introducedIn}, ` +
            `but used in lesson ${lesson.data.order}`
        );
      }
    }
  }

  for (const problem of problems) {
    console.warn(`[courses] ${problem}`);
  }
  return problems;
}

/**
 * Warn (never fail) about structural mistakes that stop being obvious once a
 * track has dozens of lessons: a duplicated or skipped `order`, a `phase` with
 * no metadata behind it, or phases that interleave instead of running in
 * blocks. Same contract as `validateTermRefs`: author-time noise, not a gate.
 */
export function validateStructure(trackSlug: string, lessons: Lesson[]): string[] {
  const problems: string[] = [];
  const phases = new Map(getPhases(trackSlug).map((phase) => [phase.number, phase]));
  const seen = new Map<number, string>();
  let previousPhase = 0;
  const closed = new Set<number>();

  for (const lesson of lessons) {
    const { order, phase } = lesson.data;

    const duplicate = seen.get(order);
    if (duplicate) {
      problems.push(`${lesson.slug}: order ${order} is already used by ${duplicate}`);
    }
    seen.set(order, lesson.slug);

    if (!phases.has(phase)) {
      problems.push(`${lesson.slug}: phase ${phase} is not in phases.json`);
    }

    if (phase !== previousPhase) {
      if (closed.has(phase)) {
        problems.push(`${lesson.slug}: phase ${phase} resumes after phase ${previousPhase}`);
      }
      if (previousPhase) closed.add(previousPhase);
      previousPhase = phase;
    }
  }

  const orders = [...seen.keys()].sort((a, b) => a - b);
  for (let i = 1; i < orders.length; i++) {
    if (orders[i] !== orders[i - 1] + 1) {
      problems.push(`${trackSlug}: order jumps from ${orders[i - 1]} to ${orders[i]}`);
    }
  }

  for (const problem of problems) {
    console.warn(`[courses] ${problem}`);
  }
  return problems;
}
