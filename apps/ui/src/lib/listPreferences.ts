/**
 * Per-list page-size and visible-column preferences. Service modules opt in
 * by passing a `preferencesId` to `ResourceListPage`; the confirmed values are
 * stored per browser under that key and validated on the way back in, so a
 * corrupted or stale local storage entry can never break a list page.
 */

export interface ListPagePreferences {
  pageSize?: number;
  visibleContent?: readonly string[];
}

const STORAGE_PREFIX = 'localdeck.list-preferences.';

function storageKey(preferencesId: string): string {
  return `${STORAGE_PREFIX}${preferencesId}`;
}

/** Reads and validates the stored preferences; malformed data is ignored. */
export function readListPreferences(preferencesId: string): ListPagePreferences {
  try {
    const raw = window.localStorage.getItem(storageKey(preferencesId));
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const record = parsed as Record<string, unknown>;

    const preferences: ListPagePreferences = {};
    if (
      typeof record.pageSize === 'number' &&
      Number.isInteger(record.pageSize) &&
      record.pageSize > 0
    ) {
      preferences.pageSize = record.pageSize;
    }
    if (Array.isArray(record.visibleContent)) {
      const ids = record.visibleContent.filter(
        (entry): entry is string => typeof entry === 'string' && entry.length > 0,
      );
      if (ids.length > 0) preferences.visibleContent = ids;
    }
    return preferences;
  } catch {
    return {};
  }
}

/** Persists preferences; storage failures are best effort, never fatal. */
export function writeListPreferences(
  preferencesId: string,
  preferences: ListPagePreferences,
): void {
  try {
    window.localStorage.setItem(storageKey(preferencesId), JSON.stringify(preferences));
  } catch {
    // Preference persistence is best effort (private mode, quota).
  }
}

/** Removes stored preferences, for tests and explicit resets. */
export function clearListPreferences(preferencesId: string): void {
  try {
    window.localStorage.removeItem(storageKey(preferencesId));
  } catch {
    // Same as above: nothing to recover from.
  }
}
