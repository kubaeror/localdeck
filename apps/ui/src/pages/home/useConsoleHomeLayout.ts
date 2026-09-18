import { useCallback, useEffect, useState } from 'react';
import type { ConsoleWidgetId, ConsoleWidgetItem } from './types';

const LAYOUT_STORAGE_KEY = 'localdeck.console-home.layout';

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
      restored.push({
        ...fallback,
        ...(typeof record.columnSpan === 'number' ? { columnSpan: record.columnSpan } : {}),
        ...(typeof record.rowSpan === 'number' ? { rowSpan: record.rowSpan } : {}),
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
      const compact = items.map((item) => ({
        id: item.id,
        columnSpan: item.columnSpan,
        rowSpan: item.rowSpan,
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
