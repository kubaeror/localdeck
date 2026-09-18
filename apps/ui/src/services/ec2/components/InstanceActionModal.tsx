import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState, type ReactElement, type ReactNode } from 'react';
import { instanceName, type Ec2Instance } from '../api';

/** The four lifecycle actions the instances list and detail page offer. */
export type InstanceAction = 'start' | 'stop' | 'reboot' | 'terminate';

interface ActionWording {
  verb: string;
  title: string;
  submitLabel: string;
  alertType: 'info' | 'warning';
  description: ReactNode;
  /** `terminate` is permanent, so it needs the console's typed confirmation. */
  destructive: boolean;
}

const WORDING: Readonly<Record<InstanceAction, ActionWording>> = {
  start: {
    verb: 'start',
    title: 'Start instance',
    submitLabel: 'Start',
    alertType: 'info',
    description:
      'Starting an instance boots its operating system. The instance keeps its instance ID, private IP addresses and attached EBS volumes.',
    destructive: false,
  },
  stop: {
    verb: 'stop',
    title: 'Stop instance',
    submitLabel: 'Stop',
    alertType: 'warning',
    description:
      'Stopping an instance shuts down its operating system. Any data on instance store volumes is lost, and the instance keeps its instance ID and EBS volumes.',
    destructive: false,
  },
  reboot: {
    verb: 'reboot',
    title: 'Reboot instance',
    submitLabel: 'Reboot',
    alertType: 'warning',
    description:
      'Rebooting an instance restarts its operating system. The instance keeps its instance ID, private IP addresses and attached EBS volumes.',
    destructive: false,
  },
  terminate: {
    verb: 'terminate',
    title: 'Terminate instance',
    submitLabel: 'Terminate',
    alertType: 'warning',
    description:
      'Terminating an instance is permanent. The instance is shut down and cannot be recovered. EBS volumes created with DeleteOnTermination are deleted, and the public IP address is released.',
    destructive: true,
  },
};

export interface InstanceActionModalProps {
  visible: boolean;
  action: InstanceAction;
  /** Instances the action applies to (one for a row action, many for bulk). */
  instances: readonly Ec2Instance[];
  loading?: boolean;
  errorText?: ReactNode;
  onDismiss: () => void;
  onConfirm: () => void;
}

/**
 * The console's confirmation for instance lifecycle actions. Start, stop and
 * reboot are reversible and only ask once; terminate is destructive and stays
 * locked until the user types the instance ID (or `terminate` for a bulk
 * selection), the same typed-confirmation pattern the delete primitives use.
 */
export function InstanceActionModal({
  visible,
  action,
  instances,
  loading = false,
  errorText,
  onDismiss,
  onConfirm,
}: InstanceActionModalProps): ReactElement {
  const wording = WORDING[action];
  const [typed, setTyped] = useState('');
  const required = instances.length === 1 ? (instances[0]?.instanceId ?? '') : 'terminate';
  const confirmed = !wording.destructive || (typed === required && required.length > 0);

  const plural = instances.length === 1 ? '' : 's';

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header={`${wording.title}${plural}`}
      size="medium"
      closeAriaLabel={`Close ${wording.title.toLowerCase()} confirmation`}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss}>
              Cancel
            </Button>
            <Button variant="primary" loading={loading} disabled={!confirmed} onClick={onConfirm}>
              {wording.destructive ? `Terminate instance${plural}` : wording.submitLabel}
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {errorText === undefined ? null : <Alert type="error">{errorText}</Alert>}

        <Alert type={wording.alertType}>{wording.description}</Alert>

        <SpaceBetween size="xs">
          <Box color="text-body-secondary">
            {instances.length === 1
              ? 'The following instance is affected:'
              : `${instances.length} instances are affected:`}
          </Box>
          <SpaceBetween size="xxs">
            {instances.slice(0, 10).map((instance) => (
              <Box key={instance.instanceId}>
                <Box variant="code" display="inline">
                  {instanceName(instance)}
                </Box>{' '}
                <Box variant="small" color="text-body-secondary" display="inline">
                  ({instance.instanceId})
                </Box>
              </Box>
            ))}
            {instances.length > 10 ? (
              <Box color="text-body-secondary">…and {instances.length - 10} more</Box>
            ) : null}
          </SpaceBetween>
        </SpaceBetween>

        {wording.destructive ? (
          <FormField
            label={`To confirm, type "${required}" in the field below.`}
            errorText={
              typed.length > 0 && !confirmed ? `Enter "${required}" to continue.` : undefined
            }
          >
            <Input
              value={typed}
              autoFocus
              disabled={loading}
              ariaLabel={`Confirm ${wording.verb} of ${instances.map((instance) => instance.instanceId).join(', ')}`}
              onChange={({ detail }) => {
                setTyped(detail.value);
              }}
            />
          </FormField>
        ) : null}
      </SpaceBetween>
    </Modal>
  );
}

export default InstanceActionModal;
