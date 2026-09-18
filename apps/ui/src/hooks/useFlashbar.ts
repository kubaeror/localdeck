import { useContext } from 'react';
import { FlashbarContext, type FlashbarContextValue } from '../contexts/flashbar-context';

/**
 * App-wide notifications. Anything that finishes asynchronously (a create
 * wizard, a refresh, a destructive action) reports its outcome here instead of
 * building its own flashbar.
 */
export function useFlashbar(): FlashbarContextValue {
  const value = useContext(FlashbarContext);
  if (value === null) {
    throw new Error('useFlashbar must be used inside <FlashbarProvider>.');
  }
  return value;
}
