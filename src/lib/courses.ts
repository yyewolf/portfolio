import { getCollection, type CollectionEntry } from "astro:content";

export type Track = CollectionEntry<"courses">;
export type Lesson = CollectionEntry<"lessons">;

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

export type TrackStats = {
  lessonCount: number;
  totalMinutes: number;
  termCount: number;
};

export function trackStats(trackSlug: string, lessons: Lesson[]): TrackStats {
  return {
    lessonCount: lessons.length,
    totalMinutes: lessons.reduce((sum, lesson) => sum + lesson.data.minutes, 0),
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
