import type { ServiceParityLevel } from '@localdeck/shared';

/**
 * Console wording for a registry parity level. Single source so the All
 * services table and the placeholder page cannot disagree.
 */
export const PARITY_LABELS: Readonly<Record<ServiceParityLevel, string>> = {
  dedicated: 'Dedicated console',
  browser: 'Resource browser',
  planned: 'Planned',
};

/** Badge colors that match the parity wording. */
export const PARITY_COLORS: Readonly<Record<ServiceParityLevel, 'blue' | 'green' | 'grey'>> = {
  dedicated: 'blue',
  browser: 'green',
  planned: 'grey',
};
