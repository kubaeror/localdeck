import type { ApiError } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import Multiselect from '@cloudscape-design/components/multiselect';
import type { MultiselectProps } from '@cloudscape-design/components/multiselect';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { listAllInstanceTypes } from '../../ec2/api';
import { createNodegroup, type EksCluster, type EksNodegroup } from '../api';
import { toFriendlyEksError } from '../errors';
import {
  NODEGROUP_NAME_RULES,
  parseScalingValue,
  validateNodegroupName,
  validateScaling,
} from '../naming';
import { RoleField } from './RoleField';

export interface CreateNodegroupModalProps {
  visible: boolean;
  cluster: EksCluster;
  onDismiss: () => void;
  /** Called once LocalStack accepted the request (status CREATING). */
  onCreated: (nodegroup: EksNodegroup) => void;
}

/**
 * The "Create node group" modal: name, IAM role, instance types, scaling and
 * the cluster's subnets. LocalStack answers CREATING and then provisions a
 * Docker node plus an emulated EC2 instance per desired node; the Compute tab
 * polls DescribeNodegroup until the status settles, so the modal closes as
 * soon as the request is accepted.
 */
export function CreateNodegroupModal({
  visible,
  cluster,
  onDismiss,
  onCreated,
}: CreateNodegroupModalProps): ReactElement {
  const [name, setName] = useState('');
  const [roleArn, setRoleArn] = useState('');
  const [instanceTypes, setInstanceTypes] = useState<readonly string[]>(['t3.medium']);
  const [typeOptions, setTypeOptions] = useState<readonly MultiselectProps.Option[]>([]);
  const [typesLoading, setTypesLoading] = useState(true);
  const [subnetIds, setSubnetIds] = useState<readonly string[]>(cluster.vpcConfig.subnetIds);
  const [capacityType, setCapacityType] = useState<'ON_DEMAND' | 'SPOT'>('ON_DEMAND');
  const [diskSize, setDiskSize] = useState('');
  const [minSize, setMinSize] = useState('1');
  const [maxSize, setMaxSize] = useState('2');
  const [desiredSize, setDesiredSize] = useState('1');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const loadTypes = useCallback(async (): Promise<void> => {
    setTypesLoading(true);
    try {
      const types = await listAllInstanceTypes();
      const options = types
        .map((type) => ({ label: type.instanceType, value: type.instanceType }))
        .sort((left, right) => left.label.localeCompare(right.label, 'en'));
      setTypeOptions(options);
      const available = new Set(options.map((option) => option.value));
      setInstanceTypes((current) => {
        const kept = current.filter((value) => available.has(value));
        if (kept.length > 0) return kept;
        return available.has('t3.medium') ? ['t3.medium'] : options.slice(0, 1).map((o) => o.value);
      });
    } catch {
      // Keep the static t3.medium default; LocalStack still validates the type.
      setTypeOptions([{ label: 't3.medium', value: 't3.medium' }]);
    } finally {
      setTypesLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- catalogue fetch for the modal
    void loadTypes();
  }, [loadTypes]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- cluster subnets seed the selection
    setSubnetIds(cluster.vpcConfig.subnetIds);
  }, [cluster.name, cluster.vpcConfig.subnetIds]);

  const scaling = useMemo(
    () => ({
      minSize: parseScalingValue(minSize),
      maxSize: parseScalingValue(maxSize),
      desiredSize: parseScalingValue(desiredSize),
    }),
    [desiredSize, maxSize, minSize],
  );

  const nameProblem = name.length > 0 ? validateNodegroupName(name) : null;
  const scalingProblem = validateScaling(scaling);
  const diskSizeGiB = diskSize.trim().length === 0 ? undefined : Number.parseInt(diskSize, 10);
  const diskProblem =
    diskSizeGiB !== undefined && (!Number.isInteger(diskSizeGiB) || diskSizeGiB < 1)
      ? 'Disk size must be a whole number of GiB (1 or more).'
      : null;

  const canSubmit =
    name.trim().length > 0 &&
    roleArn.trim().length > 0 &&
    instanceTypes.length > 0 &&
    subnetIds.length > 0 &&
    nameProblem === null &&
    scalingProblem === null &&
    diskProblem === null;

  const subnetOptions = useMemo<MultiselectProps.Option[]>(
    () => cluster.vpcConfig.subnetIds.map((subnetId) => ({ label: subnetId, value: subnetId })),
    [cluster.vpcConfig.subnetIds],
  );

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const created = await createNodegroup({
        clusterName: cluster.name,
        nodegroupName: name.trim(),
        nodeRole: roleArn.trim(),
        subnetIds,
        instanceTypes,
        scaling,
        capacityType,
        ...(diskSizeGiB === undefined ? {} : { diskSizeGiB }),
      });
      onCreated(created);
    } catch (caught) {
      // Field faults (duplicate name, bad role, invalid version) are escalated
      // by the parent through the modal's error alert.
      const friendly = toFriendlyEksError(caught);
      setError({ ...friendly.apiError, message: friendly.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      onDismiss={submitting ? () => undefined : onDismiss}
      header="Create node group"
      size="large"
      closeAriaLabel="Close create node group"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={submitting} onClick={onDismiss}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={submitting}
              disabled={!canSubmit}
              onClick={() => {
                void submit();
              }}
            >
              Create
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {error === null ? null : (
          <Alert type="error" header="Could not create the node group">
            {error.message}
          </Alert>
        )}

        <FormField
          label="Node group name"
          errorText={nameProblem ?? undefined}
          constraintText={<Box variant="small">{NODEGROUP_NAME_RULES.join(' · ')}</Box>}
        >
          <Input
            value={name}
            autoFocus
            disabled={submitting}
            placeholder="standard-workers"
            onChange={({ detail }) => {
              setName(detail.value);
            }}
          />
        </FormField>

        <RoleField
          label="Node IAM role"
          description="The role the kubelet and nodes assume. LocalStack does not validate its policies, but the ARN is stored and reported by DescribeNodegroup."
          value={roleArn}
          disabled={submitting}
          onChange={setRoleArn}
        />

        <FormField
          label="Instance types"
          description="One or more EC2 instance types for the nodes LocalStack provisions."
          errorText={instanceTypes.length === 0 ? 'Select at least one instance type.' : undefined}
        >
          <Multiselect
            selectedOptions={instanceTypes.map((value) => ({ label: value, value }))}
            options={[...typeOptions]}
            loadingText="Loading instance types"
            statusType={typesLoading ? 'loading' : 'finished'}
            disabled={submitting || typesLoading}
            filteringType="auto"
            placeholder="Choose instance types"
            ariaLabel="Instance types"
            tokenLimit={3}
            onChange={({ detail }) => {
              setInstanceTypes(detail.selectedOptions.map((option) => option.value ?? ''));
            }}
          />
        </FormField>

        <SpaceBetween direction="horizontal" size="m">
          <FormField
            label="Minimum size"
            errorText={scalingProblem ?? undefined}
            description="Nodes the group never scales below."
          >
            <Input
              value={minSize}
              inputMode="numeric"
              disabled={submitting}
              ariaLabel="Minimum size"
              onChange={({ detail }) => {
                setMinSize(detail.value);
              }}
            />
          </FormField>
          <FormField label="Maximum size" description="Nodes the group never exceeds.">
            <Input
              value={maxSize}
              inputMode="numeric"
              disabled={submitting}
              ariaLabel="Maximum size"
              onChange={({ detail }) => {
                setMaxSize(detail.value);
              }}
            />
          </FormField>
          <FormField label="Desired size" description="Nodes to provision now.">
            <Input
              value={desiredSize}
              inputMode="numeric"
              disabled={submitting}
              ariaLabel="Desired size"
              onChange={({ detail }) => {
                setDesiredSize(detail.value);
              }}
            />
          </FormField>
        </SpaceBetween>

        <SpaceBetween direction="horizontal" size="m">
          <FormField label="Capacity type">
            <Select
              selectedOption={{
                label: capacityType === 'SPOT' ? 'Spot' : 'On-Demand',
                value: capacityType,
              }}
              options={[
                { label: 'On-Demand', value: 'ON_DEMAND' },
                { label: 'Spot', value: 'SPOT' },
              ]}
              disabled={submitting}
              ariaLabel="Capacity type"
              onChange={({ detail }) => {
                setCapacityType(detail.selectedOption.value === 'SPOT' ? 'SPOT' : 'ON_DEMAND');
              }}
            />
          </FormField>
          <FormField
            label="Disk size (GiB)"
            description="Optional; LocalStack defaults to 20 GiB."
            errorText={diskProblem ?? undefined}
          >
            <Input
              value={diskSize}
              inputMode="numeric"
              disabled={submitting}
              placeholder="20"
              ariaLabel="Disk size in GiB"
              onChange={({ detail }) => {
                setDiskSize(detail.value);
              }}
            />
          </FormField>
        </SpaceBetween>

        <FormField
          label="Subnets"
          description="The cluster's subnets. LocalStack's managed nodes join the cluster regardless of the subnet, but the selection is reported back."
          errorText={subnetIds.length === 0 ? 'Select at least one subnet.' : undefined}
        >
          <Multiselect
            selectedOptions={subnetIds.map((value) => ({ label: value, value }))}
            options={subnetOptions}
            disabled={submitting}
            filteringType="auto"
            placeholder="Choose subnets"
            ariaLabel="Subnets"
            onChange={({ detail }) => {
              setSubnetIds(detail.selectedOptions.map((option) => option.value ?? ''));
            }}
          />
        </FormField>

        <Alert type="info" header="What LocalStack does next">
          A managed node group starts a k3d agent node in Docker and registers an emulated EC2
          instance per desired node. That takes a minute or two; the Compute tab keeps polling
          DescribeNodegroup until the status is ACTIVE.
        </Alert>
      </SpaceBetween>
    </Modal>
  );
}

export default CreateNodegroupModal;
