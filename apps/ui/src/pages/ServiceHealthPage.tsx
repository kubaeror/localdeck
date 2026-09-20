import { resolveServiceStatus, summarizeRegistryCoverage } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import List from '@cloudscape-design/components/list';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConsoleBreadcrumbs } from '../components/ConsoleBreadcrumbs';
import { EmulatorStatusCard } from '../components/EmulatorStatusCard';
import { RegistryCoverage } from '../components/RegistryCoverage';
import { ServiceAvailabilityTable } from '../components/ServiceAvailabilityTable';
import { useEmulatorStatus } from '../hooks/useEmulatorStatus';
import { useServiceCatalog } from '../hooks/useServiceCatalog';
import {
  LOCALDECK_API_ERROR_TITLE,
  STATUS_UNAVAILABLE_COPY,
  UNKNOWN_PROVIDER_LABEL,
  unreachableTitle,
} from '../lib/copy';
import { formatServiceName } from '../lib/format';
import { ALL_SERVICES_PATH, serviceConsolePath } from '../services/paths';

/**
 * Service health: the emulator this console is bound to, what it reports right
 * now, and how the registry lines up with it.
 */
export function ServiceHealthPage(): ReactElement {
  const navigate = useNavigate();
  const status = useEmulatorStatus();
  const catalog = useServiceCatalog();

  const provider = status.health?.provider.provider ?? 'generic';
  const providerLabel =
    status.health?.provider.providerLabel ??
    status.config?.emulator.providerLabel ??
    UNKNOWN_PROVIDER_LABEL;
  const reported = status.health?.emulator.services ?? {};
  const hasServiceInventory = status.health?.emulator.hasServiceInventory ?? false;
  const loading = status.health === null && status.phase === 'loading';
  const coverage = summarizeRegistryCoverage(reported, catalog.services, provider);
  const notReported = catalog.services.filter(
    (service) =>
      hasServiceInventory && resolveServiceStatus(service, reported, provider) === undefined,
  );
  const disabled = catalog.services.filter(
    (service) => resolveServiceStatus(service, reported, provider) === 'disabled',
  );

  return (
    <ContentLayout
      breadcrumbs={<ConsoleBreadcrumbs items={[{ text: 'Service health' }]} />}
      header={
        <Header
          variant="h1"
          description={`Live view of the ${providerLabel} instance this console is bound to.`}
          actions={
            <Button
              iconName="refresh"
              loading={status.phase === 'loading'}
              onClick={() => {
                status.refresh();
              }}
            >
              Refresh
            </Button>
          }
        >
          Service health
        </Header>
      }
    >
      <SpaceBetween size="l">
        {status.phase === 'unreachable' || status.phase === 'error' ? (
          <Alert
            type="error"
            header={
              status.phase === 'unreachable'
                ? unreachableTitle(providerLabel)
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

        <EmulatorStatusCard status={status} />

        <Container
          header={
            <Header
              variant="h2"
              description={`How the LocalDeck registry compares with the services ${providerLabel} reports.`}
            >
              Registry coverage
            </Header>
          }
        >
          <RegistryCoverage
            coverage={coverage}
            source={catalog.source}
            providerLabel={providerLabel}
          />
        </Container>

        <ServiceAvailabilityTable
          services={reported}
          providerLabel={providerLabel}
          loading={loading}
          hasServiceInventory={hasServiceInventory}
          onRefresh={() => {
            status.refresh();
          }}
        />

        {disabled.length === 0 ? null : (
          <Container
            header={
              <Header
                variant="h2"
                counter={`(${disabled.length})`}
                description={`These services are known to ${providerLabel} but disabled in its configuration. LocalDeck never changes the emulator's configuration.`}
                actions={
                  <Button
                    onClick={() => {
                      void navigate(ALL_SERVICES_PATH);
                    }}
                  >
                    All services
                  </Button>
                }
              >
                Disabled in {providerLabel}
              </Header>
            }
          >
            <List
              ariaLabel={`Registered services disabled in ${providerLabel}`}
              items={disabled}
              renderItem={(service) => ({
                id: service.id,
                content: (
                  <Link
                    href={serviceConsolePath(service.id)}
                    onFollow={(event) => {
                      event.preventDefault();
                      void navigate(serviceConsolePath(service.id));
                    }}
                  >
                    {service.displayName}
                  </Link>
                ),
                secondaryContent: <Box color="text-body-secondary">{service.id}</Box>,
              })}
            />
          </Container>
        )}

        {notReported.length === 0 ? null : (
          <Container
            header={
              <Header
                variant="h2"
                counter={`(${notReported.length})`}
                description={`These entries are greyed out in the sidebar. LocalDeck never enables services on ${providerLabel}.`}
                actions={
                  <Button
                    onClick={() => {
                      void navigate(ALL_SERVICES_PATH);
                    }}
                  >
                    All services
                  </Button>
                }
              >
                Registered but not reported
              </Header>
            }
          >
            <List
              ariaLabel={`Registered services that ${providerLabel} does not report`}
              items={notReported}
              renderItem={(service) => ({
                id: service.id,
                content: (
                  <Link
                    href={serviceConsolePath(service.id)}
                    onFollow={(event) => {
                      event.preventDefault();
                      void navigate(serviceConsolePath(service.id));
                    }}
                  >
                    {service.displayName}
                  </Link>
                ),
                secondaryContent: <Box color="text-body-secondary">{service.id}</Box>,
              })}
            />
          </Container>
        )}

        {coverage.unregistered.length === 0 ? null : (
          <Container
            header={
              <Header
                variant="h2"
                counter={`(${coverage.unregistered.length})`}
                description={`${providerLabel} reports them, but LocalDeck has no registry entry yet, so they are not in the sidebar.`}
              >
                Emulator services without a console entry
              </Header>
            }
          >
            <Box variant="code">{coverage.unregistered.map(formatServiceName).join(', ')}</Box>
          </Container>
        )}
      </SpaceBetween>
    </ContentLayout>
  );
}
