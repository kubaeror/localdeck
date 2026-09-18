import { useContext } from 'react';
import {
  RecentlyVisitedContext,
  type RecentlyVisitedContextValue,
} from '../contexts/recently-visited-context';

/** The console's "Recently visited" trail. */
export function useRecentlyVisited(): RecentlyVisitedContextValue {
  const value = useContext(RecentlyVisitedContext);
  if (value === null) {
    throw new Error('useRecentlyVisited must be used inside <RecentlyVisitedProvider>.');
  }
  return value;
}
