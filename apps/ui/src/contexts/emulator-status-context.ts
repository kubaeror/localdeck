import type { ApiConfigResponse, ApiError, HealthResponse } from '@localdeck/shared';
import { createContext } from 'react';

export type ConnectionPhase = 'loading' | 'connected' | 'degraded' | 'unreachable' | 'error';

export interface EmulatorStatusState {
  phase: ConnectionPhase;
  config: ApiConfigResponse | null;
  health: HealthResponse | null;
  error: ApiError | null;
  lastCheckedAt: string | null;
}

export interface EmulatorStatusResult extends EmulatorStatusState {
  refresh: () => void;
}

export const EmulatorStatusContext = createContext<EmulatorStatusResult | null>(null);
