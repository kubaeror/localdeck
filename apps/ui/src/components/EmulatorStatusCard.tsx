import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import type { ReactElement } from 'react';
import type { EmulatorStatusResult } from '../hooks/useEmulatorStatus';
import { formatAvailability, formatLatency, formatRelativeTime } from '../lib/format';
import { ConnectionStatusIndicator } from './ConnectionStatusIndicator';

function unknownValue(): ReactElement {
  return <Box color="text-status-inactive">unknown</Box>;
}

export interface EmulatorStatusCardProps {
  status: EmulatorStatusResult;
}

/** The status widget: which emulator/endpoint/region this console is bound to. */
export function EmulatorStatusCard({ status }: EmulatorStatusCardProps): ReactElement {
  const { config, health } = status;
  const lastCheckedAt = status.lastCheckedAt;
  const providerLabel =
    health?.provider.providerLabel ?? config?.emulator.providerLabel ?? 'Emulator';
  const ready = health?.emulator.ready ?? null;

  return (
    <Container
      header={
        <Header
          variant="h2"
          description={`${providerLabel} is managed outside LocalDeck; this console only reads it.`}
        >
          {providerLabel} connection
        </Header>
      }
    >
      <KeyValuePairs
        columns={3}
        items={[
          { label: 'Connection', value: <ConnectionStatusIndicator phase={status.phase} /> },
          {
            label: 'Provider',
            value: health ? (
              <Box>
                {providerLabel}
                {health.provider.edition !== null ? ` (${health.provider.edition})` : ''}
              </Box>
            ) : config ? (
              <Box>{config.emulator.providerLabel}</Box>
            ) : (
              unknownValue()
            ),
          },
          {
            label: 'Endpoint',
            value: config ? <Box variant="code">{config.emulator.endpoint}</Box> : unknownValue(),
          },
          {
            label: 'Region',
            value: config ? <Box variant="code">{config.emulator.region}</Box> : unknownValue(),
          },
          {
            label: 'Version',
            value: health ? (
              <Box>
                {health.provider.version ?? 'unknown'}
                {health.provider.edition !== null ? ` (${health.provider.edition})` : ''}
              </Box>
            ) : (
              unknownValue()
            ),
          },
          {
            label: 'Health check latency',
            value: health ? <Box>{formatLatency(health.latencyMs)}</Box> : unknownValue(),
          },
          {
            label: 'Last checked',
            value: lastCheckedAt ? <Box>{formatRelativeTime(lastCheckedAt)}</Box> : unknownValue(),
          },
          {
            label: 'Enabled services',
            value: health ? (
              <Box>
                {formatAvailability(health.emulator.counts.enabled, health.emulator.counts.total)}
                {health.emulator.counts.disabled > 0
                  ? ` · ${health.emulator.counts.disabled} disabled`
                  : ''}
              </Box>
            ) : (
              unknownValue()
            ),
          },
          ...(ready === null
            ? []
            : [
                {
                  label: 'Init scripts',
                  value: (
                    <Box>
                      {ready.status} ({ready.completed}/{ready.total}
                      {ready.failed > 0 ? `, ${ready.failed} failed` : ''})
                    </Box>
                  ),
                },
              ]),
          {
            label: 'LocalDeck api',
            value: config ? (
              <Box>
                {config.application.name} {config.application.version} (
                {config.application.environment})
              </Box>
            ) : (
              unknownValue()
            ),
          },
          {
            label: 'Status source',
            value: config ? (
              <Box variant="code">{config.emulator.healthPaths.join(', ')}</Box>
            ) : (
              unknownValue()
            ),
          },
        ]}
      />
    </Container>
  );
}
