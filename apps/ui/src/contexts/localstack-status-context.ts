import type { ApiConfigResponse, ApiError, HealthResponse } from '@localdeck/shared';
import { createContext } from 'react';

export type ConnectionPhase = 'loading' | 'connected' | 'degraded' | 'unreachable' | 'error';

export interface LocalStackStatusState {
  phase: ConnectionPhase;
  config: ApiConfigResponse | null;
  health: HealthResponse | null;
  error: ApiError | null;
  lastCheckedAt: string | null;
}

export interface UseLocalStackStatusResult extends LocalStackStatusState {
  refresh: () => void;
}

export const LocalStackStatusContext = createContext<UseLocalStackStatusResult | null>(null);
