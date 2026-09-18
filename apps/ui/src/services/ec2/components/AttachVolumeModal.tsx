import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import Select from '@cloudscape-design/components/select';
import type { SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  attachVolume,
  instanceName,
  listInstances,
  listVolumes,
  type Ec2Instance,
  type Ec2Volume,
} from '../api';
import { toFriendlyEc2Error } from '../errors';

export interface AttachVolumeModalProps {
  /** Preselected volume (the volume detail page). */
  volumeId?: string;
  /** Preselected instance (the instance storage tab). */
  instanceId?: string;
  onDismiss: () => void;
  onAttached: () => void;
}

const DEVICE_PATTERN = /^\/dev\/sd[a-z]$/;
const DEFAULT_DEVICE = '/dev/sdf';

/**
 * Attach an EBS volume to an instance, from either side of the relationship:
 * the volume detail page preselects the volume, the instance storage tab
 * preselects the instance. Only volumes that are not in use are offered.
 */
export function AttachVolumeModal({
  volumeId,
  instanceId,
  onDismiss,
  onAttached,
}: AttachVolumeModalProps): ReactElement {
  const [volumes, setVolumes] = useState<readonly Ec2Volume[]>([]);
  const [instances, setInstances] = useState<readonly Ec2Instance[]>([]);
  const [selectedVolumeId, setSelectedVolumeId] = useState<string | null>(volumeId ?? null);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(instanceId ?? null);
  const [device, setDevice] = useState(DEFAULT_DEVICE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      setLoading(true);
      try {
        const [volumePage, instancePage] = await Promise.all([
          listVolumes({ filters: [{ Name: 'status', Values: ['available'] }] }),
          listInstances(),
        ]);
        if (cancelled) return;
        setVolumes(volumePage.items);
        setInstances(instancePage.items.filter((instance) => instance.state !== 'terminated'));
        setLoadError(null);
      } catch (caught) {
        if (cancelled) return;
        setLoadError(toFriendlyEc2Error(caught).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const volumeOptions = useMemo<readonly SelectProps.Option[]>(
    () =>
      volumes.map((volume) => ({
        label: `${volume.name ?? volume.volumeId} (${volume.volumeId})`,
        description: `${volume.sizeGiB ?? '?'} GiB ${volume.volumeType ?? ''} · ${volume.availabilityZone ?? 'unknown zone'}`,
        value: volume.volumeId,
      })),
    [volumes],
  );

  const instanceOptions = useMemo<readonly SelectProps.Option[]>(
    () =>
      instances.map((instance) => ({
        label: `${instanceName(instance)} (${instance.instanceId})`,
        description: `${instance.instanceType} · ${instance.state}`,
        value: instance.instanceId,
      })),
    [instances],
  );

  const selectedVolumeOption =
    volumeOptions.find((option) => option.value === selectedVolumeId) ?? null;
  const selectedInstanceOption =
    instanceOptions.find((option) => option.value === selectedInstanceId) ?? null;

  const deviceValid = DEVICE_PATTERN.test(device);
  const ready = selectedVolumeId !== null && selectedInstanceId !== null && deviceValid && !loading;

  const submit = async (): Promise<void> => {
    if (selectedVolumeId === null || selectedInstanceId === null) return;
    setSubmitting(true);
    setError(null);
    try {
      await attachVolume({
        volumeId: selectedVolumeId,
        instanceId: selectedInstanceId,
        device,
      });
      onAttached();
    } catch (caught) {
      setError(toFriendlyEc2Error(caught).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible
      onDismiss={onDismiss}
      header="Attach volume"
      size="medium"
      closeAriaLabel="Close attach volume"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={submitting}
              disabled={!ready}
              onClick={() => {
                void submit();
              }}
            >
              Attach volume
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Form>
        <SpaceBetween size="m">
          {loadError === null ? null : <Alert type="error">{loadError}</Alert>}
          {error === null ? null : <Alert type="error">{error}</Alert>}

          <FormField
            label="Volume"
            description="Only volumes in the available state are listed."
            constraintText={
              loading || volumeOptions.length > 0
                ? undefined
                : 'No available volumes in this account.'
            }
          >
            <Select
              selectedOption={selectedVolumeOption}
              options={volumeOptions}
              disabled={loading || volumeId !== undefined}
              placeholder="Choose a volume"
              ariaLabel="Volume"
              onChange={({ detail }) => {
                setSelectedVolumeId(detail.selectedOption.value ?? null);
              }}
            />
          </FormField>

          <FormField label="Instance">
            <Select
              selectedOption={selectedInstanceOption}
              options={instanceOptions}
              disabled={loading || instanceId !== undefined}
              placeholder="Choose an instance"
              ariaLabel="Instance"
              onChange={({ detail }) => {
                setSelectedInstanceId(detail.selectedOption.value ?? null);
              }}
            />
          </FormField>

          <FormField
            label="Device name"
            description="The device name the instance sees, for example /dev/sdf (Linux) or xvdh (Windows)."
            errorText={device.length > 0 && !deviceValid ? 'Use a name like /dev/sdf.' : undefined}
          >
            <Input
              value={device}
              disabled={submitting}
              ariaLabel="Device name"
              onChange={({ detail }) => {
                setDevice(detail.value);
              }}
            />
          </FormField>
        </SpaceBetween>
      </Form>
    </Modal>
  );
}

export default AttachVolumeModal;
