import { CodeView } from '@cloudscape-design/code-view';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConsoleBreadcrumbs } from '../../../components/ConsoleBreadcrumbs';
import { useEmulatorStatus } from '../../../hooks/useEmulatorStatus';
import { DEFAULT_EMULATOR_DOCS_URL, serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';

/** CreateDBInstance → create-db-instance; the AWS CLI's kebab-case form. */
function cliOperationName(operation: string): string {
  return operation
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

/** The first whitelisted create operation, in registry order. */
function createOperationFor(operations: readonly string[]): string | undefined {
  return operations.find((operation) => operation.startsWith('Create'));
}

/**
 * The generated browser's create page. It never pretends to be a wizard for a
 * service LocalDeck has no form for: it hands the user a working `aws`/`awslocal`
 * command instead, generated from the registry metadata.
 */
export function GenericResourceCreate({ descriptor }: ServicePageProps): ReactElement {
  const navigate = useNavigate();
  const status = useEmulatorStatus();
  const endpoint = status.config?.emulator.publicEndpoint ?? 'http://localhost:4566';
  const createOperation = createOperationFor(descriptor.operations);
  const command =
    createOperation === undefined
      ? `# ${descriptor.displayName} has no whitelisted Create* operation in the LocalDeck registry.`
      : [
          `# 1. Inspect the operation's full input shape`,
          `aws ${descriptor.id} ${cliOperationName(createOperation)} --generate-cli-skeleton > create.json`,
          ``,
          `# 2. Edit create.json, then call LocalStack directly`,
          `aws ${descriptor.id} ${cliOperationName(createOperation)} \\`,
          `  --endpoint-url ${endpoint} \\`,
          `  --cli-input-json file://create.json`,
        ].join('\n');

  return (
    <ContentLayout
      breadcrumbs={
        <ConsoleBreadcrumbs
          items={[
            { text: descriptor.displayName, href: serviceConsolePath(descriptor.id) },
            { text: 'Create' },
          ]}
        />
      }
      header={
        <Header
          variant="h1"
          description={descriptor.summary}
          actions={
            <Button
              onClick={() => {
                navigate(serviceConsolePath(descriptor.id));
              }}
            >
              Back to resources
            </Button>
          }
        >
          Create {descriptor.displayName} resource
        </Header>
      }
    >
      <SpaceBetween size="l">
        <Alert type="info" header="Create via AWS CLI">
          The generated browser does not include a create form for {descriptor.displayName}. The
          dedicated modules implement wizards; this fallback stays read-only and points you at the
          CLI instead, so nothing is guessed. All create operations are added to the registry
          whitelist first, so the same request works through{' '}
          <Box variant="code">POST /api/services/:serviceId/:operation</Box>.
        </Alert>

        <Container
          header={
            <Header
              variant="h2"
              description={
                createOperation === undefined
                  ? 'No create operation is whitelisted for this service yet.'
                  : `Suggested command for ${createOperation}.`
              }
            >
              CLI command
            </Header>
          }
        >
          <CodeView
            content={command}
            lineNumbers
            wrapLines
            ariaLabel={`${descriptor.displayName} create command`}
          />
        </Container>

        <Container header={<Header variant="h2">Whitelisted operations</Header>}>
          <Box variant="code">{descriptor.operations.join(', ')}</Box>
        </Container>

        <Box>
          <Button
            variant="link"
            href={DEFAULT_EMULATOR_DOCS_URL}
            target="_blank"
            external
            iconAlign="right"
          >
            LocalStack API coverage
          </Button>
        </Box>
      </SpaceBetween>
    </ContentLayout>
  );
}
