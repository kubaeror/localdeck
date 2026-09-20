import type { TableProps } from '@cloudscape-design/components/table';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import Link from '@cloudscape-design/components/link';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { DeleteConfirmModal } from '../../../components/DeleteConfirmModal';
import { InfoTooltip } from '../../../components/InfoTooltip';
import { ResourceListPage } from '../../../components/ResourceListPage';
import { StatusBadge } from '../../../components/StatusBadge';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { usePolling } from '../../../hooks/usePolling';
import { formatDateTime } from '../../../lib/format';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import {
  deleteVolume,
  isTransitionalVolumeState,
  isVolumeAttached,
  listVolumes,
  type Ec2Volume,
} from '../api';
import { toFriendlyEc2Error } from '../errors';
import { volumeStatusName } from '../status';
import { AttachVolumeModal } from '../components/AttachVolumeModal';
import { EC2_PAGE_SIZE_OPTIONS } from '../listOptions';

/** How often the list reloads while a volume is creating or deleting. */
const POLL_INTERVAL_MS = 10_000;

const ATTACHED_REASON =
  'This volume is attached to an instance. Attach and delete stay disabled until the instance is terminated and the volume is released.';

/**
 * The console's volumes list: name, id, state, size, type, zone and attachment,
 * with creation, attachment and deletion. A volume that is attached to an
 * instance cannot be deleted, so its delete action stays disabled. The list
 * refreshes every 10 seconds while a volume is creating or deleting.
 */
export function VolumesListPage({ descriptor }: ServicePageProps): ReactElement {
  const navigate = useNavigate();
  const flashbar = useFlashbar();
  const [filteringText, setFilteringText] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [transitional, setTransitional] = useState(false);
  const [attachTarget, setAttachTarget] = useState<string | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<readonly Ec2Volume[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchPage = useCallback(async (options: { nextToken?: string; signal?: AbortSignal }) => {
    const page = await listVolumes({
      ...(options.nextToken === undefined ? {} : { nextToken: options.nextToken }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const hasTransitional = page.items.some((volume) => isTransitionalVolumeState(volume.state));
    setTransitional((previous) => (previous === hasTransitional ? previous : hasTransitional));
    return page;
  }, []);

  usePolling(transitional, POLL_INTERVAL_MS, () => {
    setReloadToken((token) => token + 1);
  });

  const volumePath = useCallback(
    (volumeId: string): string =>
      `${serviceConsolePath(descriptor.id)}/volumes/${encodeURIComponent(volumeId)}`,
    [descriptor.id],
  );

  const instancePath = useCallback(
    (instanceId: string): string =>
      `${serviceConsolePath(descriptor.id)}/instances/${encodeURIComponent(instanceId)}`,
    [descriptor.id],
  );

  const openVolume = useCallback(
    (volumeId: string) => {
      void navigate(volumePath(volumeId));
    },
    [navigate, volumePath],
  );

  const columns = useMemo<readonly TableProps.ColumnDefinition<Ec2Volume>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        sortingField: 'name',
        isRowHeader: true,
        cell: (volume) => (
          <Link
            href={volumePath(volume.volumeId)}
            onFollow={(event) => {
              event.preventDefault();
              openVolume(volume.volumeId);
            }}
          >
            {volume.name ?? '—'}
          </Link>
        ),
      },
      {
        id: 'volumeId',
        header: 'Volume ID',
        sortingField: 'volumeId',
        cell: (volume) => (
          <Link
            href={volumePath(volume.volumeId)}
            onFollow={(event) => {
              event.preventDefault();
              openVolume(volume.volumeId);
            }}
          >
            <Box variant="code" display="inline">
              {volume.volumeId}
            </Box>
          </Link>
        ),
      },
      {
        id: 'state',
        header: 'Volume state',
        sortingField: 'state',
        cell: (volume) => <StatusBadge status={volumeStatusName(volume.state)} />,
      },
      {
        id: 'size',
        header: 'Size',
        sortingField: 'sizeGiB',
        cell: (volume) => `${volume.sizeGiB ?? '?'} GiB`,
      },
      {
        id: 'volumeType',
        header: 'Volume type',
        sortingField: 'volumeType',
        cell: (volume) => volume.volumeType ?? '—',
      },
      {
        id: 'availabilityZone',
        header: 'Availability Zone',
        sortingField: 'availabilityZone',
        cell: (volume) => volume.availabilityZone ?? '—',
      },
      {
        id: 'attachedTo',
        header: 'Attached to',
        cell: (volume) => {
          const attachment = volume.attachments[0];
          if (attachment === undefined) return '—';
          return (
            <Link
              href={instancePath(attachment.instanceId)}
              onFollow={(event) => {
                event.preventDefault();
                void navigate(instancePath(attachment.instanceId));
              }}
            >
              {attachment.instanceId}
            </Link>
          );
        },
      },
      {
        id: 'created',
        header: 'Created',
        sortingField: 'createTime',
        cell: (volume) => formatDateTime(volume.createTime),
      },
      {
        id: 'encryption',
        header: 'Encryption',
        cell: (volume) => (volume.encrypted ? 'Encrypted' : 'Not encrypted'),
      },
    ],
    [instancePath, navigate, openVolume, volumePath],
  );

  const confirmDelete = async (): Promise<void> => {
    if (deleting) return;
    const targets = deleteTargets ?? [];
    if (targets.length === 0) return;
    setDeleting(true);
    setDeleteError(null);
    const failures: Ec2Volume[] = [];
    const failureMessages: string[] = [];
    for (const volume of targets) {
      try {
        await deleteVolume(volume.volumeId);
        flashbar.notify({
          type: 'success',
          header: 'Volume deleted',
          content: volume.name ?? volume.volumeId,
        });
      } catch (caught) {
        failures.push(volume);
        failureMessages.push(
          `${volume.name ?? volume.volumeId}: ${toFriendlyEc2Error(caught).message}`,
        );
      }
    }
    setDeleting(false);
    setReloadToken((token) => token + 1);
    if (failures.length > 0) {
      // Keep the modal open on the failed volumes so the user can read the
      // reason and retry without selecting them again.
      setDeleteTargets(failures);
      setDeleteError(
        `${failures.length} of ${targets.length} volume${targets.length === 1 ? '' : 's'} could not be deleted. ${failureMessages.join(' ')}`,
      );
      return;
    }
    setDeleteTargets(null);
  };

  const isFiltering = filteringText.trim().length > 0;

  return (
    <>
      <ResourceListPage<Ec2Volume>
        title="Volumes"
        description="EBS volumes provide block storage to instances. In LocalStack they are tracked as metadata; no bytes are stored."
        breadcrumbs={[
          { text: descriptor.displayName, href: serviceConsolePath(descriptor.id) },
          { text: 'Volumes' },
        ]}
        columns={columns}
        getRowId={(volume) => volume.volumeId}
        reloadToken={reloadToken}
        preferencesId="ec2-volumes-list"
        pageSizeOptions={EC2_PAGE_SIZE_OPTIONS}
        fetcher={fetchPage}
        filtering={{
          text: filteringText,
          onChange: setFilteringText,
          placeholder: 'Find volumes by name, ID, state or zone',
          match: (volume, text) => {
            const needle = text.trim().toLowerCase();
            return [
              volume.name ?? '',
              volume.volumeId,
              volume.state,
              volume.volumeType ?? '',
              volume.availabilityZone ?? '',
            ].some((value) => value.toLowerCase().includes(needle));
          },
        }}
        headerActions={
          <Button
            variant="primary"
            onClick={() => {
              void navigate(`${serviceConsolePath(descriptor.id)}/volumes/create`);
            }}
          >
            Create volume
          </Button>
        }
        notifications={
          <Box color="text-body-secondary">
            A volume that is attached to an instance cannot be deleted; its delete action stays
            disabled until the instance is terminated.
          </Box>
        }
        rowActions={(volume) => {
          const attached = isVolumeAttached(volume);
          const menu = (
            <ButtonDropdown
              variant="icon"
              ariaLabel={`Actions for ${volume.volumeId}`}
              items={[
                { id: 'view', text: 'View details' },
                { id: 'attach', text: 'Attach volume', disabled: attached },
                { id: 'delete', text: 'Delete volume', disabled: attached },
              ]}
              onItemClick={({ detail }) => {
                if (detail.id === 'view') openVolume(volume.volumeId);
                if (detail.id === 'attach') setAttachTarget(volume.volumeId);
                if (detail.id === 'delete') {
                  setDeleteError(null);
                  setDeleteTargets([volume]);
                }
              }}
            />
          );
          return attached ? <InfoTooltip content={ATTACHED_REASON}>{menu}</InfoTooltip> : menu;
        }}
        bulkActions={(selected) => (
          <ButtonDropdown
            ariaLabel="Volume actions"
            items={[
              {
                id: 'delete',
                text: 'Delete volumes',
                disabled: selected.some((volume) => isVolumeAttached(volume)),
              },
            ]}
            onItemClick={({ detail }) => {
              if (detail.id === 'delete') {
                setDeleteError(null);
                setDeleteTargets(selected.filter((volume) => !isVolumeAttached(volume)));
              }
            }}
          >
            Actions
          </ButtonDropdown>
        )}
        emptyTitle={isFiltering ? 'No matches' : 'No volumes'}
        emptyDescription={
          isFiltering
            ? 'No volume matches the current filter. Clear the filter or try another search term.'
            : 'Create a volume to attach extra block storage to an instance.'
        }
      />

      {attachTarget === null ? null : (
        <AttachVolumeModal
          volumeId={attachTarget}
          onDismiss={() => {
            setAttachTarget(null);
          }}
          onAttached={() => {
            setAttachTarget(null);
            flashbar.notify({ type: 'success', header: 'Volume attached', content: attachTarget });
            setReloadToken((token) => token + 1);
          }}
        />
      )}

      {deleteTargets === null ? null : (
        <DeleteConfirmModal
          visible
          title={deleteTargets.length === 1 ? 'Delete volume' : 'Delete volumes'}
          subjects={deleteTargets.map((volume) => volume.name ?? volume.volumeId)}
          description="Deleting a volume removes its data permanently. A volume that is still attached to an instance must be released first, and this action cannot be undone."
          confirmationText={deleteTargets.length === 1 ? undefined : 'delete'}
          submitLabel={deleteTargets.length === 1 ? 'Delete volume' : 'Delete volumes'}
          loading={deleting}
          {...(deleteError === null ? {} : { errorText: deleteError })}
          onDismiss={() => {
            if (deleting) return;
            setDeleteTargets(null);
            setDeleteError(null);
          }}
          onConfirm={() => {
            void confirmDelete();
          }}
        />
      )}
    </>
  );
}

export default VolumesListPage;
