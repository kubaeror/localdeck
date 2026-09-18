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
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { StatusBadge } from '../../../components/StatusBadge';
import { InfoTooltip } from '../../../components/InfoTooltip';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { serviceConsolePath } from '../../paths';
import { listInstanceVolumes, type Ec2Instance, type Ec2Volume } from '../api';
import { useEc2Resource } from '../hooks';
import { volumeStatusName } from '../status';
import { AttachVolumeModal } from './AttachVolumeModal';

export interface InstanceStorageTabProps {
  instance: Ec2Instance;
  /** Service descriptor id, so links do not hardcode `ec2` (EC2-D04). */
  serviceId: string;
}

/**
 * The console's Storage tab: the instance's block devices, including the root
 * volume, with a link to each volume's own page and an attach action for extra
 * EBS volumes. Detach is rendered disabled with an explanation because this
 * LocalStack build answers `DetachVolume` with an internal error — the console
 * never turns an unsupported action into a raw 5xx.
 */
export function InstanceStorageTab({ instance, serviceId }: InstanceStorageTabProps): ReactElement {
  const navigate = useNavigate();
  const flashbar = useFlashbar();
  const [attachVisible, setAttachVisible] = useState(false);

  const { instanceId, blockDevices, rootDeviceName } = instance;
  const loader = useCallback(() => listInstanceVolumes(instanceId), [instanceId]);
  const { data: volumes, loading, refreshing, error, reload } = useEc2Resource(loader);

  // The root volume is the one whose block device matches the instance's root
  // device name — from the instance description or from the attachment.
  const rootVolumeId = blockDevices.find(
    (device) => device.deviceName === rootDeviceName,
  )?.volumeId;
  const isRootVolume = useCallback(
    (volume: Ec2Volume): boolean =>
      volume.volumeId === rootVolumeId ||
      volume.attachments.some(
        (attachment) =>
          attachment.instanceId === instanceId && attachment.device === rootDeviceName,
      ),
    [instanceId, rootDeviceName, rootVolumeId],
  );

  const volumePath = useCallback(
    (volumeId: string): string =>
      `${serviceConsolePath(serviceId)}/volumes/${encodeURIComponent(volumeId)}`,
    [serviceId],
  );

  const openVolume = useCallback(
    (volumeId: string) => {
      navigate(volumePath(volumeId));
    },
    [navigate, volumePath],
  );

  const columns = useMemo<readonly TableProps.ColumnDefinition<Ec2Volume>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        isRowHeader: true,
        cell: (volume) => (
          <SpaceBetween direction="horizontal" size="xs">
            <Link
              href={volumePath(volume.volumeId)}
              onFollow={(event) => {
                event.preventDefault();
                openVolume(volume.volumeId);
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
          const attachment = volume.attachments.find((entry) => entry.instanceId === instanceId);
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
          const attachment = volume.attachments.find((entry) => entry.instanceId === instanceId);
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
          <InfoTooltip content="LocalStack answers DetachVolume with an internal error, so LocalDeck disables the action. Terminating the instance releases the volume.">
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
                  openVolume(volume.volumeId);
                }
              }}
            />
          </InfoTooltip>
        ),
      },
    ],
    [instanceId, isRootVolume, openVolume, volumePath],
  );

  const rows = volumes ?? [];

  return (
    <Container
      header={
        <Header
          variant="h2"
          description="The instance's block devices. The root device comes from the AMI; extra EBS volumes can be attached at any time."
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                loading={loading || refreshing}
                onClick={() => {
                  void reload();
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

        <Table<Ec2Volume>
          variant="embedded"
          loading={loading}
          loadingText="Loading volumes"
          items={[...rows]}
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
          instanceId={instanceId}
          onDismiss={() => {
            setAttachVisible(false);
          }}
          onAttached={() => {
            setAttachVisible(false);
            flashbar.notify({
              type: 'success',
              header: 'Volume attached',
              content: `The volume is now attached to ${instanceId}.`,
            });
            void reload();
          }}
        />
      ) : null}
    </Container>
  );
}

export default InstanceStorageTab;
