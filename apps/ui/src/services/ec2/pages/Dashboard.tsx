import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Grid from '@cloudscape-design/components/grid';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import Table from '@cloudscape-design/components/table';
import type { TableProps } from '@cloudscape-design/components/table';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConsoleBreadcrumbs } from '../../../components/ConsoleBreadcrumbs';
import { DeleteConfirmModal } from '../../../components/DeleteConfirmModal';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { usePolling } from '../../../hooks/usePolling';
import { formatDateTime } from '../../../lib/format';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import {
  countImages,
  countInstances,
  countSecurityGroups,
  countVolumes,
  deleteKeyPair,
  listKeyPairs,
  type Ec2Count,
  type Ec2KeyPair,
} from '../api';
import { toFriendlyEc2Error } from '../errors';
import { useEc2Resource } from '../hooks';
import { EmulatedBadge } from '../components/EmulatedBadge';

/** How often the dashboard counts refresh. */
const POLL_INTERVAL_MS = 30_000;

interface DashboardCounts {
  instances: Ec2Count;
  volumes: Ec2Count;
  securityGroups: Ec2Count;
  /** AMIs LocalStack reports, whichever owner they belong to. */
  images: Ec2Count;
}

interface DashboardData {
  counts: DashboardCounts;
  keyPairs: readonly Ec2KeyPair[];
}

/** "12" or "100+" when the service has more pages than the first one shows. */
function formatCount(value: Ec2Count): string {
  return value.hasMore ? `${value.count}+` : String(value.count);
}

/**
 * The EC2 landing page: the four account-wide counts and links into each
 * section, plus the key-pair list the wizard's "existing key pair" step reads.
 * The counts ask for a single page each and render "100+" when the service has
 * more, instead of paging through every catalogue on each refresh.
 */
export function DashboardPage({ descriptor }: ServicePageProps): ReactElement {
  const navigate = useNavigate();
  const flashbar = useFlashbar();
  const [deleteTarget, setDeleteTarget] = useState<Ec2KeyPair | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loader = useCallback(async (): Promise<DashboardData> => {
    const [instances, volumes, securityGroups, images, keyPairs] = await Promise.all([
      countInstances(),
      countVolumes(),
      countSecurityGroups(),
      countImages(),
      listKeyPairs(),
    ]);
    return { counts: { instances, volumes, securityGroups, images }, keyPairs };
  }, []);
  const { data, loading, refreshing, error, reload } = useEc2Resource(loader);

  // The counts refresh on their own; polling never blocks the page.
  usePolling(true, POLL_INTERVAL_MS, () => reload());

  const confirmDeleteKeyPair = async (): Promise<void> => {
    if (deleting || deleteTarget === null) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteKeyPair(deleteTarget.keyName);
      flashbar.notify({
        type: 'success',
        header: 'Key pair deleted',
        content: deleteTarget.keyName,
      });
      setDeleteTarget(null);
      await reload();
    } catch (caught) {
      setDeleteError(toFriendlyEc2Error(caught).message);
    } finally {
      setDeleting(false);
    }
  };

  const open = (path: string) => {
    navigate(`${serviceConsolePath(descriptor.id)}/${path}`);
  };

  const counts = data?.counts ?? null;
  const cards: readonly { title: string; count: Ec2Count; label: string; path: string }[] =
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

  const keyPairColumns = useMemo<readonly TableProps.ColumnDefinition<Ec2KeyPair>[]>(
    () => [
      {
        id: 'keyName',
        header: 'Key pair name',
        isRowHeader: true,
        cell: (pair) => <Box variant="code">{pair.keyName}</Box>,
      },
      { id: 'keyPairId', header: 'Key pair ID', cell: (pair) => pair.keyPairId ?? '—' },
      { id: 'keyType', header: 'Type', cell: (pair) => pair.keyType ?? 'rsa' },
      {
        id: 'keyFingerprint',
        header: 'Fingerprint',
        cell: (pair) => pair.keyFingerprint ?? '—',
      },
      {
        id: 'createTime',
        header: 'Created',
        cell: (pair) => formatDateTime(pair.createTime),
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: (pair) => (
          <ButtonDropdown
            variant="icon"
            ariaLabel={`Actions for ${pair.keyName}`}
            items={[{ id: 'delete', text: 'Delete key pair' }]}
            onItemClick={({ detail }) => {
              if (detail.id === 'delete') {
                setDeleteError(null);
                setDeleteTarget(pair);
              }
            }}
          />
        ),
      },
    ],
    [],
  );

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
              loading={loading || refreshing}
              onClick={() => {
                void reload();
              }}
            >
              Refresh
            </Button>
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
                  void reload();
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
                  <Box variant="h2">{formatCount(card.count)}</Box>
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

        <Container
          header={
            <Header
              variant="h2"
              description="Key pairs are stored by LocalStack so instances can reference them at launch. The private key material is only returned once, by CreateKeyPair."
            >
              Key pairs
            </Header>
          }
        >
          <Table<Ec2KeyPair>
            variant="embedded"
            loading={loading && data === null}
            loadingText="Loading key pairs"
            items={data?.keyPairs ?? []}
            columnDefinitions={keyPairColumns}
            trackBy={(pair) => pair.keyName}
            ariaLabels={{ tableLabel: 'Key pairs' }}
            empty={
              <Box textAlign="center" color="text-body-secondary">
                No key pairs in this LocalStack account. The launch wizard can create one.
              </Box>
            }
          />
        </Container>

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

      {deleteTarget === null ? null : (
        <DeleteConfirmModal
          visible
          title="Delete key pair"
          subjects={[deleteTarget.keyName]}
          description="Deleting a key pair removes it from LocalStack. Instances launched with it keep running, but the pair can no longer be selected for new launches; the private key cannot be recovered from LocalStack."
          submitLabel="Delete key pair"
          loading={deleting}
          {...(deleteError === null ? {} : { errorText: deleteError })}
          onDismiss={() => {
            if (deleting) return;
            setDeleteTarget(null);
            setDeleteError(null);
          }}
          onConfirm={() => {
            void confirmDeleteKeyPair();
          }}
        />
      )}
    </ContentLayout>
  );
}

export default DashboardPage;
