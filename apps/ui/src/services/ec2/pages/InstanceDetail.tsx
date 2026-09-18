import Box from '@cloudscape-design/components/box';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { ResourceDetailPage } from '../../../components/ResourceDetailPage';
import { StatusBadge } from '../../../components/StatusBadge';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { usePolling } from '../../../hooks/usePolling';
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
} from '../api';
import { toFriendlyEc2Error } from '../errors';
import { useEc2Resource, useTransitionTracking } from '../hooks';
import {
  canRunInstanceAction,
  INSTANCE_ACTION_LABELS,
  INSTANCE_ACTION_PROGRESS,
  INSTANCE_ACTIONS,
  type InstanceAction,
} from '../instanceActions';
import { EmulatedBadge } from '../components/EmulatedBadge';
import { InstanceActionModal } from '../components/InstanceActionModal';
import { InstanceSecurityTab } from '../components/InstanceSecurityTab';
import { InstanceStorageTab } from '../components/InstanceStorageTab';
import { ResourceTagsTab } from '../components/ResourceTagsTab';

/** How often the detail page reloads while the instance is still settling. */
const POLL_INTERVAL_MS = 10_000;

/**
 * One EC2 instance: Details / Security / Storage / Tags, with the instance's
 * lifecycle actions in the header. The page polls every 10 seconds while the
 * instance is pending, stopping or shutting down, and for a short window after
 * an action, so the state transition shows up without a manual refresh. The
 * tabs stay mounted while a background refresh runs: a poll never replaces the
 * page with a full-page spinner. The Emulated badge in the header stays visible
 * on every tab.
 */
export function InstanceDetailPage({ descriptor }: ServicePageProps): ReactElement {
  const { instanceId = '' } = useParams();
  const flashbar = useFlashbar();

  const loader = useCallback(() => getInstance(instanceId), [instanceId]);
  const { data: instance, loading, refreshing, error, reload } = useEc2Resource(loader);

  const [action, setAction] = useState<InstanceAction | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { forcedTracking, trackTransition } = useTransitionTracking();
  const transitional = instance !== null && isTransitionalInstanceState(instance.state);
  usePolling(transitional || forcedTracking, POLL_INTERVAL_MS, () => reload());

  const confirmAction = async (): Promise<void> => {
    if (acting || action === null || instance === null) return;
    setActing(true);
    setActionError(null);
    try {
      if (action === 'start') await startInstances([instance.instanceId]);
      if (action === 'stop') await stopInstances([instance.instanceId]);
      if (action === 'reboot') await rebootInstances([instance.instanceId]);
      if (action === 'terminate') await terminateInstances([instance.instanceId]);

      // The request being accepted is not the transition finishing: report it
      // as information and let the polling window show the state settle.
      flashbar.notify({
        type: 'info',
        header: `Instance ${INSTANCE_ACTION_PROGRESS[action]} requested`,
        content: `${instance.instanceId} — the page refreshes automatically while the state changes.`,
      });
      trackTransition();
      setAction(null);
    } catch (caught) {
      setActionError(toFriendlyEc2Error(caught).message);
    } finally {
      setActing(false);
      void reload();
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
        loading={loading || refreshing}
        keepTabsMounted={instance !== null}
        notifications={
          transitional || forcedTracking ? (
            <Box color="text-body-secondary">
              Refreshing automatically every 10 seconds while the instance state settles.
            </Box>
          ) : undefined
        }
        error={error}
        onRetry={() => {
          void reload();
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
              items={INSTANCE_ACTIONS.map((candidate) => ({
                id: candidate,
                text: INSTANCE_ACTION_LABELS[candidate],
                disabled: !canRunInstanceAction(candidate, instance),
              }))}
              onItemClick={({ detail }) => {
                if (acting) return;
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
                  content: (
                    <InstanceSecurityTab
                      instanceId={instance.instanceId}
                      securityGroupIds={instance.securityGroups.map((group) => group.id)}
                      serviceId={descriptor.id}
                    />
                  ),
                },
                {
                  id: 'storage',
                  label: 'Storage',
                  content: <InstanceStorageTab instance={instance} serviceId={descriptor.id} />,
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
                        void reload();
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
