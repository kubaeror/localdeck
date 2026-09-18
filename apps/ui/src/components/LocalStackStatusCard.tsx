import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import type { ReactElement } from 'react';
import type { UseLocalStackStatusResult } from '../hooks/useLocalStackStatus';
import { formatAvailability, formatLatency, formatRelativeTime } from '../lib/format';

function connectionIndicator(status: UseLocalStackStatusResult): ReactElement {
  switch (status.phase) {
    case 'connected':
      return <StatusIndicator type="success">Connected</StatusIndicator>;
    case 'degraded':
      return <StatusIndicator type="warning">Connected, degraded</StatusIndicator>;
    case 'unreachable':
      return <StatusIndicator type="error">LocalStack unreachable</StatusIndicator>;
    case 'error':
      return <StatusIndicator type="error">LocalDeck api error</StatusIndicator>;
    default:
      return <StatusIndicator type="in-progress">Checking</StatusIndicator>;
  }
}

function unknownValue(): ReactElement {
  return <Box color="text-status-inactive">unknown</Box>;
}

export interface LocalStackStatusCardProps {
  status: UseLocalStackStatusResult;
}

/** The status widget: which endpoint/region this console is bound to. */
export function LocalStackStatusCard({ status }: LocalStackStatusCardProps): ReactElement {
  const { config, health } = status;
  const lastCheckedAt = status.lastCheckedAt;

  return (
    <Container
      header={
        <Header
          variant="h2"
          description="LocalStack is managed outside LocalDeck; this console only reads it."
        >
          LocalStack connection
        </Header>
      }
    >
      <KeyValuePairs
        columns={3}
        items={[
          { label: 'Connection', value: connectionIndicator(status) },
          {
            label: 'Endpoint',
            value: config ? <Box variant="code">{config.localstack.endpoint}</Box> : unknownValue(),
          },
          {
            label: 'Region',
            value: config ? <Box variant="code">{config.localstack.region}</Box> : unknownValue(),
          },
          {
            label: 'LocalStack version',
            value: health ? (
              <Box>
                {health.localstack.version ?? 'unknown'}
                {health.localstack.edition !== null ? ` (${health.localstack.edition})` : ''}
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
            label: 'Emulated services',
            value: health ? (
              <Box>
                {formatAvailability(
                  health.localstack.counts.available,
                  health.localstack.counts.total,
                )}
              </Box>
            ) : (
              unknownValue()
            ),
          },
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
              <Box variant="code">{config.localstack.healthPath}</Box>
            ) : (
              unknownValue()
            ),
          },
        ]}
      />
    </Container>
  );
}
