import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import type { ReactElement } from 'react';
import { GLOBAL_SEARCH_SHORTCUT_LABEL } from '../contexts/global-search-context';
import { useLocalStackStatus } from '../hooks/useLocalStackStatus';
import { useServiceCatalog } from '../hooks/useServiceCatalog';
import { formatAvailability, formatLatency, formatRelativeTime } from '../lib/format';

export interface ConsoleHelpModalProps {
  visible: boolean;
  onDismiss: () => void;
}

/** "About this console": live endpoint details, shortcuts and the notice. */
export function ConsoleHelpModal({ visible, onDismiss }: ConsoleHelpModalProps): ReactElement {
  const status = useLocalStackStatus();
  const catalog = useServiceCatalog();
  const { config, health } = status;

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      size="medium"
      header="About LocalDeck"
      closeAriaLabel="Close"
      footer={
        <Box float="right">
          <Button variant="primary" onClick={onDismiss}>
            Close
          </Button>
        </Box>
      }
    >
      <SpaceBetween size="l">
        <KeyValuePairs
          columns={2}
          items={[
            {
              label: 'LocalStack',
              value: health ? (
                <Box>
                  {health.localstack.version ?? 'unknown'}
                  {health.localstack.edition === null ? '' : ` (${health.localstack.edition})`}
                </Box>
              ) : (
                <Box color="text-status-inactive">unknown</Box>
              ),
            },
            {
              label: 'Connection',
              value:
                status.phase === 'connected' ? (
                  <StatusIndicator type="success">Connected</StatusIndicator>
                ) : status.phase === 'degraded' ? (
                  <StatusIndicator type="warning">Connected, degraded</StatusIndicator>
                ) : status.phase === 'loading' ? (
                  <StatusIndicator type="in-progress">Checking</StatusIndicator>
                ) : (
                  <StatusIndicator type="error">Unreachable</StatusIndicator>
                ),
            },
            {
              label: 'Endpoint',
              value: <Box variant="code">{config?.localstack.endpoint ?? 'loading…'}</Box>,
            },
            {
              label: 'Region',
              value: <Box variant="code">{config?.localstack.region ?? 'loading…'}</Box>,
            },
            {
              label: 'Health check',
              value: health ? (
                <Box>
                  {formatLatency(health.latencyMs)} ·{' '}
                  {formatAvailability(
                    health.localstack.counts.available,
                    health.localstack.counts.total,
                  )}
                </Box>
              ) : (
                <Box color="text-status-inactive">unknown</Box>
              ),
            },
            {
              label: 'Last checked',
              value:
                status.lastCheckedAt === null ? (
                  <Box color="text-status-inactive">never</Box>
                ) : (
                  <Box>{formatRelativeTime(status.lastCheckedAt)}</Box>
                ),
            },
            {
              label: 'Service registry',
              value: (
                <Box>
                  {catalog.services.length} services (
                  {catalog.source === 'api' ? 'from the LocalDeck api' : 'bundled with the ui'})
                </Box>
              ),
            },
            {
              label: 'LocalDeck api',
              value: (
                <Box>
                  {config === null
                    ? 'loading…'
                    : `${config.application.name} ${config.application.version} (${config.application.environment})`}
                </Box>
              ),
            },
          ]}
        />

        <Box variant="h3">Keyboard shortcuts</Box>
        <KeyValuePairs
          columns={2}
          items={[
            {
              label: 'Search services',
              value: <Box variant="code">{GLOBAL_SEARCH_SHORTCUT_LABEL}</Box>,
            },
            { label: 'Search: next result', value: <Box variant="code">Arrow down</Box> },
            { label: 'Search: previous result', value: <Box variant="code">Arrow up</Box> },
            { label: 'Search: open result', value: <Box variant="code">Enter</Box> },
            { label: 'Close search or dialog', value: <Box variant="code">Escape</Box> },
          ]}
        />

        <Box variant="h3">Legal</Box>
        <Box variant="small" color="text-body-secondary">
          Amazon Web Services, AWS and the Powered by AWS logo are trademarks of Amazon.com, Inc. or
          its affiliates. LocalDeck is not affiliated with or endorsed by Amazon Web Services.
        </Box>
      </SpaceBetween>
    </Modal>
  );
}
