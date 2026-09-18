import { createContext } from 'react';

export interface GlobalSearchContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const GlobalSearchContext = createContext<GlobalSearchContextValue | null>(null);

/** True on Apple platforms, where the console shows Cmd instead of Ctrl. */
function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = navigator.platform ?? '';
  return /mac|iphone|ipad|ipod/i.test(platform) || /Mac OS X/i.test(navigator.userAgent);
}

/**
 * Keyboard shortcut that opens the console service search. The handler accepts
 * Ctrl+/ and Cmd+/; the label matches the platform the console runs on.
 */
export const GLOBAL_SEARCH_SHORTCUT_LABEL = isApplePlatform() ? 'Cmd+/' : 'Ctrl+/';

/** True for Ctrl+/ and Cmd+/. */
export function isGlobalSearchShortcut(event: KeyboardEvent): boolean {
  return event.key === '/' && (event.ctrlKey || event.metaKey);
}
