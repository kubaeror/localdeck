import { useContext } from 'react';
import {
  LocalStackStatusContext,
  type UseLocalStackStatusResult,
} from '../contexts/localstack-status-context';

export type {
  ConnectionPhase,
  LocalStackStatusState,
  UseLocalStackStatusResult,
} from '../contexts/localstack-status-context';

/**
 * Live LocalStack status (endpoint, region, per-service states) polled by
 * `<LocalStackStatusProvider>`.
 */
export function useLocalStackStatus(): UseLocalStackStatusResult {
  const value = useContext(LocalStackStatusContext);
  if (value === null) {
    throw new Error('useLocalStackStatus must be used inside <LocalStackStatusProvider>.');
  }
  return value;
}
