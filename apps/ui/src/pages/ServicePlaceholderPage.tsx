import {
  resolveServiceStatus,
  serviceHealthKeys,
  type EmulatorServiceState,
  type ServiceDescriptor,
  type ServiceParityLevel,
} from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import List from '@cloudscape-design/components/list';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConsoleBreadcrumbs } from '../components/ConsoleBreadcrumbs';
import { EmptyState } from '../components/EmptyState';
import { StatusBadge } from '../components/StatusBadge';
import { useEmulatorStatus } from '../hooks/useEmulatorStatus';
import {
  disabledLabel,
  notReportedLabel,
  UNKNOWN_PROVIDER_LABEL,
  UNVERIFIED_SERVICE_LABEL,
} from '../lib/copy';
import { describeServiceStatus, formatRelativeTime } from '../lib/format';
import { PARITY_LABELS } from '../lib/parity';
import { ALL_SERVICES_PATH, CONSOLE_HOME_PATH, DEFAULT_EMULATOR_DOCS_URL } from '../services/paths';

const PARITY_EXPLANATION: Readonly<Record<ServiceParityLevel, string>> = {
  dedicated:
    'A dedicated module — resource list, resource details and a create wizard — is planned for this service.',
  browser:
    'This service is scheduled for the generic resource browser: LocalDeck drives it from the whitelisted operations below.',
  planned:
    'Only the registry entry exists so far: navigation, search and service health. Operations are not scheduled yet.',
};

export interface ServicePlaceholderPageProps {
  descriptor: ServiceDescriptor;
  /** Route the console could not render yet, for the empty-state copy. */
  routeTitle?: string;
}

/** One sentence explaining why this console cannot serve data yet. */
function unavailabilityCopy(
  state: EmulatorServiceState | undefined,
  providerLabel: string,
  hasServiceInventory: boolean,
): string {
  if (state === 'disabled') {
    return (
      `${providerLabel} knows this service but has it disabled in its configuration, so the ` +
      `entry is greyed out in the sidebar. Enable the service in ${providerLabel} to use this console.`
    );
  }
  if (state === 'error') {
    return `${providerLabel} reports this service in an error state. Check the emulator logs.`;
  }
  if (state === 'starting') {
    return `${providerLabel} is still starting this service; check again in a moment.`;
  }
  if (!hasServiceInventory) {
    return (
      'This endpoint exposes no service inventory, so LocalDeck cannot tell whether it implements ' +
      'this service. Operations are attempted and disabled if the endpoint rejects them.'
    );
  }
  return (
    `${providerLabel} does not report the service, so this entry is greyed out in the sidebar. ` +
    `LocalDeck never starts or reconfigures ${providerLabel}.`
  );
}

/**
 * Per-service placeholder used until a service module lands. It never fakes
 * data: everything shown here comes from the registry and the live health
 * document of the active emulator.
 */
export function ServicePlaceholderPage({
  descriptor,
  routeTitle,
}: ServicePlaceholderPageProps): ReactElement {
  const navigate = useNavigate();
  const status = useEmulatorStatus();

  const provider = status.health?.provider.provider ?? 'generic';
  const providerLabel = status.health?.provider.providerLabel ?? UNKNOWN_PROVIDER_LABEL;
  const hasServiceInventory = status.health?.emulator.hasServiceInventory ?? false;
  const docsUrl = status.health?.provider.docsUrl ?? DEFAULT_EMULATOR_DOCS_URL;
  const services = status.health?.emulator.services ?? {};
  const serviceStatus = resolveServiceStatus(descriptor, services, provider);
  const enabled = serviceStatus === 'enabled';

  const badgeLabel =
    serviceStatus === 'disabled'
      ? disabledLabel(providerLabel)
      : serviceStatus === undefined
        ? hasServiceInventory
          ? notReportedLabel(providerLabel)
          : UNVERIFIED_SERVICE_LABEL
        : undefined;

  return (
    <ContentLayout
      breadcrumbs={
        <ConsoleBreadcrumbs
          items={[
            { text: descriptor.displayName },
            ...(routeTitle === undefined || routeTitle === 'Overview'
              ? []
              : [{ text: routeTitle }]),
          ]}
        />
      }
      header={
        <Header
          variant="h1"
          description={descriptor.summary}
          actions={
            <Button href={docsUrl} target="_blank" external>
              API coverage
            </Button>
          }
        >
          {descriptor.displayName}
        </Header>
      }
    >
      <SpaceBetween size="l">
        {enabled ? null : (
          <Alert
            type={serviceStatus === 'error' ? 'error' : 'warning'}
            header={`${descriptor.displayName} is not available from ${providerLabel}`}
            action={
              <Button
                onClick={() => {
                  status.refresh();
                }}
                loading={status.phase === 'loading'}
              >
                Re-check
              </Button>
            }
          >
            {unavailabilityCopy(serviceStatus, providerLabel, hasServiceInventory)}
          </Alert>
        )}

        {descriptor.available === false ? (
          <Alert type="info" header="The LocalDeck api cannot proxy this service yet">
            The running api does not have the AWS SDK package for{' '}
            <Box variant="code">{descriptor.id}</Box> installed, so every operation would answer
            501. Install the package in <Box variant="code">apps/api</Box> and rebuild the api to
            browse it.
          </Alert>
        ) : null}

        <EmptyState
          iconKey={descriptor.iconKey}
          iconCategory={descriptor.category}
          title={`The ${descriptor.displayName} console is not implemented yet`}
          description={PARITY_EXPLANATION[descriptor.parityLevel]}
          action={
            <Button
              variant="primary"
              onClick={() => {
                navigate(CONSOLE_HOME_PATH);
              }}
            >
              Back to Console Home
            </Button>
          }
          secondaryAction={
            <Button
              onClick={() => {
                navigate(ALL_SERVICES_PATH);
              }}
            >
              All services
            </Button>
          }
          learnMore={{
            text: `${providerLabel} service documentation`,
            href: docsUrl,
          }}
        />

        <Container header={<Header variant="h2">Registry entry</Header>}>
          <KeyValuePairs
            columns={2}
            items={[
              { label: 'Category', value: <Box>{descriptor.category}</Box> },
              { label: 'Parity level', value: <Box>{PARITY_LABELS[descriptor.parityLevel]}</Box> },
              {
                label: `${providerLabel} status`,
                value:
                  serviceStatus === undefined ? (
                    <Box color="text-status-inactive">{badgeLabel}</Box>
                  ) : (
                    <StatusBadge status={serviceStatus} />
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
                label: 'AWS SDK package',
                value: <Box variant="code">{descriptor.sdkPackage}</Box>,
              },
              {
                label: `${providerLabel} health keys`,
                value: (
                  <Box variant="code">{serviceHealthKeys(descriptor, provider).join(', ')}</Box>
                ),
              },
            ]}
          />
        </Container>

        <Container
          header={
            <Header
              variant="h2"
              counter={`(${descriptor.operations.length})`}
              description="The LocalDeck api only proxies operations on this whitelist."
            >
              Whitelisted operations
            </Header>
          }
        >
          <List
            ariaLabel={`Whitelisted ${descriptor.displayName} operations`}
            items={[...descriptor.operations].sort((left, right) => left.localeCompare(right))}
            renderItem={(operation) => ({
              id: operation,
              content: <Box variant="code">{operation}</Box>,
            })}
          />
        </Container>

        {enabled ? (
          <Box color="text-body-secondary" variant="small">
            {providerLabel} reports this service as “{describeServiceStatus(serviceStatus)}”.
          </Box>
        ) : null}
      </SpaceBetween>
    </ContentLayout>
  );
}
