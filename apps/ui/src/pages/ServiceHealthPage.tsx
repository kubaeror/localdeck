import { isServiceEmulated, summarizeRegistryCoverage } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Link from '@cloudscape-design/components/link';
import List from '@cloudscape-design/components/list';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConsoleBreadcrumbs } from '../components/ConsoleBreadcrumbs';
import { LocalStackStatusCard } from '../components/LocalStackStatusCard';
import { ServiceAvailabilityTable } from '../components/ServiceAvailabilityTable';
import { useLocalStackStatus } from '../hooks/useLocalStackStatus';
import { useServiceCatalog } from '../hooks/useServiceCatalog';
import { formatServiceName } from '../lib/format';
import { ALL_SERVICES_PATH, serviceConsolePath } from '../services/paths';

/**
 * Service health: the endpoint this console is bound to, what LocalStack
 * reports right now, and how the registry lines up with it.
 */
export function ServiceHealthPage(): ReactElement {
  const navigate = useNavigate();
  const status = useLocalStackStatus();
  const catalog = useServiceCatalog();

  const reported = status.health?.localstack.services ?? {};
  const coverage = summarizeRegistryCoverage(reported, catalog.services);
  const notEmulated = catalog.services.filter((service) => !isServiceEmulated(service, reported));

  return (
    <ContentLayout
      breadcrumbs={<ConsoleBreadcrumbs items={[{ text: 'Service health' }]} />}
      header={
        <Header
          variant="h1"
          description="Live view of the LocalStack instance this console is bound to."
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

        <LocalStackStatusCard status={status} />

        <Container
          header={
            <Header
              variant="h2"
              description="How the LocalDeck registry compares with the services this LocalStack reports."
            >
              Registry coverage
            </Header>
          }
        >
          <KeyValuePairs
            columns={3}
            items={[
              {
                label: 'Registered services',
                value:
                  catalog.source === 'api' ? (
                    <Box>{coverage.registered} (served by GET /api/services)</Box>
                  ) : (
                    <Box>{coverage.registered} (bundled with the ui)</Box>
                  ),
              },
              {
                label: 'Emulated locally',
                value: <Box>{coverage.emulated}</Box>,
              },
              {
                label: 'Not emulated locally',
                value: <Box>{coverage.notEmulated.length}</Box>,
              },
              {
                label: 'Stack services without a console entry',
                value: <Box>{coverage.unregistered.length}</Box>,
              },
            ]}
          />
        </Container>

        <ServiceAvailabilityTable
          services={reported}
          onRefresh={() => {
            status.refresh();
          }}
        />

        {notEmulated.length === 0 ? null : (
          <Container
            header={
              <Header
                variant="h2"
                counter={`(${notEmulated.length})`}
                description="These entries are greyed out in the sidebar. LocalDeck never enables services on your LocalStack instance."
                actions={
                  <Button
                    onClick={() => {
                      navigate(ALL_SERVICES_PATH);
                    }}
                  >
                    All services
                  </Button>
                }
              >
                Registered but not emulated
              </Header>
            }
          >
            <List
              ariaLabel="Registered services that LocalStack does not report"
              items={notEmulated}
              renderItem={(service) => ({
                id: service.id,
                content: (
                  <Link
                    href={serviceConsolePath(service.id)}
                    onFollow={(event) => {
                      event.preventDefault();
                      navigate(serviceConsolePath(service.id));
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
                description="LocalStack emulates them, but LocalDeck has no registry entry yet, so they are not in the sidebar."
              >
                Stack services without a console entry
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
