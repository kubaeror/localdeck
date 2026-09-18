import { BoardItem } from '@cloudscape-design/board-components';
import { summarizeRegistryCoverage } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useMemo, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConnectionStatusIndicator } from '../../components/ConnectionStatusIndicator';
import { RegistryCoverage } from '../../components/RegistryCoverage';
import { useLocalStackStatus } from '../../hooks/useLocalStackStatus';
import { useServiceCatalog } from '../../hooks/useServiceCatalog';
import {
  LOCALDECK_API_ERROR_TITLE,
  LOCALSTACK_UNREACHABLE_TITLE,
  STATUS_UNAVAILABLE_COPY,
} from '../../lib/copy';
import { formatAvailability, formatLatency, formatRelativeTime } from '../../lib/format';
import { ALL_SERVICES_PATH, SERVICE_HEALTH_PATH } from '../../services/paths';
import { BOARD_ITEM_I18N_STRINGS, type ConsoleWidgetProps } from './types';
import { WidgetSettingsMenu } from './WidgetSettingsMenu';

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
                ? LOCALSTACK_UNREACHABLE_TITLE
                : LOCALDECK_API_ERROR_TITLE
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
            {status.error?.message ?? STATUS_UNAVAILABLE_COPY}
          </Alert>
        ) : null}

        <KeyValuePairs
          columns={1}
          items={[
            { label: 'Connection', value: <ConnectionStatusIndicator phase={status.phase} /> },
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
                  <RegistryCoverage coverage={coverage} source={catalog.source} variant="summary" />
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
