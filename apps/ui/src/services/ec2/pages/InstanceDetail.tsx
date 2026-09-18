import type { ApiError } from '@localdeck/shared';
import Box from '@cloudscape-design/components/box';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { ResourceDetailPage } from '../../../components/ResourceDetailPage';
import { StatusBadge } from '../../../components/StatusBadge';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { usePolling } from '../../../hooks/usePolling';
import { toApiError } from '../../../lib/apiClient';
import { formatDateTime } from '../../../lib/format';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import {
  getInstance,
  instanceName,
  isTransitionalInstanceState,
  rebootInstances,
  startInstances,
  stopInstances,
  terminateInstances,
  type Ec2Instance,
} from '../api';
import { toFriendlyEc2Error } from '../errors';
import { EmulatedBadge } from '../components/EmulatedBadge';
import { InstanceActionModal, type InstanceAction } from '../components/InstanceActionModal';
import { InstanceSecurityTab } from '../components/InstanceSecurityTab';
import { InstanceStorageTab } from '../components/InstanceStorageTab';
import { ResourceTagsTab } from '../components/ResourceTagsTab';

/** How often the detail page reloads while the instance is still settling. */
const POLL_INTERVAL_MS = 10_000;

function canRun(action: InstanceAction, instance: Ec2Instance): boolean {
  switch (action) {
    case 'start':
      return instance.state === 'stopped';
    case 'stop':
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
 * One EC2 instance: Details / Security / Storage / Tags, with the instance's
 * lifecycle actions in the header. The page polls every 10 seconds while the
 * instance is pending, stopping or shutting down, so the state transition the
 * launch wizard started shows up without a manual refresh. The Emulated badge
 * in the header stays visible on every tab.
 */
export function InstanceDetailPage({ descriptor }: ServicePageProps): ReactElement {
  const { instanceId = '' } = useParams();
  const flashbar = useFlashbar();

  const [instance, setInstance] = useState<Ec2Instance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [action, setAction] = useState<InstanceAction | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const id = requestId.current + 1;
    requestId.current = id;
    setLoading(true);
    try {
      const result = await getInstance(instanceId);
      if (requestId.current !== id) return;
      setInstance(result);
      setError(null);
    } catch (caught) {
      if (requestId.current !== id) return;
      setInstance(null);
      setError(toApiError(caught));
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [instanceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- instance lookup for the route
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  const transitional = instance !== null && isTransitionalInstanceState(instance.state);

  usePolling(transitional, POLL_INTERVAL_MS, () => {
    void load();
  });

  const confirmAction = async (): Promise<void> => {
    if (action === null || instance === null) return;
    setActing(true);
    setActionError(null);
    try {
      if (action === 'start') await startInstances([instance.instanceId]);
      if (action === 'stop') await stopInstances([instance.instanceId]);
      if (action === 'reboot') await rebootInstances([instance.instanceId]);
      if (action === 'terminate') await terminateInstances([instance.instanceId]);

      flashbar.notify({
        type: 'success',
        header: `Instance ${ACTION_PROGRESS[action]}`,
        content: instance.instanceId,
      });
      setAction(null);
    } catch (caught) {
      setActionError(toFriendlyEc2Error(caught).message);
    } finally {
      setActing(false);
      void load();
    }
  };

  const listingPath = `${serviceConsolePath(descriptor.id)}/instances`;

  return (
    <>
      <ResourceDetailPage
        title={instance === null ? instanceId : instanceName(instance)}
        description={
          instance === null ? (
            descriptor.summary
          ) : (
            <SpaceBetween direction="horizontal" size="xs">
              <Box variant="code" display="inline">
                {instance.instanceId}
              </Box>
              <Box display="inline" color="text-body-secondary">
                · {instance.instanceType} · {instance.availabilityZone ?? 'unknown zone'}
              </Box>
            </SpaceBetween>
          )
        }
        breadcrumbs={[
          { text: descriptor.displayName, href: serviceConsolePath(descriptor.id) },
          { text: 'Instances', href: listingPath },
          { text: instance === null ? instanceId : instanceName(instance) },
        ]}
        loading={loading}
        error={error}
        onRetry={() => {
          void load();
        }}
        status={
          instance === null ? undefined : (
            <SpaceBetween direction="horizontal" size="xs">
              <StatusBadge status={instance.state} />
              <EmulatedBadge detail="LocalStack emulates this instance in memory: it answers the EC2 API and tracks lifecycle state, but no real compute is provisioned. The state lives only for this LocalStack session." />
            </SpaceBetween>
          )
        }
        headerActions={
          instance === null ? undefined : (
            <ButtonDropdown
              ariaLabel="Instance actions"
              items={(['start', 'stop', 'reboot', 'terminate'] as const).map((candidate) => ({
                id: candidate,
                text: ACTION_LABELS[candidate],
                disabled: !canRun(candidate, instance),
              }))}
              onItemClick={({ detail }) => {
                setActionError(null);
                setAction(detail.id as InstanceAction);
              }}
            >
              Instance actions
            </ButtonDropdown>
          )
        }
        tabs={
          instance === null
            ? []
            : [
                {
                  id: 'details',
                  label: 'Details',
                  content: (
                    <Container header={<Header variant="h2">Instance details</Header>}>
                      <KeyValuePairs
                        columns={3}
                        items={[
                          {
                            label: 'Instance ID',
                            value: <Box variant="code">{instance.instanceId}</Box>,
                          },
                          {
                            label: 'Instance state',
                            value: <StatusBadge status={instance.state} />,
                          },
                          { label: 'Instance type', value: instance.instanceType },
                          {
                            label: 'Availability Zone',
                            value: instance.availabilityZone ?? '—',
                          },
                          { label: 'Launch time', value: formatDateTime(instance.launchTime) },
                          {
                            label: 'AMI ID',
                            value:
                              instance.imageId === undefined ? (
                                '—'
                              ) : (
                                <Box variant="code">{instance.imageId}</Box>
                              ),
                          },
                          { label: 'Key pair name', value: instance.keyName ?? '—' },
                          { label: 'Architecture', value: instance.architecture ?? '—' },
                          { label: 'Platform', value: instance.platformDetails ?? '—' },
                          { label: 'Public IPv4 address', value: instance.publicIpAddress ?? '—' },
                          {
                            label: 'Private IPv4 address',
                            value: instance.privateIpAddress ?? '—',
                          },
                          { label: 'Public DNS name', value: instance.publicDnsName ?? '—' },
                          { label: 'Private DNS name', value: instance.privateDnsName ?? '—' },
                          { label: 'VPC ID', value: instance.vpcId ?? '—' },
                          { label: 'Subnet ID', value: instance.subnetId ?? '—' },
                          { label: 'Root device name', value: instance.rootDeviceName ?? '—' },
                          { label: 'Root device type', value: instance.rootDeviceType ?? '—' },
                          {
                            label: 'Virtualization type',
                            value: instance.virtualizationType ?? '—',
                          },
                          { label: 'Monitoring', value: instance.monitoringState ?? '—' },
                        ]}
                      />
                    </Container>
                  ),
                },
                {
                  id: 'security',
                  label: 'Security',
                  content: <InstanceSecurityTab instance={instance} />,
                },
                {
                  id: 'storage',
                  label: 'Storage',
                  content: <InstanceStorageTab instance={instance} />,
                },
                {
                  id: 'tags',
                  label: 'Tags',
                  content: (
                    <ResourceTagsTab
                      key={instance.instanceId}
                      resourceId={instance.instanceId}
                      tags={instance.tags}
                      description="Tags applied to the instance. Saving applies only the changed keys through CreateTags and DeleteTags."
                      onSaved={() => {
                        void load();
                      }}
                    />
                  ),
                },
              ]
        }
      />

      {action === null || instance === null ? null : (
        <InstanceActionModal
          visible
          action={action}
          instances={[instance]}
          loading={acting}
          {...(actionError === null ? {} : { errorText: actionError })}
          onDismiss={() => {
            if (acting) return;
            setAction(null);
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

export default InstanceDetailPage;
