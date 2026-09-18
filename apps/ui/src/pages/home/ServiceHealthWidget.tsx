import { BoardItem } from '@cloudscape-design/board-components';
import { summarizeRegistryCoverage } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useMemo, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocalStackStatus } from '../../hooks/useLocalStackStatus';
import { useServiceCatalog } from '../../hooks/useServiceCatalog';
import { formatAvailability, formatLatency, formatRelativeTime } from '../../lib/format';
import { ALL_SERVICES_PATH, SERVICE_HEALTH_PATH } from '../../services/paths';
import { BOARD_ITEM_I18N_STRINGS, type ConsoleWidgetProps } from './types';
import { WidgetSettingsMenu } from './WidgetSettingsMenu';

function connectionIndicator(phase: string): ReactElement {
  switch (phase) {
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

/** Console Home widget: the live stack status straight from /api/health. */
export function ServiceHealthWidget({ onRemove }: ConsoleWidgetProps): ReactElement {
  const navigate = useNavigate();
  const status = useLocalStackStatus();
  const catalog = useServiceCatalog();
  const { config, health } = status;
  const counts = health?.localstack.counts;
  const coverage = useMemo(
    () => summarizeRegistryCoverage(health?.localstack.services ?? {}, catalog.services),
    [health, catalog.services],
  );

  return (
    <BoardItem
      header={
        <Header
          variant="h2"
          description="Live from the LocalStack health endpoint."
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                iconName="refresh"
                ariaLabel="Refresh LocalStack status"
                loading={status.phase === 'loading'}
                onClick={() => {
                  status.refresh();
                }}
              >
                Refresh
              </Button>
            </SpaceBetween>
          }
        >
          Service health
        </Header>
      }
      settings={<WidgetSettingsMenu onRemove={onRemove} />}
      i18nStrings={BOARD_ITEM_I18N_STRINGS}
    >
      <SpaceBetween size="s">
        {status.phase === 'unreachable' || status.phase === 'error' ? (
          <Alert
            type="error"
            header={
              status.phase === 'unreachable'
                ? 'LocalStack is not reachable'
                : 'The LocalDeck api returned an error'
            }
            action={
              <Button
                onClick={() => {
                  status.refresh();
                }}
              >
                Retry
              </Button>
            }
          >
            {status.error?.message ?? 'The status could not be loaded.'}
          </Alert>
        ) : null}

        <KeyValuePairs
          columns={1}
          items={[
            { label: 'Connection', value: connectionIndicator(status.phase) },
            {
              label: 'Endpoint',
              value: <Box variant="code">{config?.localstack.endpoint ?? 'loading…'}</Box>,
            },
            {
              label: 'Region',
              value: <Box variant="code">{config?.localstack.region ?? 'loading…'}</Box>,
            },
            {
              label: 'Stack',
              value: health ? (
                <Box>
                  {health.localstack.version ?? 'unknown'} ({health.localstack.edition ?? 'unknown'}
                  )
                </Box>
              ) : (
                <Box color="text-status-inactive">unknown</Box>
              ),
            },
            {
              label: 'Emulated services',
              value:
                counts === undefined ? (
                  <Box color="text-status-inactive">unknown</Box>
                ) : (
                  <Box>{formatAvailability(counts.available, counts.total)}</Box>
                ),
            },
            {
              label: 'Registry coverage',
              value:
                health === null ? (
                  <Box color="text-status-inactive">unknown</Box>
                ) : (
                  <Box>
                    {coverage.emulated} of {coverage.registered} registered services
                    {coverage.unregistered.length === 0
                      ? ''
                      : ` · ${coverage.unregistered.length} stack services without a console entry`}
                  </Box>
                ),
            },
            {
              label: 'Last checked',
              value:
                status.lastCheckedAt === null ? (
                  <Box color="text-status-inactive">never</Box>
                ) : (
                  <Box>
                    {formatRelativeTime(status.lastCheckedAt)}
                    {health === null ? '' : ` · ${formatLatency(health.latencyMs)}`}
                  </Box>
                ),
            },
          ]}
        />

        <Link
          href={SERVICE_HEALTH_PATH}
          onFollow={(event) => {
            event.preventDefault();
            navigate(SERVICE_HEALTH_PATH);
          }}
        >
          View service health
        </Link>
        <Link
          href={ALL_SERVICES_PATH}
          onFollow={(event) => {
            event.preventDefault();
            navigate(ALL_SERVICES_PATH);
          }}
        >
          Compare the registry with this stack
        </Link>
      </SpaceBetween>
    </BoardItem>
  );
}
