import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import type { TableProps } from '@cloudscape-design/components/table';
import { useCallback, useMemo, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ResourceDetailPage } from '../../../components/ResourceDetailPage';
import { StatusBadge } from '../../../components/StatusBadge';
import { TagsEditor } from '../../../components/TagsEditor';
import { formatDateTime } from '../../../lib/format';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import { getImage, type Ec2Image } from '../api';
import { useEc2Resource } from '../hooks';
import { imageStatusName } from '../status';
import { EmulatedBadge } from '../components/EmulatedBadge';

interface ImageBlockDevice {
  deviceName: string;
  snapshotId?: string;
  volumeSizeGiB?: number;
  volumeType?: string;
  deleteOnTermination?: boolean;
  encrypted?: boolean;
}

/** Reads the SDK's raw `BlockDeviceMappings` array into table rows. */
function toBlockDevices(image: Ec2Image): readonly ImageBlockDevice[] {
  const mappings = image.raw['BlockDeviceMappings'];
  if (!Array.isArray(mappings)) return [];
  return mappings.flatMap((entry): ImageBlockDevice[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const mapping = entry as Record<string, unknown>;
    const deviceName = typeof mapping['DeviceName'] === 'string' ? mapping['DeviceName'] : '';
    const ebs = (mapping['Ebs'] ?? {}) as Record<string, unknown>;
    const volumeSize = ebs['VolumeSize'];
    return [
      {
        deviceName,
        ...(typeof ebs['SnapshotId'] === 'string' ? { snapshotId: ebs['SnapshotId'] } : {}),
        ...(typeof volumeSize === 'number' ? { volumeSizeGiB: volumeSize } : {}),
        ...(typeof ebs['VolumeType'] === 'string' ? { volumeType: ebs['VolumeType'] } : {}),
        ...(typeof ebs['DeleteOnTermination'] === 'boolean'
          ? { deleteOnTermination: ebs['DeleteOnTermination'] }
          : {}),
        ...(typeof ebs['Encrypted'] === 'boolean' ? { encrypted: ebs['Encrypted'] } : {}),
      },
    ];
  });
}

/**
 * One AMI: its identity and launch parameters, the block devices it creates,
 * and the tags LocalStack reports. The header action opens the launch wizard
 * with the image preselected.
 */
export function AmiDetailPage({ descriptor }: ServicePageProps): ReactElement {
  const { imageId = '' } = useParams();
  const navigate = useNavigate();

  const loader = useCallback(() => getImage(imageId), [imageId]);
  const { data: image, loading, error, reload } = useEc2Resource(loader);

  const launchPath = `${serviceConsolePath(descriptor.id)}/instances/launch?imageId=${encodeURIComponent(imageId)}`;

  const blockDevices = useMemo(() => (image === null ? [] : toBlockDevices(image)), [image]);

  const blockDeviceColumns = useMemo<readonly TableProps.ColumnDefinition<ImageBlockDevice>[]>(
    () => [
      {
        id: 'deviceName',
        header: 'Device name',
        isRowHeader: true,
        cell: (device) => <Box variant="code">{device.deviceName}</Box>,
      },
      { id: 'snapshot', header: 'Snapshot', cell: (device) => device.snapshotId ?? '—' },
      {
        id: 'size',
        header: 'Size',
        cell: (device) =>
          device.volumeSizeGiB === undefined ? '—' : `${device.volumeSizeGiB} GiB`,
      },
      { id: 'type', header: 'Volume type', cell: (device) => device.volumeType ?? '—' },
      {
        id: 'deleteOnTermination',
        header: 'Delete on termination',
        cell: (device) =>
          device.deleteOnTermination === undefined
            ? '—'
            : device.deleteOnTermination
              ? 'Yes'
              : 'No',
      },
      {
        id: 'encrypted',
        header: 'Encrypted',
        cell: (device) => (device.encrypted === undefined ? '—' : device.encrypted ? 'Yes' : 'No'),
      },
    ],
    [],
  );

  return (
    <ResourceDetailPage
      title={image?.name ?? imageId}
      description={image === null ? undefined : <Box variant="code">{image.imageId}</Box>}
      breadcrumbs={[
        { text: descriptor.displayName, href: serviceConsolePath(descriptor.id) },
        { text: 'AMIs', href: `${serviceConsolePath(descriptor.id)}/amis` },
        { text: image?.name ?? imageId },
      ]}
      loading={loading}
      error={error}
      onRetry={() => {
        void reload();
      }}
      status={
        image === null ? undefined : (
          <EmulatedBadge detail="LocalStack reports this AMI from the images it can emulate; launching it creates an emulated instance, not a real machine." />
        )
      }
      headerActions={
        <Button
          variant="primary"
          onClick={() => {
            navigate(launchPath);
          }}
        >
          Launch instance from AMI
        </Button>
      }
      tabs={
        image === null
          ? []
          : [
              {
                id: 'details',
                label: 'Details',
                content: (
                  <Container header={<Header variant="h2">AMI details</Header>}>
                    <SpaceBetween size="m">
                      <KeyValuePairs
                        columns={3}
                        items={[
                          {
                            label: 'AMI ID',
                            value: <Box variant="code">{image.imageId}</Box>,
                          },
                          { label: 'Name', value: image.name ?? '—' },
                          {
                            label: 'State',
                            value: <StatusBadge status={imageStatusName(image.state)} />,
                          },
                          { label: 'Owner', value: image.ownerAlias ?? image.ownerId ?? '—' },
                          { label: 'Owner ID', value: image.ownerId ?? '—' },
                          { label: 'Architecture', value: image.architecture ?? '—' },
                          {
                            label: 'Platform',
                            value: image.platformDetails ?? image.platform ?? 'Linux/UNIX',
                          },
                          { label: 'Image type', value: image.imageType ?? '—' },
                          { label: 'Root device name', value: image.rootDeviceName ?? '—' },
                          { label: 'Root device type', value: image.rootDeviceType ?? '—' },
                          { label: 'Virtualization type', value: image.virtualizationType ?? '—' },
                          { label: 'Creation date', value: formatDateTime(image.creationDate) },
                          { label: 'Public', value: image.isPublic === true ? 'Yes' : 'No' },
                          {
                            label: 'Tags',
                            value: image.tags.length === 0 ? 'No tags' : `${image.tags.length}`,
                          },
                        ]}
                      />
                      {image.description === undefined ? null : (
                        <Box>
                          <Box variant="strong" display="inline">
                            Description:{' '}
                          </Box>
                          {image.description}
                        </Box>
                      )}
                    </SpaceBetween>
                  </Container>
                ),
              },
              {
                id: 'block-devices',
                label: 'Block devices',
                content: (
                  <Container
                    header={
                      <Header
                        variant="h2"
                        description="The volumes an instance launched from this AMI starts with. The launch wizard lets you resize the root volume."
                      >
                        Block devices
                      </Header>
                    }
                  >
                    <Table<ImageBlockDevice>
                      variant="embedded"
                      items={[...blockDevices]}
                      columnDefinitions={blockDeviceColumns}
                      trackBy={(device) => device.deviceName}
                      ariaLabels={{ tableLabel: 'AMI block devices' }}
                      empty={
                        <Box textAlign="center" color="text-body-secondary">
                          LocalStack reported no block devices for this image.
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
                  <Container header={<Header variant="h2">Tags</Header>}>
                    <TagsEditor
                      tags={image.tags}
                      onChange={() => undefined}
                      readOnly
                      description="AMIs are read-only in LocalDeck: LocalStack reports their tags but CreateImage and image tagging are not part of this module."
                    />
                  </Container>
                ),
              },
            ]
      }
    />
  );
}

export default AmiDetailPage;
