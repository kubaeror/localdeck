import { useContext } from 'react';
import {
  EmulatorStatusContext,
  type EmulatorStatusResult,
} from '../contexts/emulator-status-context';

export type {
  ConnectionPhase,
  EmulatorStatusResult,
  EmulatorStatusState,
} from '../contexts/emulator-status-context';

/**
 * Live emulator status (provider, endpoint, region, per-service states) polled
 * by `<EmulatorStatusProvider>`.
 */
export function useEmulatorStatus(): EmulatorStatusResult {
  const value = useContext(EmulatorStatusContext);
  if (value === null) {
    throw new Error('useEmulatorStatus must be used inside <EmulatorStatusProvider>.');
  }
  return value;
}
