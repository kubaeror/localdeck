import type { ApiError } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Grid from '@cloudscape-design/components/grid';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConsoleBreadcrumbs } from '../../../components/ConsoleBreadcrumbs';
import { toApiError } from '../../../lib/apiClient';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import { listAllImages, listAllInstances, listAllSecurityGroups, listAllVolumes } from '../api';
import { EmulatedBadge } from '../components/EmulatedBadge';

interface DashboardCounts {
  instances: number;
  volumes: number;
  securityGroups: number;
  /** AMIs LocalStack reports, whichever owner they belong to. */
  images: number;
}

/**
 * The EC2 landing page: the four account-wide counts and links into each
 * section, mirroring the console's dashboard. The counts page through every
 * resource (LocalStack accounts are small), so a truncated first page can never
 * under-report.
 */
export function DashboardPage({ descriptor }: ServicePageProps): ReactElement {
  const navigate = useNavigate();
  const [counts, setCounts] = useState<DashboardCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const id = requestId.current + 1;
    requestId.current = id;
    setLoading(true);
    try {
      const [instances, volumes, securityGroups, images] = await Promise.all([
        listAllInstances(),
        listAllVolumes(),
        listAllSecurityGroups(),
        listAllImages(),
      ]);
      if (requestId.current !== id) return;
      setCounts({
        instances: instances.length,
        volumes: volumes.length,
        securityGroups: securityGroups.length,
        images: images.length,
      });
      setError(null);
    } catch (caught) {
      if (requestId.current !== id) return;
      setError(toApiError(caught));
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- dashboard counts fetch
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  const open = (path: string) => {
    navigate(`${serviceConsolePath(descriptor.id)}/${path}`);
  };

  const cards: readonly { title: string; count: number; label: string; path: string }[] =
    counts === null
      ? []
      : [
          {
            title: 'Instances',
            count: counts.instances,
            label: 'View instances',
            path: 'instances',
          },
          { title: 'Volumes', count: counts.volumes, label: 'View volumes', path: 'volumes' },
          {
            title: 'Security groups',
            count: counts.securityGroups,
            label: 'View security groups',
            path: 'security-groups',
          },
          { title: 'AMIs', count: counts.images, label: 'View AMIs', path: 'amis' },
        ];

  return (
    <ContentLayout
      breadcrumbs={<ConsoleBreadcrumbs items={[{ text: descriptor.displayName }]} />}
      header={
        <Header
          variant="h1"
          description="Launch and manage emulated compute, storage and networking in this LocalStack account."
          actions={
            <Button
              iconName="refresh"
              ariaLabel="Refresh dashboard"
              loading={loading}
              onClick={() => {
                void load();
              }}
            />
          }
        >
          Dashboard <EmulatedBadge />
        </Header>
      }
    >
      <SpaceBetween size="l">
        {error === null ? null : (
          <Alert
            type="error"
            header="Could not load the EC2 dashboard"
            action={
              <Button
                onClick={() => {
                  void load();
                }}
              >
                Retry
              </Button>
            }
          >
            {error.message}
          </Alert>
        )}

        {loading && counts === null ? (
          <Box textAlign="center" padding="l">
            <Spinner size="large" />
          </Box>
        ) : (
          <Grid gridDefinition={cards.map(() => ({ colspan: { default: 12, xs: 6, m: 3 } }))}>
            {cards.map((card) => (
              <Container key={card.path} header={<Header variant="h3">{card.title}</Header>}>
                <SpaceBetween size="s">
                  <Box variant="h2">{card.count}</Box>
                  <Link
                    href={`${serviceConsolePath(descriptor.id)}/${card.path}`}
                    onFollow={(event) => {
                      event.preventDefault();
                      open(card.path);
                    }}
                  >
                    {card.label}
                  </Link>
                </SpaceBetween>
              </Container>
            ))}
          </Grid>
        )}

        <Container header={<Header variant="h2">EC2 resources</Header>}>
          <SpaceBetween size="s">
            <Box>
              LocalStack emulates the EC2 control plane: instances, volumes, security groups and key
              pairs are stored in memory and answer the real EC2 APIs, but no actual compute is
              provisioned. State lives only for this LocalStack session, and starting an instance is
              effectively immediate — LocalDeck still polls until the reported state settles.
            </Box>
            <SpaceBetween direction="horizontal" size="s">
              <Button variant="primary" onClick={() => open('instances/launch')}>
                Launch instance
              </Button>
              <Button onClick={() => open('volumes/create')}>Create volume</Button>
              <Button onClick={() => open('security-groups')}>Create security group</Button>
            </SpaceBetween>
          </SpaceBetween>
        </Container>
      </SpaceBetween>
    </ContentLayout>
  );
}

export default DashboardPage;
