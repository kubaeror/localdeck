import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { GlobalSearchPalette } from '../components/GlobalSearchPalette';
import {
  GlobalSearchContext,
  isGlobalSearchShortcut,
  type GlobalSearchContextValue,
} from './global-search-context';

/**
 * Owns the global service search: the Ctrl+/ shortcut, the palette state and
 * the palette itself, so any page can call `open()` without owning a dialog.
 */
export function GlobalSearchProvider({ children }: { children: ReactNode }): ReactElement {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => {
    setIsOpen(true);
  }, []);
  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isGlobalSearchShortcut(event)) return;
      event.preventDefault();
      setIsOpen((previous) => !previous);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const value = useMemo<GlobalSearchContextValue>(
    () => ({ isOpen, open, close }),
    [isOpen, open, close],
  );

  return (
    <GlobalSearchContext.Provider value={value}>
      {children}
      {isOpen ? <GlobalSearchPalette onDismiss={close} /> : null}
    </GlobalSearchContext.Provider>
  );
}
