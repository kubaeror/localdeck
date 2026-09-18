import type { ApiError } from '@localdeck/shared';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import type { TableProps } from '@cloudscape-design/components/table';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DeleteConfirmModal } from '../../../components/DeleteConfirmModal';
import { InfoTooltip } from '../../../components/InfoTooltip';
import { ResourceDetailPage } from '../../../components/ResourceDetailPage';
import { StatusBadge } from '../../../components/StatusBadge';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { toApiError } from '../../../lib/apiClient';
import { formatDateTime, type StatusName } from '../../../lib/format';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import {
  deleteVolume,
  getVolume,
  isVolumeAttached,
  type Ec2Volume,
  type Ec2VolumeAttachment,
} from '../api';
import { toFriendlyEc2Error } from '../errors';
import { AttachVolumeModal } from '../components/AttachVolumeModal';
import { EmulatedBadge } from '../components/EmulatedBadge';
import { ResourceTagsTab } from '../components/ResourceTagsTab';

/** Maps an EBS volume state onto the console's status vocabulary. */
function volumeStatusName(state: string): StatusName {
  switch (state) {
    case 'in-use':
    case 'creating':
    case 'deleting':
    case 'deleted':
      return state;
    default:
      return 'available';
  }
}

/**
 * One EBS volume: details, attachments and tags. Attaching is available while
 * the volume is not in use; detaching is rendered disabled because this
 * LocalStack build answers `DetachVolume` with an internal error — the console
 * never turns an unsupported action into a raw 5xx.
 */
export function VolumeDetailPage({ descriptor }: ServicePageProps): ReactElement {
  const { volumeId = '' } = useParams();
  const navigate = useNavigate();
  const flashbar = useFlashbar();

  const [volume, setVolume] = useState<Ec2Volume | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [attachVisible, setAttachVisible] = useState(false);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const id = requestId.current + 1;
    requestId.current = id;
    setLoading(true);
    try {
      const result = await getVolume(volumeId);
      if (requestId.current !== id) return;
      setVolume(result);
      setError(null);
    } catch (caught) {
      if (requestId.current !== id) return;
      setVolume(null);
      setError(toApiError(caught));
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [volumeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- volume lookup for the route
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  const attached = volume !== null && isVolumeAttached(volume);

  const confirmDelete = async (): Promise<void> => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteVolume(volumeId);
      flashbar.notify({ type: 'success', header: 'Volume deleted', content: volumeId });
      setDeleteVisible(false);
      navigate(`${serviceConsolePath(descriptor.id)}/volumes`);
    } catch (caught) {
      setDeleteError(toFriendlyEc2Error(caught).message);
    } finally {
      setDeleting(false);
    }
  };

  const instancePath = (instanceId: string): string =>
    `${serviceConsolePath(descriptor.id)}/instances/${encodeURIComponent(instanceId)}`;

  const attachmentColumns: readonly TableProps.ColumnDefinition<Ec2VolumeAttachment>[] = [
    {
      id: 'instanceId',
      header: 'Instance',
      isRowHeader: true,
      cell: (attachment) => (
        <Link
          href={instancePath(attachment.instanceId)}
          onFollow={(event) => {
            event.preventDefault();
            navigate(instancePath(attachment.instanceId));
          }}
        >
          <Box variant="code" display="inline">
            {attachment.instanceId}
          </Box>
        </Link>
      ),
    },
    { id: 'device', header: 'Device name', cell: (attachment) => attachment.device ?? '—' },
    { id: 'state', header: 'Attachment state', cell: (attachment) => attachment.state ?? '—' },
    {
      id: 'attachTime',
      header: 'Attached since',
      cell: (attachment) => formatDateTime(attachment.attachTime),
    },
    {
      id: 'deleteOnTermination',
      header: 'Delete on termination',
      cell: (attachment) =>
        attachment.deleteOnTermination === undefined
          ? '—'
          : attachment.deleteOnTermination
            ? 'Yes'
            : 'No',
    },
  ];

  const listingPath = `${serviceConsolePath(descriptor.id)}/volumes`;

  return (
    <>
      <ResourceDetailPage
        title={volume?.name ?? volumeId}
        description={volume === null ? undefined : <Box variant="code">{volume.volumeId}</Box>}
        breadcrumbs={[
          { text: descriptor.displayName, href: serviceConsolePath(descriptor.id) },
          { text: 'Volumes', href: listingPath },
          { text: volume?.name ?? volumeId },
        ]}
        loading={loading}
        error={error}
        onRetry={() => {
          void load();
        }}
        status={
          volume === null ? undefined : (
            <SpaceBetween direction="horizontal" size="xs">
              <StatusBadge status={volumeStatusName(volume.state)} />
              <EmulatedBadge detail="LocalStack emulates this EBS volume as metadata: the EC2 API reports its size, type and attachments, but no bytes are stored." />
            </SpaceBetween>
          )
        }
        headerActions={
          volume === null ? undefined : (
            <SpaceBetween direction="horizontal" size="xs">
              <Button disabled={attached} onClick={() => setAttachVisible(true)}>
                Attach to instance
              </Button>
              {attached ? (
                <InfoTooltip content="LocalStack answers DetachVolume with an internal error, so LocalDeck disables the action. Terminating the instance releases the volume.">
                  <Button disabled>Detach volume</Button>
                </InfoTooltip>
              ) : (
                <Button disabled>Detach volume</Button>
              )}
              <Button
                disabled={attached}
                onClick={() => {
                  setDeleteError(null);
                  setDeleteVisible(true);
                }}
              >
                Delete volume
              </Button>
            </SpaceBetween>
          )
        }
        tabs={
          volume === null
            ? []
            : [
                {
                  id: 'details',
                  label: 'Details',
                  content: (
                    <Container header={<Header variant="h2">Volume details</Header>}>
                      <KeyValuePairs
                        columns={3}
                        items={[
                          {
                            label: 'Volume ID',
                            value: <Box variant="code">{volume.volumeId}</Box>,
                          },
                          {
                            label: 'Volume state',
                            value: <StatusBadge status={volumeStatusName(volume.state)} />,
                          },
                          { label: 'Volume type', value: volume.volumeType ?? '—' },
                          { label: 'Size', value: `${volume.sizeGiB ?? '?'} GiB` },
                          {
                            label: 'IOPS',
                            value: volume.iops === undefined ? '—' : String(volume.iops),
                          },
                          {
                            label: 'Throughput',
                            value:
                              volume.throughput === undefined ? '—' : `${volume.throughput} MiB/s`,
                          },
                          { label: 'Availability Zone', value: volume.availabilityZone ?? '—' },
                          {
                            label: 'Encryption',
                            value: volume.encrypted ? 'Encrypted' : 'Not encrypted',
                          },
                          { label: 'Snapshot ID', value: volume.snapshotId ?? '—' },
                          { label: 'Created', value: formatDateTime(volume.createTime) },
                          { label: 'Attached to', value: volume.attachments[0]?.instanceId ?? '—' },
                          {
                            label: 'Delete on termination',
                            value:
                              volume.attachments[0]?.deleteOnTermination === undefined
                                ? '—'
                                : volume.attachments[0].deleteOnTermination
                                  ? 'Yes'
                                  : 'No',
                          },
                        ]}
                      />
                    </Container>
                  ),
                },
                {
                  id: 'attachments',
                  label: 'Attachments',
                  content: (
                    <Container
                      header={
                        <Header
                          variant="h2"
                          description="Instances this volume is attached to. A volume can be attached to one instance at a time."
                        >
                          Attachments
                        </Header>
                      }
                    >
                      <Table<Ec2VolumeAttachment>
                        variant="embedded"
                        items={[...volume.attachments]}
                        columnDefinitions={attachmentColumns}
                        trackBy={(attachment) => attachment.instanceId}
                        ariaLabels={{ tableLabel: 'Volume attachments' }}
                        empty={
                          <Box textAlign="center" color="text-body-secondary">
                            This volume is not attached to an instance.
                          </Box>
                        }
                      />
                    </Container>
                  ),
                },
                {
                  id: 'tags',
                  label: 'Tags',
                  content: (
                    <ResourceTagsTab
                      key={volume.volumeId}
                      resourceId={volume.volumeId}
                      tags={volume.tags}
                      description="Tags applied to the volume. Saving applies only the changed keys through CreateTags and DeleteTags."
                      onSaved={() => {
                        void load();
                      }}
                    />
                  ),
                },
              ]
        }
      />

      {attachVisible ? (
        <AttachVolumeModal
          volumeId={volumeId}
          onDismiss={() => {
            setAttachVisible(false);
          }}
          onAttached={() => {
            setAttachVisible(false);
            flashbar.notify({ type: 'success', header: 'Volume attached', content: volumeId });
            void load();
          }}
        />
      ) : null}

      {deleteVisible ? (
        <DeleteConfirmModal
          visible
          title="Delete volume"
          subjects={[volume?.name ?? volumeId]}
          description="Deleting a volume removes its data permanently. This action cannot be undone."
          submitLabel="Delete volume"
          loading={deleting}
          {...(deleteError === null ? {} : { errorText: deleteError })}
          onDismiss={() => {
            if (deleting) return;
            setDeleteVisible(false);
            setDeleteError(null);
          }}
          onConfirm={() => {
            void confirmDelete();
          }}
        />
      ) : null}
    </>
  );
}

export default VolumeDetailPage;
