import { useContext } from 'react';
import {
  GlobalSearchContext,
  type GlobalSearchContextValue,
} from '../contexts/global-search-context';

/** Opens the global service search (Ctrl+/). */
export function useGlobalSearch(): GlobalSearchContextValue {
  const value = useContext(GlobalSearchContext);
  if (value === null) {
    throw new Error('useGlobalSearch must be used inside <GlobalSearchProvider>.');
  }
  return value;
}
