import { useCallback, useEffect, useState } from 'react';
import type { ConsoleWidgetId, ConsoleWidgetItem } from './types';

/** Exported so tests can assert the persisted shape without duplicating it. */
export const CONSOLE_HOME_LAYOUT_STORAGE_KEY = 'localdeck.console-home.layout';

const LAYOUT_STORAGE_KEY = CONSOLE_HOME_LAYOUT_STORAGE_KEY;

/** Grid span that a widget can never shrink below its definition. */
function isSpan(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum;
}

/**
 * Column offsets are a per-layout mapping (`{ [columns]: offset }`). An entry
 * is kept only when it is a non-negative integer and the widget's minimum span
 * still fits on that layout; anything else is dropped rather than handed to
 * the board. (Rows have no offset in the Cloudscape board: vertical placement
 * is the item order, which is part of the persisted layout.)
 */
function readColumnOffsets(
  value: unknown,
  minColumnSpan: number,
): { [columns: number]: number } | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const offsets: { [columns: number]: number } = {};
  for (const [key, offset] of Object.entries(value)) {
    const columns = Number(key);
    if (!Number.isInteger(columns) || columns <= 0) continue;
    if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) continue;
    if (offset + minColumnSpan > columns) continue;
    offsets[columns] = offset;
  }
  return Object.keys(offsets).length === 0 ? undefined : offsets;
}

/** The layout Console Home starts from. Spans live on a 6 column grid. */
export const DEFAULT_CONSOLE_WIDGETS: readonly ConsoleWidgetItem[] = [
  {
    id: 'recently-visited',
    data: { widget: 'recently-visited' },
    columnSpan: 2,
    rowSpan: 4,
    definition: { minColumnSpan: 1, minRowSpan: 2, defaultColumnSpan: 2, defaultRowSpan: 4 },
  },
  {
    id: 'service-health',
    data: { widget: 'service-health' },
    columnSpan: 2,
    rowSpan: 4,
    definition: { minColumnSpan: 2, minRowSpan: 2, defaultColumnSpan: 2, defaultRowSpan: 4 },
  },
  {
    id: 'quick-actions',
    data: { widget: 'quick-actions' },
    columnSpan: 2,
    rowSpan: 4,
    definition: { minColumnSpan: 1, minRowSpan: 2, defaultColumnSpan: 2, defaultRowSpan: 4 },
  },
];

const WIDGET_IDS: readonly ConsoleWidgetId[] = [
  'recently-visited',
  'service-health',
  'quick-actions',
];

function isWidgetId(value: unknown): value is ConsoleWidgetId {
  return typeof value === 'string' && (WIDGET_IDS as readonly string[]).includes(value);
}

function readStoredLayout(): readonly ConsoleWidgetItem[] {
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (raw === null) return DEFAULT_CONSOLE_WIDGETS;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_CONSOLE_WIDGETS;

    const restored: ConsoleWidgetItem[] = [];
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue;
      const record = entry as Record<string, unknown>;
      if (!isWidgetId(record.id)) continue;
      const fallback = DEFAULT_CONSOLE_WIDGETS.find((item) => item.id === record.id);
      if (fallback === undefined) continue;
      const minColumnSpan = fallback.definition?.minColumnSpan ?? 1;
      const minRowSpan = fallback.definition?.minRowSpan ?? 1;
      const columnOffset = readColumnOffsets(record.columnOffset, minColumnSpan);
      restored.push({
        ...fallback,
        ...(isSpan(record.columnSpan, minColumnSpan) ? { columnSpan: record.columnSpan } : {}),
        ...(isSpan(record.rowSpan, minRowSpan) ? { rowSpan: record.rowSpan } : {}),
        ...(columnOffset === undefined ? {} : { columnOffset }),
      });
    }
    return restored;
  } catch {
    return DEFAULT_CONSOLE_WIDGETS;
  }
}

export interface ConsoleHomeLayout {
  items: readonly ConsoleWidgetItem[];
  onItemsChange: (items: readonly ConsoleWidgetItem[]) => void;
  reset: () => void;
}

/** Board state for Console Home, persisted so the layout survives reloads. */
export function useConsoleHomeLayout(): ConsoleHomeLayout {
  const [items, setItems] = useState<readonly ConsoleWidgetItem[]>(readStoredLayout);

  useEffect(() => {
    try {
      // The full Cloudscape configurable-dashboard pattern: spans, column
      // offsets and (through the item order) row placement, so widgets come
      // back where they were left.
      const compact = items.map((item) => ({
        id: item.id,
        columnSpan: item.columnSpan,
        rowSpan: item.rowSpan,
        columnOffset: item.columnOffset,
      }));
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(compact));
    } catch {
      // Persisting the layout is best effort.
    }
  }, [items]);

  const onItemsChange = useCallback((next: readonly ConsoleWidgetItem[]): void => {
    setItems(next);
  }, []);

  const reset = useCallback((): void => {
    setItems(DEFAULT_CONSOLE_WIDGETS);
  }, []);

  return { items, onItemsChange, reset };
}
