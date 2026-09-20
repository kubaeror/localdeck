import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { ReactElement } from 'react';
import { ConnectionStatusIndicator } from '../components/ConnectionStatusIndicator';
import { GLOBAL_SEARCH_SHORTCUT_LABEL } from '../contexts/global-search-context';
import { useEmulatorStatus } from '../hooks/useEmulatorStatus';
import { useServiceCatalog } from '../hooks/useServiceCatalog';
import { formatAvailability, formatLatency, formatRelativeTime } from '../lib/format';

export interface ConsoleHelpModalProps {
  visible: boolean;
  onDismiss: () => void;
}

/** "About this console": live endpoint details, shortcuts and the notice. */
export function ConsoleHelpModal({ visible, onDismiss }: ConsoleHelpModalProps): ReactElement {
  const status = useEmulatorStatus();
  const catalog = useServiceCatalog();
  const { config, health } = status;
  const providerLabel =
    health?.provider.providerLabel ?? config?.emulator.providerLabel ?? 'Emulator';

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
              label: 'Provider',
              value: health ? (
                <Box>
                  {providerLabel}
                  {health.provider.edition === null ? '' : ` (${health.provider.edition})`}
                </Box>
              ) : (
                <Box color="text-status-inactive">unknown</Box>
              ),
            },
            {
              label: 'Version',
              value: health ? (
                <Box>{health.provider.version ?? 'unknown'}</Box>
              ) : (
                <Box color="text-status-inactive">unknown</Box>
              ),
            },
            {
              label: 'Connection',
              value: (
                <ConnectionStatusIndicator phase={status.phase} providerLabel={providerLabel} />
              ),
            },
            {
              label: 'Endpoint',
              value: <Box variant="code">{config?.emulator.endpoint ?? 'loading…'}</Box>,
            },
            {
              label: 'Region',
              value: <Box variant="code">{config?.emulator.region ?? 'loading…'}</Box>,
            },
            {
              label: 'Health check',
              value: health ? (
                <Box>
                  {formatLatency(health.latencyMs)} ·{' '}
                  {formatAvailability(health.emulator.counts.enabled, health.emulator.counts.total)}
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
