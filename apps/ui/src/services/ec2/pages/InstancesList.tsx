import type { TableProps } from '@cloudscape-design/components/table';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import Link from '@cloudscape-design/components/link';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { ResourceListPage } from '../../../components/ResourceListPage';
import { StatusBadge } from '../../../components/StatusBadge';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { usePolling } from '../../../hooks/usePolling';
import { formatDateTime } from '../../../lib/format';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import {
  instanceName,
  isTransitionalInstanceState,
  listInstances,
  rebootInstances,
  startInstances,
  stopInstances,
  terminateInstances,
  type Ec2Instance,
} from '../api';
import { toFriendlyEc2Error } from '../errors';
import { InstanceActionModal, type InstanceAction } from '../components/InstanceActionModal';

/** How often the list reloads while an instance is still settling. */
const POLL_INTERVAL_MS = 10_000;

/** Which lifecycle actions make sense for the instance's current state. */
function canRun(action: InstanceAction, instance: Ec2Instance): boolean {
  switch (action) {
    case 'start':
      return instance.state === 'stopped';
    case 'stop':
      return instance.state === 'running';
    case 'reboot':
      return instance.state === 'running';
    case 'terminate':
      return instance.state !== 'terminated' && instance.state !== 'shutting-down';
  }
}

const ACTION_LABELS: Readonly<Record<InstanceAction, string>> = {
  start: 'Start instance',
  stop: 'Stop instance',
  reboot: 'Reboot instance',
  terminate: 'Terminate instance',
};

/** In-flight wording for the flashbar ("Instance stopping"). */
const ACTION_PROGRESS: Readonly<Record<InstanceAction, string>> = {
  start: 'starting',
  stop: 'stopping',
  reboot: 'rebooting',
  terminate: 'terminating',
};

/**
 * The console's instances list: Name, Instance ID, state, type, availability
 * zone and launch time, with row and bulk lifecycle actions behind confirmation
 * modals. While any instance is pending, stopping or shutting down the page
 * refreshes every 10 seconds so the state transition shows up without a manual
 * reload.
 */
export function InstancesListPage({ descriptor }: ServicePageProps): ReactElement {
  const navigate = useNavigate();
  const flashbar = useFlashbar();
  const [filteringText, setFilteringText] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [transitional, setTransitional] = useState(false);
  const [action, setAction] = useState<InstanceAction | null>(null);
  const [targets, setTargets] = useState<readonly Ec2Instance[]>([]);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchPage = useCallback(async (options: { nextToken?: string; signal?: AbortSignal }) => {
    const page = await listInstances({
      ...(options.nextToken === undefined ? {} : { nextToken: options.nextToken }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const hasTransitional = page.items.some((instance) =>
      isTransitionalInstanceState(instance.state),
    );
    setTransitional((previous) => (previous === hasTransitional ? previous : hasTransitional));
    return page;
  }, []);

  usePolling(transitional, POLL_INTERVAL_MS, () => {
    setReloadToken((token) => token + 1);
  });

  const instancePath = useCallback(
    (instanceId: string): string =>
      `${serviceConsolePath(descriptor.id)}/instances/${encodeURIComponent(instanceId)}`,
    [descriptor.id],
  );

  const openInstance = useCallback(
    (instanceId: string) => {
      navigate(instancePath(instanceId));
    },
    [navigate, instancePath],
  );

  const columns = useMemo<readonly TableProps.ColumnDefinition<Ec2Instance>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        sortingField: 'name',
        isRowHeader: true,
        cell: (instance) => (
          <Link
            href={instancePath(instance.instanceId)}
            onFollow={(event) => {
              event.preventDefault();
              openInstance(instance.instanceId);
            }}
          >
            {instance.name ?? '—'}
          </Link>
        ),
      },
      {
        id: 'instanceId',
        header: 'Instance ID',
        sortingField: 'instanceId',
        cell: (instance) => (
          <Link
            href={instancePath(instance.instanceId)}
            onFollow={(event) => {
              event.preventDefault();
              openInstance(instance.instanceId);
            }}
          >
            <Box variant="code" display="inline">
              {instance.instanceId}
            </Box>
          </Link>
        ),
      },
      {
        id: 'state',
        header: 'Instance state',
        sortingField: 'state',
        cell: (instance) => <StatusBadge status={instance.state} />,
      },
      {
        id: 'instanceType',
        header: 'Instance type',
        sortingField: 'instanceType',
        cell: (instance) => instance.instanceType,
      },
      {
        id: 'availabilityZone',
        header: 'Availability Zone',
        sortingField: 'availabilityZone',
        cell: (instance) => instance.availabilityZone ?? '—',
      },
      {
        id: 'launchTime',
        header: 'Launch time',
        sortingField: 'launchTime',
        cell: (instance) => formatDateTime(instance.launchTime),
      },
    ],
    [instancePath, openInstance],
  );

  const startAction = (next: InstanceAction, instances: readonly Ec2Instance[]): void => {
    const eligible = instances.filter((instance) => canRun(next, instance));
    if (eligible.length === 0) {
      flashbar.notify({
        type: 'warning',
        header: `No instance can be ${next === 'terminate' ? 'terminated' : `${next}ed`}`,
        content: 'The selected instances are already in the target state.',
      });
      return;
    }
    setActionError(null);
    setAction(next);
    setTargets(eligible);
  };

  const confirmAction = async (): Promise<void> => {
    if (action === null || targets.length === 0) return;
    const ids = targets.map((instance) => instance.instanceId);
    setActing(true);
    setActionError(null);
    try {
      if (action === 'start') await startInstances(ids);
      if (action === 'stop') await stopInstances(ids);
      if (action === 'reboot') await rebootInstances(ids);
      if (action === 'terminate') await terminateInstances(ids);

      flashbar.notify({
        type: 'success',
        header: `${ids.length === 1 ? 'Instance' : 'Instances'} ${ACTION_PROGRESS[action]}`,
        content: ids.join(', '),
      });
      setAction(null);
      setTargets([]);
    } catch (caught) {
      setActionError(toFriendlyEc2Error(caught).message);
    } finally {
      setActing(false);
      setReloadToken((token) => token + 1);
    }
  };

  const actionItems = (instances: readonly Ec2Instance[]) =>
    (['start', 'stop', 'reboot', 'terminate'] as const).map((candidate) => ({
      id: candidate,
      text: ACTION_LABELS[candidate],
      disabled: instances.filter((instance) => canRun(candidate, instance)).length === 0,
    }));

  return (
    <>
      <ResourceListPage<Ec2Instance>
        title="Instances"
        description={descriptor.summary}
        breadcrumbs={[
          { text: descriptor.displayName, href: serviceConsolePath(descriptor.id) },
          { text: 'Instances' },
        ]}
        columns={columns}
        getRowId={(instance) => instance.instanceId}
        reloadToken={reloadToken}
        fetcher={fetchPage}
        filtering={{
          text: filteringText,
          onChange: setFilteringText,
          placeholder: 'Find instances by name, ID, type or state',
          match: (instance, text) => {
            const needle = text.trim().toLowerCase();
            return [
              instance.name ?? '',
              instance.instanceId,
              instance.instanceType,
              instance.state,
              instance.availabilityZone ?? '',
              instance.imageId ?? '',
            ].some((value) => value.toLowerCase().includes(needle));
          },
        }}
        headerActions={
          <Button
            variant="primary"
            onClick={() => {
              navigate(`${serviceConsolePath(descriptor.id)}/instances/launch`);
            }}
          >
            Launch instance
          </Button>
        }
        notifications={
          transitional ? (
            <Box color="text-body-secondary">
              Refreshing automatically every 10 seconds while instances are pending or stopping.
            </Box>
          ) : undefined
        }
        rowActions={(instance) => (
          <ButtonDropdown
            variant="icon"
            ariaLabel={`Actions for ${instanceName(instance)}`}
            items={actionItems([instance])}
            onItemClick={({ detail }) => {
              startAction(detail.id as InstanceAction, [instance]);
            }}
          />
        )}
        bulkActions={(selected) => (
          <ButtonDropdown
            ariaLabel="Instance actions"
            items={actionItems(selected)}
            onItemClick={({ detail }) => {
              startAction(detail.id as InstanceAction, selected);
            }}
          >
            Instance actions
          </ButtonDropdown>
        )}
        emptyTitle="No instances"
        emptyDescription="An instance is a virtual machine LocalStack emulates. Launch one to see it here."
      />

      {action === null ? null : (
        <InstanceActionModal
          visible
          action={action}
          instances={targets}
          loading={acting}
          {...(actionError === null ? {} : { errorText: actionError })}
          onDismiss={() => {
            if (acting) return;
            setAction(null);
            setTargets([]);
            setActionError(null);
          }}
          onConfirm={() => {
            void confirmAction();
          }}
        />
      )}
    </>
  );
}

export default InstancesListPage;
