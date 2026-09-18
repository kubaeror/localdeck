import {
  RECENTLY_VISITED_LIMIT,
  RECENTLY_VISITED_STORAGE_KEY,
  type VisitedService,
} from './recently-visited-context';

function isVisitedService(value: unknown): value is VisitedService {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    typeof record.visitedAt === 'string' &&
    Number.isFinite(Date.parse(record.visitedAt))
  );
}

/** Reads the persisted trail, ignoring anything malformed or stale. */
export function readStoredRecentlyVisited(): readonly VisitedService[] {
  try {
    const raw = window.localStorage.getItem(RECENTLY_VISITED_STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isVisitedService).slice(0, RECENTLY_VISITED_LIMIT);
  } catch {
    // Private mode, quota errors and malformed JSON must never break the console.
    return [];
  }
}

/** Persists the trail; failures (private mode, quota) are ignored. */
export function persistRecentlyVisited(visited: readonly VisitedService[]): void {
  try {
    window.localStorage.setItem(RECENTLY_VISITED_STORAGE_KEY, JSON.stringify(visited));
  } catch {
    // Persisting is best effort; the in-memory trail still works.
  }
}
