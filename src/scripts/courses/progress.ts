const KEY = "courses:progress:v1";

export type TrackProgress = {
  /** Highest lesson order the reader has opened. */
  furthest: number;
  completed: number[];
};

type Store = Record<string, TrackProgress>;

/**
 * Every accessor is guarded: private windows, blocked site data, and prerender
 * passes all make localStorage throw rather than return empty.
 */
function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Store;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* storage unavailable — progress is a convenience, not state we depend on */
  }
}

export function trackProgress(track: string): TrackProgress {
  const entry = read()[track];
  return {
    furthest: entry?.furthest ?? 0,
    completed: Array.isArray(entry?.completed) ? entry.completed : [],
  };
}

/** Records a visit. `furthest` only ever grows, so revisiting lesson 2 never re-locks the glossary. */
export function markVisited(track: string, order: number): TrackProgress {
  const store = read();
  const current = trackProgress(track);
  const next: TrackProgress = {
    furthest: Math.max(current.furthest, order),
    completed: current.completed,
  };
  store[track] = next;
  write(store);
  return next;
}

export function markCompleted(track: string, order: number, done: boolean): TrackProgress {
  const store = read();
  const current = trackProgress(track);
  const completed = new Set(current.completed);
  if (done) completed.add(order);
  else completed.delete(order);
  const next: TrackProgress = {
    furthest: Math.max(current.furthest, order),
    completed: [...completed].sort((a, b) => a - b),
  };
  store[track] = next;
  write(store);
  return next;
}

export function resetTrack(track: string): void {
  const store = read();
  delete store[track];
  write(store);
}
