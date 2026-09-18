import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  RECENTLY_VISITED_LIMIT,
  RecentlyVisitedContext,
  type VisitedService,
} from './recently-visited-context';
import { persistRecentlyVisited, readStoredRecentlyVisited } from './recently-visited-storage';

/** Keeps the "Recently visited" console widget in sync with localStorage. */
export function RecentlyVisitedProvider({ children }: { children: ReactNode }): ReactElement {
  const [visited, setVisited] = useState<readonly VisitedService[]>(readStoredRecentlyVisited);

  useEffect(() => {
    persistRecentlyVisited(visited);
  }, [visited]);

  const record = useCallback((serviceId: string): void => {
    setVisited((previous) => {
      if (previous[0]?.id === serviceId) return previous;
      const next: VisitedService[] = [
        { id: serviceId, visitedAt: new Date().toISOString() },
        ...previous.filter((entry) => entry.id !== serviceId),
      ];
      return next.slice(0, RECENTLY_VISITED_LIMIT);
    });
  }, []);

  const clear = useCallback((): void => {
    setVisited([]);
  }, []);

  const value = useMemo(() => ({ visited, record, clear }), [visited, record, clear]);

  return (
    <RecentlyVisitedContext.Provider value={value}>{children}</RecentlyVisitedContext.Provider>
  );
}
