import { createContext } from 'react';

export interface VisitedService {
  id: string;
  visitedAt: string;
}

export interface RecentlyVisitedContextValue {
  /** Most recently visited service first. */
  visited: readonly VisitedService[];
  record: (serviceId: string) => void;
  clear: () => void;
}

export const RecentlyVisitedContext = createContext<RecentlyVisitedContextValue | null>(null);

export const RECENTLY_VISITED_STORAGE_KEY = 'localdeck.recently-visited';
export const RECENTLY_VISITED_LIMIT = 6;
