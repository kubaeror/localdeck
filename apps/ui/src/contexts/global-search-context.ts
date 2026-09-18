import { createContext } from 'react';

export interface GlobalSearchContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const GlobalSearchContext = createContext<GlobalSearchContextValue | null>(null);

/** Keyboard shortcut that opens the console service search. */
export const GLOBAL_SEARCH_SHORTCUT_LABEL = 'Ctrl+/';

/** True for Ctrl+/ and Cmd+/. */
export function isGlobalSearchShortcut(event: KeyboardEvent): boolean {
  return event.key === '/' && (event.ctrlKey || event.metaKey);
}
