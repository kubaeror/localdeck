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
import { useEffect, useState, type ReactElement } from 'react';
import { authorizeSecurityGroupIngress, listSecurityGroups, type Ec2SecurityGroup } from '../api';
import { isWorldOpenCidr, isValidIpv4Cidr, isValidIpv6Cidr } from '../cidr';
import { toFriendlyEc2Error } from '../errors';

export interface AddIngressRuleModalProps {
  groupId: string;
  groupName: string;
  /** The group's VPC, used to scope the source-security-group choices. */
  vpcId?: string;
  onDismiss: () => void;
  onAdded: () => void;
}

const PROTOCOLS: readonly SelectProps.Option[] = [
  { label: 'TCP', value: 'tcp' },
  { label: 'UDP', value: 'udp' },
  { label: 'ICMP', value: 'icmp' },
  { label: 'All traffic', value: '-1' },
];

type SourceKind = 'cidr' | 'ipv6' | 'anywhere' | 'group';

/**
 * Add one inbound rule to a security group (`AuthorizeSecurityGroupIngress`).
 * The console's common shapes are covered: protocol, port range, and a source
 * that is a custom IPv4/IPv6 CIDR, a security group in the same VPC, or
 * explicitly "Anywhere" (0.0.0.0/0). Custom is the default and CIDRs are
 * parsed for real; an internet-wide source raises a warning before Add.
 */
export function AddIngressRuleModal({
  groupId,
  groupName,
  vpcId,
  onDismiss,
  onAdded,
}: AddIngressRuleModalProps): ReactElement {
  const [protocol, setProtocol] = useState<string>('tcp');
  const [fromPort, setFromPort] = useState('80');
  const [toPort, setToPort] = useState('80');
  const [sourceKind, setSourceKind] = useState<SourceKind>('cidr');
  const [cidr, setCidr] = useState('');
  const [sourceGroupId, setSourceGroupId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [securityGroups, setSecurityGroups] = useState<readonly Ec2SecurityGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      setGroupsLoading(true);
      try {
        const page = await listSecurityGroups(
          vpcId === undefined ? {} : { filters: [{ Name: 'vpc-id', Values: [vpcId] }] },
        );
        if (cancelled) return;
        setSecurityGroups(page.items);
        setGroupsError(null);
      } catch (caught) {
        if (cancelled) return;
        setGroupsError(toFriendlyEc2Error(caught).message);
      } finally {
        if (!cancelled) setGroupsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [vpcId]);

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
    sourceKind === 'anywhere' || sourceKind === 'group'
      ? null
      : cidr.trim().length === 0
        ? 'Enter a CIDR block.'
        : sourceKind === 'cidr'
          ? isValidIpv4Cidr(cidr)
            ? null
            : 'Use IPv4 CIDR notation, for example 203.0.113.0/24.'
          : isValidIpv6Cidr(cidr)
            ? null
            : 'Use IPv6 CIDR notation, for example 2001:db8::/32.';

  const sourceGroupProblem =
    sourceKind !== 'group'
      ? null
      : sourceGroupId === null
        ? 'Select the security group that is the source of the traffic.'
        : null;

  // An explicit "Anywhere" or a hand-entered 0.0.0.0/0 / ::/0 opens the rule
  // to the whole internet; the console says so before Add is clicked.
  const worldOpen = sourceKind === 'anywhere' || (sourceKind !== 'group' && isWorldOpenCidr(cidr));

  const sourceProblem = cidrProblem ?? sourceGroupProblem;

  const submit = async (): Promise<void> => {
    if (submitting) return;
    if (portProblem !== null || sourceProblem !== null) return;
    setSubmitting(true);
    setError(null);
    try {
      await authorizeSecurityGroupIngress({
        groupId,
        rule: {
          protocol,
          ...(portRequired ? { fromPort: from, toPort: to } : {}),
          ...(sourceKind === 'cidr' || sourceKind === 'anywhere'
            ? { cidrIpv4: [sourceKind === 'anywhere' ? '0.0.0.0/0' : cidr.trim()] }
            : {}),
          ...(sourceKind === 'ipv6' ? { cidrIpv6: [cidr.trim()] } : {}),
          ...(sourceKind === 'group' && sourceGroupId !== null
            ? { referencedGroups: [sourceGroupId] }
            : {}),
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

  const groupOptions: readonly SelectProps.Option[] = securityGroups.map((group) => ({
    label: `${group.groupName} (${group.groupId})`,
    description: group.description,
    value: group.groupId,
  }));

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
              disabled={portProblem !== null || sourceProblem !== null}
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
                { value: 'cidr', label: 'Custom IPv4 CIDR' },
                { value: 'ipv6', label: 'Custom IPv6 CIDR' },
                {
                  value: 'group',
                  label: 'Security group',
                  description: 'Allow traffic from another security group in the same VPC.',
                },
                {
                  value: 'anywhere',
                  label: 'Anywhere',
                  description: '0.0.0.0/0 (IPv4) — opens the port to the internet.',
                },
              ]}
              onChange={({ detail }) => {
                const next = detail.value as SourceKind;
                setSourceKind(next);
                if (next === 'anywhere') setCidr('0.0.0.0/0');
              }}
            />
          </FormField>

          {sourceKind === 'cidr' || sourceKind === 'ipv6' ? (
            <FormField
              label={sourceKind === 'cidr' ? 'IPv4 CIDR' : 'IPv6 CIDR'}
              errorText={cidrProblem ?? undefined}
            >
              <Input
                value={cidr}
                placeholder={sourceKind === 'cidr' ? '203.0.113.0/24' : '2001:db8::/32'}
                ariaLabel="CIDR block"
                onChange={({ detail }) => {
                  setCidr(detail.value);
                }}
              />
            </FormField>
          ) : null}

          {sourceKind === 'group' ? (
            <FormField
              label="Source security group"
              errorText={sourceGroupProblem ?? undefined}
              constraintText={groupsError === null ? undefined : groupsError}
            >
              <Select
                selectedOption={
                  groupOptions.find((option) => option.value === sourceGroupId) ?? null
                }
                options={groupOptions}
                disabled={groupsLoading}
                statusType={groupsLoading ? 'loading' : groupsError === null ? 'finished' : 'error'}
                placeholder="Choose a security group"
                ariaLabel="Source security group"
                onChange={({ detail }) => {
                  setSourceGroupId(detail.selectedOption.value ?? null);
                }}
              />
            </FormField>
          ) : null}

          {worldOpen ? (
            <Alert
              type="warning"
              header="This source is the entire internet"
              action={
                <Button
                  variant="link"
                  onClick={() => {
                    setSourceKind('cidr');
                    setCidr('');
                  }}
                >
                  Use a custom CIDR instead
                </Button>
              }
            >
              The rule will allow this port range from every address (0.0.0.0/0). Narrow the source
              to a specific CIDR unless the resource really has to be reachable from anywhere.
            </Alert>
          ) : null}

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
