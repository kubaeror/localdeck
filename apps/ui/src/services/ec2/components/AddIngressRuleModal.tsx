import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import RadioGroup from '@cloudscape-design/components/radio-group';
import Select from '@cloudscape-design/components/select';
import type { SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState, type ReactElement } from 'react';
import { authorizeSecurityGroupIngress } from '../api';
import { toFriendlyEc2Error } from '../errors';

export interface AddIngressRuleModalProps {
  groupId: string;
  groupName: string;
  onDismiss: () => void;
  onAdded: () => void;
}

const PROTOCOLS: readonly SelectProps.Option[] = [
  { label: 'TCP', value: 'tcp' },
  { label: 'UDP', value: 'udp' },
  { label: 'ICMP', value: 'icmp' },
  { label: 'All traffic', value: '-1' },
];

type SourceKind = 'anywhere' | 'cidr' | 'ipv6';

/**
 * Add one inbound rule to a security group (`AuthorizeSecurityGroupIngress`).
 * The console's common shapes are covered: protocol, port range, and either
 * "Anywhere" (0.0.0.0/0), a custom IPv4 CIDR or an IPv6 CIDR.
 */
export function AddIngressRuleModal({
  groupId,
  groupName,
  onDismiss,
  onAdded,
}: AddIngressRuleModalProps): ReactElement {
  const [protocol, setProtocol] = useState<string>('tcp');
  const [fromPort, setFromPort] = useState('80');
  const [toPort, setToPort] = useState('80');
  const [sourceKind, setSourceKind] = useState<SourceKind>('anywhere');
  const [cidr, setCidr] = useState('0.0.0.0/0');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const portRequired = protocol === 'tcp' || protocol === 'udp';
  const from = Number.parseInt(fromPort, 10);
  const to = Number.parseInt(toPort, 10);
  const portProblem = !portRequired
    ? null
    : !Number.isInteger(from) || !Number.isInteger(to)
      ? 'Enter port numbers between 0 and 65535.'
      : from < 0 || from > 65535 || to < 0 || to > 65535
        ? 'Ports must be between 0 and 65535.'
        : from > to
          ? 'The first port must not be greater than the last port.'
          : null;

  const cidrProblem =
    sourceKind === 'anywhere'
      ? null
      : cidr.trim().length === 0
        ? 'Enter a CIDR block.'
        : sourceKind === 'cidr'
          ? /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(cidr.trim())
            ? null
            : 'Use IPv4 CIDR notation, for example 203.0.113.0/24.'
          : /^[0-9a-fA-F:]+\/\d{1,3}$/.test(cidr.trim())
            ? null
            : 'Use IPv6 CIDR notation, for example 2001:db8::/32.';

  const submit = async (): Promise<void> => {
    if (portProblem !== null || cidrProblem !== null) return;
    setSubmitting(true);
    setError(null);
    try {
      await authorizeSecurityGroupIngress({
        groupId,
        rule: {
          protocol,
          ...(portRequired ? { fromPort: from, toPort: to } : {}),
          ...(sourceKind === 'cidr' ? { cidrIpv4: [cidr.trim()] } : {}),
          ...(sourceKind === 'anywhere' ? { cidrIpv4: ['0.0.0.0/0'] } : {}),
          ...(sourceKind === 'ipv6' ? { cidrIpv6: [cidr.trim()] } : {}),
          ...(description.trim().length === 0 ? {} : { description: description.trim() }),
        },
      });
      onAdded();
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
      header={`Add inbound rule to ${groupName}`}
      size="medium"
      closeAriaLabel="Close add inbound rule"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={submitting}
              disabled={portProblem !== null || cidrProblem !== null}
              onClick={() => {
                void submit();
              }}
            >
              Add rule
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Form>
        <SpaceBetween size="m">
          {error === null ? null : <Alert type="error">{error}</Alert>}

          <FormField label="Protocol">
            <Select
              selectedOption={PROTOCOLS.find((option) => option.value === protocol) ?? null}
              options={[...PROTOCOLS]}
              ariaLabel="Protocol"
              onChange={({ detail }) => {
                setProtocol(detail.selectedOption.value ?? 'tcp');
              }}
            />
          </FormField>

          {portRequired ? (
            <SpaceBetween direction="horizontal" size="s">
              <FormField label="From port" errorText={portProblem ?? undefined}>
                <Input
                  value={fromPort}
                  inputMode="numeric"
                  ariaLabel="From port"
                  onChange={({ detail }) => {
                    setFromPort(detail.value);
                  }}
                />
              </FormField>
              <FormField label="To port">
                <Input
                  value={toPort}
                  inputMode="numeric"
                  ariaLabel="To port"
                  onChange={({ detail }) => {
                    setToPort(detail.value);
                  }}
                />
              </FormField>
            </SpaceBetween>
          ) : null}

          <FormField label="Source">
            <RadioGroup
              value={sourceKind}
              items={[
                { value: 'anywhere', label: 'Anywhere', description: '0.0.0.0/0 (IPv4)' },
                { value: 'cidr', label: 'Custom IPv4 CIDR' },
                { value: 'ipv6', label: 'Custom IPv6 CIDR' },
              ]}
              onChange={({ detail }) => {
                setSourceKind(detail.value as SourceKind);
                if (detail.value === 'cidr') setCidr('0.0.0.0/0');
                if (detail.value === 'ipv6') setCidr('::/0');
              }}
            />
          </FormField>

          {sourceKind === 'anywhere' ? null : (
            <FormField
              label={sourceKind === 'cidr' ? 'IPv4 CIDR' : 'IPv6 CIDR'}
              errorText={cidrProblem ?? undefined}
            >
              <Input
                value={cidr}
                ariaLabel="CIDR block"
                onChange={({ detail }) => {
                  setCidr(detail.value);
                }}
              />
            </FormField>
          )}

          <FormField
            label="Description"
            description="Optional. Shown with the rule in the rules table."
          >
            <Input
              value={description}
              placeholder="Allow HTTP from anywhere"
              ariaLabel="Rule description"
              onChange={({ detail }) => {
                setDescription(detail.value);
              }}
            />
          </FormField>
        </SpaceBetween>
      </Form>
    </Modal>
  );
}

export default AddIngressRuleModal;
