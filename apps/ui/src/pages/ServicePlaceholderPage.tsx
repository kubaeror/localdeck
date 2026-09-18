import {
  localStackKeysFor,
  resolveServiceStatus,
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
import { useLocalStackStatus } from '../hooks/useLocalStackStatus';
import { NOT_EMULATED_LABEL } from '../lib/copy';
import { describeServiceStatus, formatRelativeTime } from '../lib/format';
import { PARITY_LABELS } from '../lib/parity';
import {
  ALL_SERVICES_PATH,
  CONSOLE_HOME_PATH,
  LOCALSTACK_SERVICES_DOCS_URL,
} from '../services/paths';

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

/**
 * Per-service placeholder used until a service module lands. It never fakes
 * data: everything shown here comes from the registry and the live health
 * document.
 */
export function ServicePlaceholderPage({
  descriptor,
  routeTitle,
}: ServicePlaceholderPageProps): ReactElement {
  const navigate = useNavigate();
  const status = useLocalStackStatus();

  const services = status.health?.localstack.services ?? {};
  const serviceStatus = resolveServiceStatus(descriptor, services);
  const emulated = serviceStatus !== undefined;

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
            <Button href={LOCALSTACK_SERVICES_DOCS_URL} target="_blank" external>
              API coverage
            </Button>
          }
        >
          {descriptor.displayName}
        </Header>
      }
    >
      <SpaceBetween size="l">
        {emulated ? null : (
          <Alert
            type="warning"
            header={`${descriptor.displayName} is not emulated locally`}
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
            LocalStack at{' '}
            <Box variant="code">{status.config?.localstack.endpoint ?? 'loading…'}</Box> does not
            report the service <Box variant="code">{descriptor.id}</Box>, so this entry is greyed
            out in the sidebar. LocalDeck never starts or reconfigures LocalStack — enable the
            service in your LocalStack configuration if you need it.
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
            text: 'LocalStack API coverage',
            href: LOCALSTACK_SERVICES_DOCS_URL,
          }}
        />

        <Container header={<Header variant="h2">Registry entry</Header>}>
          <KeyValuePairs
            columns={2}
            items={[
              { label: 'Category', value: <Box>{descriptor.category}</Box> },
              { label: 'Parity level', value: <Box>{PARITY_LABELS[descriptor.parityLevel]}</Box> },
              {
                label: 'LocalStack status',
                value: emulated ? (
                  <StatusBadge status={serviceStatus} />
                ) : (
                  <Box color="text-status-inactive">{NOT_EMULATED_LABEL}</Box>
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
                label: 'LocalStack health keys',
                value: <Box variant="code">{localStackKeysFor(descriptor).join(', ')}</Box>,
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

        {emulated ? (
          <Box color="text-body-secondary" variant="small">
            LocalStack reports this service as “{describeServiceStatus(serviceStatus)}”.
          </Box>
        ) : null}
      </SpaceBetween>
    </ContentLayout>
  );
}
