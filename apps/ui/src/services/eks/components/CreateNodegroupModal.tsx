import type { ApiError, AwsTag } from '@localdeck/shared';
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
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { TagsEditor, validateTags } from '../../../components/TagsEditor';
import { listAllInstanceTypes } from '../../ec2/api';
import { createNodegroup, normalizeTags, type EksCluster, type EksNodegroup } from '../api';
import { toFriendlyEksError } from '../errors';
import {
  NODEGROUP_NAME_RULES,
  parsePositiveInteger,
  parseScalingValue,
  validateNodegroupName,
  validateRoleArn,
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

/** The AMI types the console offers; LocalStack stores whichever is sent. */
const AMI_TYPES: readonly { value: string; label: string }[] = [
  { value: '__default__', label: 'LocalStack default' },
  { value: 'AL2023_x86_64_STANDARD', label: 'Amazon Linux 2023 (x86_64)' },
  { value: 'AL2023_ARM_64_STANDARD', label: 'Amazon Linux 2023 (ARM_64)' },
  { value: 'AL2_x86_64', label: 'Amazon Linux 2 (x86_64)' },
  { value: 'AL2_x86_64_GPU', label: 'Amazon Linux 2 GPU (x86_64)' },
  { value: 'AL2_ARM_64', label: 'Amazon Linux 2 (ARM_64)' },
  { value: 'BOTTLEROCKET_x86_64', label: 'Bottlerocket (x86_64)' },
  { value: 'BOTTLEROCKET_ARM_64', label: 'Bottlerocket (ARM_64)' },
];

/**
 * Converts editor rows into the label map CreateNodegroup expects. Rows without
 * a key are dropped defensively; the editor already blocks saving them.
 */
function toLabelRecord(tags: readonly AwsTag[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const tag of normalizeTags(tags)) {
    record[tag.Key] = tag.Value;
  }
  return record;
}

/**
 * The "Create node group" modal: name, IAM role, instance types, scaling, AMI
 * type, labels, tags and the cluster's subnets. LocalStack answers CREATING and
 * then provisions a Docker node plus an emulated EC2 instance per desired node;
 * the Compute tab polls DescribeNodegroup until the status settles, so the
 * modal closes as soon as the request is accepted.
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
  const [amiType, setAmiType] = useState('__default__');
  const [diskSize, setDiskSize] = useState('');
  const [minSize, setMinSize] = useState('1');
  const [maxSize, setMaxSize] = useState('2');
  const [desiredSize, setDesiredSize] = useState('1');
  const [labels, setLabels] = useState<readonly AwsTag[]>([]);
  const [tags, setTags] = useState<readonly AwsTag[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  /** The cluster whose subnets were seeded into the form. */
  const seededFor = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAllInstanceTypes()
      .then((types) => {
        if (cancelled) return;
        const options = types
          .map((type) => ({ label: type.instanceType, value: type.instanceType }))
          .sort((left, right) => left.label.localeCompare(right.label, 'en'));
        setTypeOptions(options);
        const available = new Set(options.map((option) => option.value));
        setInstanceTypes((current) => {
          const kept = current.filter((value) => available.has(value));
          if (kept.length > 0) return kept;
          return available.has('t3.medium')
            ? ['t3.medium']
            : options.slice(0, 1).map((o) => o.value);
        });
      })
      .catch(() => {
        if (cancelled) return;
        // Keep the static t3.medium default; LocalStack still validates the type.
        setTypeOptions([{ label: 't3.medium', value: 't3.medium' }]);
      })
      .finally(() => {
        if (!cancelled) setTypesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Seed the subnet selection once per cluster: a background refresh of the
    // cluster must not overwrite what the user picked. A different cluster
    // (the modal can be reused) reseeds.
    if (seededFor.current === cluster.name) return;
    seededFor.current = cluster.name;
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
  const roleProblem = roleArn.length > 0 ? validateRoleArn(roleArn) : null;
  const scalingProblem = validateScaling(scaling, { requireDesired: true });
  const diskSizeGiB = parsePositiveInteger(diskSize);
  const diskProblem =
    diskSizeGiB !== undefined && Number.isNaN(diskSizeGiB)
      ? 'Disk size must be a whole number of GiB (1 or more).'
      : null;
  const labelProblems = validateTags(labels);
  const tagProblems = validateTags(tags);
  const labelsProblem =
    labelProblems.length > 0 ? labelProblems.map((problem) => problem.message).join(' ') : null;
  const tagsProblem =
    tagProblems.length > 0 ? tagProblems.map((problem) => problem.message).join(' ') : null;

  const canSubmit =
    name.trim().length > 0 &&
    roleArn.trim().length > 0 &&
    roleProblem === null &&
    instanceTypes.length > 0 &&
    subnetIds.length > 0 &&
    nameProblem === null &&
    scalingProblem === null &&
    diskProblem === null &&
    labelsProblem === null &&
    tagsProblem === null;

  const subnetOptions = useMemo<MultiselectProps.Option[]>(
    () => cluster.vpcConfig.subnetIds.map((subnetId) => ({ label: subnetId, value: subnetId })),
    [cluster.vpcConfig.subnetIds],
  );

  const submit = async (): Promise<void> => {
    // EKS has no idempotency token: a second CreateNodegroup would make a
    // second node group, so an in-flight submit must never run twice.
    if (submitting) return;
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
        ...(amiType === '__default__' ? {} : { amiType }),
        ...(diskSizeGiB === undefined ? {} : { diskSizeGiB }),
        ...(labels.length === 0 ? {} : { labels: toLabelRecord(labels) }),
        ...(tags.length === 0 ? {} : { tags: normalizeTags(tags) }),
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
              disabled={!canSubmit || submitting}
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
          {...(roleProblem === null ? {} : { errorText: roleProblem })}
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
          <FormField label="AMI type" description="Optional. LocalStack uses its default image.">
            <Select
              selectedOption={AMI_TYPES.find((option) => option.value === amiType) ?? null}
              options={[...AMI_TYPES]}
              disabled={submitting}
              ariaLabel="AMI type"
              onChange={({ detail }) => {
                setAmiType(detail.selectedOption.value ?? '__default__');
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

        <TagsEditor
          tags={[...labels]}
          onChange={setLabels}
          label="Kubernetes labels"
          description="Key-value labels applied to every node in the group. Labels without a key cannot be saved."
          addButtonLabel="Add label"
          emptyTitle="No labels"
        />

        <TagsEditor
          tags={[...tags]}
          onChange={setTags}
          label="Tags"
          description="Cost-allocation tags applied to the node group resource in EKS."
        />

        {typesLoading ? null : (
          <Box variant="small" color="text-body-secondary">
            {typeOptions.length} instance types reported by LocalStack.
          </Box>
        )}

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
