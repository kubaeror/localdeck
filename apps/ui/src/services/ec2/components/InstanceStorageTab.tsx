import type { ApiError } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Badge from '@cloudscape-design/components/badge';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import type { TableProps } from '@cloudscape-design/components/table';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { StatusBadge } from '../../../components/StatusBadge';
import { InfoTooltip } from '../../../components/InfoTooltip';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { toApiError } from '../../../lib/apiClient';
import type { StatusName } from '../../../lib/format';
import { serviceConsolePath } from '../../paths';
import { listInstanceVolumes, type Ec2Instance, type Ec2Volume } from '../api';
import { AttachVolumeModal } from './AttachVolumeModal';

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

export interface InstanceStorageTabProps {
  instance: Ec2Instance;
}

/**
 * The console's Storage tab: the instance's block devices, including the root
 * volume, with a link to each volume's own page and an attach action for extra
 * EBS volumes. Detach is rendered disabled with an explanation because this
 * LocalStack build answers `DetachVolume` with an internal error — the console
 * never turns an unsupported action into a raw 5xx.
 */
export function InstanceStorageTab({ instance }: InstanceStorageTabProps): ReactElement {
  const navigate = useNavigate();
  const flashbar = useFlashbar();
  const [volumes, setVolumes] = useState<readonly Ec2Volume[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [attachVisible, setAttachVisible] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const id = requestId.current + 1;
    requestId.current = id;
    setLoading(true);
    try {
      const result = await listInstanceVolumes(instance.instanceId);
      if (requestId.current !== id) return;
      setVolumes(result);
      setError(null);
    } catch (caught) {
      if (requestId.current !== id) return;
      setError(toApiError(caught));
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [instance.instanceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- volume list fetch for the tab
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  // The root volume is the one whose block device matches the instance's root
  // device name — from the instance description or from the attachment.
  const rootVolumeId = instance.blockDevices.find(
    (device) => device.deviceName === instance.rootDeviceName,
  )?.volumeId;
  const isRootVolume = (volume: Ec2Volume): boolean =>
    volume.volumeId === rootVolumeId ||
    volume.attachments.some(
      (attachment) =>
        attachment.instanceId === instance.instanceId &&
        attachment.device === instance.rootDeviceName,
    );

  const columns: readonly TableProps.ColumnDefinition<Ec2Volume>[] = [
    {
      id: 'name',
      header: 'Name',
      isRowHeader: true,
      cell: (volume) => (
        <SpaceBetween direction="horizontal" size="xs">
          <Link
            href={`${serviceConsolePath('ec2')}/volumes/${encodeURIComponent(volume.volumeId)}`}
            onFollow={(event) => {
              event.preventDefault();
              navigate(
                `${serviceConsolePath('ec2')}/volumes/${encodeURIComponent(volume.volumeId)}`,
              );
            }}
          >
            {volume.name ?? volume.volumeId}
          </Link>
          {isRootVolume(volume) ? <Badge color="blue">Root device</Badge> : null}
        </SpaceBetween>
      ),
    },
    {
      id: 'volumeId',
      header: 'Volume ID',
      cell: (volume) => <Box variant="code">{volume.volumeId}</Box>,
    },
    {
      id: 'device',
      header: 'Device name',
      cell: (volume) => {
        const attachment = volume.attachments.find(
          (entry) => entry.instanceId === instance.instanceId,
        );
        return attachment?.device ?? volume.attachments[0]?.device ?? '—';
      },
    },
    {
      id: 'size',
      header: 'Size',
      cell: (volume) => `${volume.sizeGiB ?? '?'} GiB`,
    },
    {
      id: 'type',
      header: 'Volume type',
      cell: (volume) => volume.volumeType ?? '—',
    },
    {
      id: 'deleteOnTermination',
      header: 'Delete on termination',
      cell: (volume) => {
        const attachment = volume.attachments.find(
          (entry) => entry.instanceId === instance.instanceId,
        );
        if (attachment?.deleteOnTermination === undefined) return '—';
        return attachment.deleteOnTermination ? 'Yes' : 'No';
      },
    },
    {
      id: 'status',
      header: 'Status',
      cell: (volume) => <StatusBadge status={volumeStatusName(volume.state)} />,
    },
    {
      id: 'actions',
      header: 'Actions',
      minWidth: '150px',
      cell: (volume) => (
        <ButtonDropdown
          variant="icon"
          ariaLabel={`Actions for ${volume.volumeId}`}
          items={[
            {
              id: 'view',
              text: 'View volume',
            },
            {
              id: 'detach',
              text: 'Detach volume',
              disabled: true,
            },
          ]}
          onItemClick={({ detail }) => {
            if (detail.id === 'view') {
              navigate(
                `${serviceConsolePath('ec2')}/volumes/${encodeURIComponent(volume.volumeId)}`,
              );
            }
          }}
        />
      ),
    },
  ];

  return (
    <Container
      header={
        <Header
          variant="h2"
          description="The instance's block devices. The root device comes from the AMI; extra EBS volumes can be attached at any time."
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                loading={loading}
                onClick={() => {
                  void load();
                }}
              >
                Refresh
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setAttachVisible(true);
                }}
              >
                Attach volume
              </Button>
            </SpaceBetween>
          }
        >
          Storage
        </Header>
      }
    >
      <SpaceBetween size="s">
        <Alert type="info" header="Detaching volumes is not supported by this LocalStack build">
          LocalStack answers{' '}
          <Box variant="code" display="inline">
            DetachVolume
          </Box>{' '}
          with an internal error, so the action is disabled here instead of failing after the click.
          Terminating the instance releases its volumes.
        </Alert>

        {error === null ? null : (
          <Alert
            type="error"
            header="Could not load the volumes"
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

        <Table<Ec2Volume>
          variant="embedded"
          loading={loading}
          loadingText="Loading volumes"
          items={[...volumes]}
          columnDefinitions={columns}
          trackBy={(volume) => volume.volumeId}
          ariaLabels={{ tableLabel: 'Instance volumes' }}
          empty={
            <Box textAlign="center" color="text-body-secondary">
              No EBS volumes are attached to this instance.
            </Box>
          }
        />

        <Box color="text-body-secondary" variant="small">
          Instance volumes attached after launch are shown here as soon as LocalStack reports them.{' '}
          <InfoTooltip content="This LocalStack build reports attachments, but cannot detach them.">
            <Box variant="small" display="inline">
              Why is Detach disabled?
            </Box>
          </InfoTooltip>
        </Box>
      </SpaceBetween>

      {attachVisible ? (
        <AttachVolumeModal
          instanceId={instance.instanceId}
          onDismiss={() => {
            setAttachVisible(false);
          }}
          onAttached={() => {
            setAttachVisible(false);
            flashbar.notify({
              type: 'success',
              header: 'Volume attached',
              content: `The volume is now attached to ${instance.instanceId}.`,
            });
            void load();
          }}
        />
      ) : null}
    </Container>
  );
}

export default InstanceStorageTab;
