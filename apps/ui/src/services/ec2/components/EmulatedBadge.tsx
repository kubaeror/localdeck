import Badge from '@cloudscape-design/components/badge';
import { InfoTooltip } from '../../../components/InfoTooltip';
import type { ReactElement } from 'react';

export interface EmulatedBadgeProps {
  /** What LocalStack emulates for this resource, in one sentence. */
  detail?: string;
}

/**
 * The persistent "Emulated" badge EC2 detail pages carry: LocalStack runs a
 * mock control plane, so every value on the page describes the emulator's
 * in-memory state, not real hardware. It lives in the page header, which is why
 * it stays visible on every tab.
 */
export function EmulatedBadge({ detail }: EmulatedBadgeProps): ReactElement {
  return (
    <InfoTooltip
      content={
        detail ??
        'LocalStack emulates this resource in memory. No real compute, networking or storage is provisioned, and the state lives only for this LocalStack session.'
      }
    >
      <Badge color="grey">Emulated</Badge>
    </InfoTooltip>
  );
}

export default EmulatedBadge;
