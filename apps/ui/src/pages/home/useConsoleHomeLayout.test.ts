import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CONSOLE_HOME_LAYOUT_STORAGE_KEY,
  DEFAULT_CONSOLE_WIDGETS,
  useConsoleHomeLayout,
} from './useConsoleHomeLayout';

function storedLayout(): unknown {
  const raw = window.localStorage.getItem(CONSOLE_HOME_LAYOUT_STORAGE_KEY);
  return raw === null ? null : (JSON.parse(raw) as unknown);
}

describe('useConsoleHomeLayout', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('starts from the default Console Home layout', () => {
    const { result } = renderHook(() => useConsoleHomeLayout());

    expect(result.current.items.map((item) => item.id)).toEqual(
      DEFAULT_CONSOLE_WIDGETS.map((item) => item.id),
    );
  });

  it('round-trips spans, column offsets and item order', () => {
    const { result, unmount } = renderHook(() => useConsoleHomeLayout());

    act(() => {
      result.current.onItemsChange([
        {
          ...DEFAULT_CONSOLE_WIDGETS[2]!,
          columnSpan: 3,
          columnOffset: { 6: 3 },
        },
        {
          ...DEFAULT_CONSOLE_WIDGETS[0]!,
          rowSpan: 2,
          columnOffset: { 4: 2, 6: 1 },
        },
      ]);
    });

    const persisted = storedLayout();
    expect(persisted).toEqual([
      expect.objectContaining({ id: 'quick-actions', columnSpan: 3, columnOffset: { 6: 3 } }),
      expect.objectContaining({
        id: 'recently-visited',
        rowSpan: 2,
        columnOffset: { 4: 2, 6: 1 },
      }),
    ]);

    // A reload restores the same layout, offsets included.
    unmount();
    const restored = renderHook(() => useConsoleHomeLayout());
    expect(restored.result.current.items.map((item) => item.id)).toEqual([
      'quick-actions',
      'recently-visited',
    ]);
    expect(restored.result.current.items[0]?.columnOffset).toEqual({ 6: 3 });
    expect(restored.result.current.items[1]?.columnOffset).toEqual({ 4: 2, 6: 1 });
  });

  it('drops offsets and spans that violate the widget definitions', () => {
    window.localStorage.setItem(
      CONSOLE_HOME_LAYOUT_STORAGE_KEY,
      JSON.stringify([
        {
          id: 'service-health',
          // minColumnSpan is 2: a span below it is ignored.
          columnSpan: 1,
          rowSpan: 3,
          // An offset that leaves no room for the minimum span is ignored.
          columnOffset: { 6: 5, 4: 1 },
        },
        {
          id: 'quick-actions',
          columnOffset: { 6: 2.5, 4: -1, 0: 0, '6_bad': 0 },
        },
        { id: 'not-a-widget' },
        'nope',
      ]),
    );

    const { result } = renderHook(() => useConsoleHomeLayout());
    const [health, quick] = result.current.items;

    // The invalid span fell back to the definition default.
    expect(health?.columnSpan).toBe(DEFAULT_CONSOLE_WIDGETS[1]!.columnSpan);
    expect(health?.rowSpan).toBe(3);
    // {4: 1} fits (min span 2 on a 4 column layout), {6: 5} does not.
    expect(health?.columnOffset).toEqual({ 4: 1 });
    expect(quick?.columnOffset).toBeUndefined();
  });

  it('falls back to defaults for malformed storage and resets on demand', () => {
    window.localStorage.setItem(CONSOLE_HOME_LAYOUT_STORAGE_KEY, '{"not":"an array"}');
    const { result } = renderHook(() => useConsoleHomeLayout());
    expect(result.current.items).toHaveLength(DEFAULT_CONSOLE_WIDGETS.length);

    act(() => {
      result.current.onItemsChange([{ ...DEFAULT_CONSOLE_WIDGETS[0]! }]);
    });
    expect(result.current.items).toHaveLength(1);

    act(() => {
      result.current.reset();
    });
    expect(result.current.items).toHaveLength(DEFAULT_CONSOLE_WIDGETS.length);
  });
});
