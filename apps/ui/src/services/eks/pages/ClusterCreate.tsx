import type { ApiError, AwsTag } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Multiselect from '@cloudscape-design/components/multiselect';
import type { MultiselectProps } from '@cloudscape-design/components/multiselect';
import RadioGroup from '@cloudscape-design/components/radio-group';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreateWizard } from '../../../components/CreateWizard';
import { TagsEditor, validateTags } from '../../../components/TagsEditor';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { listSecurityGroups, listSubnets, listVpcs } from '../../ec2/api';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import { createCluster, listClusterVersions, normalizeTags, type EksClusterVersion } from '../api';
import { toFriendlyEksError } from '../errors';
import {
  CLUSTER_NAME_RULES,
  validateClusterName,
  validateKubernetesVersion,
  validateRoleArn,
} from '../naming';
import { RoleField } from '../components/RoleField';

type EndpointAccess = 'public-and-private' | 'public' | 'private';

const ENDPOINT_ACCESS_OPTIONS: readonly {
  value: EndpointAccess;
  label: string;
  description: string;
}[] = [
  {
    value: 'public-and-private',
    label: 'Public and private',
    description:
      'The endpoint is reachable from the internet (within the CIDRs below) and from inside the VPC. This is the console default.',
  },
  {
    value: 'public',
    label: 'Public',
    description: 'The endpoint is reachable from the internet within the allowed CIDRs.',
  },
  {
    value: 'private',
    label: 'Private',
    description: 'The endpoint is only reachable from inside the cluster VPC.',
  },
];

const CIDR_LABEL = '0.0.0.0/0';

/**
 * A subnet choice. The availability zone is kept on the option so validation
 * can require two distinct zones, which is what the EKS API requires.
 */
interface SubnetOption extends MultiselectProps.Option {
  availabilityZone?: string;
}

/**
 * Picks the subnets to preselect for a VPC: two subnets in different
 * Availability Zones when the catalogue offers them, because EKS rejects a
 * cluster whose subnets all live in one zone.
 */
function defaultSubnetSelection(options: readonly SubnetOption[]): readonly string[] {
  const [first, ...rest] = options;
  if (first === undefined) return [];
  const second =
    rest.find((option) => option.availabilityZone !== first.availabilityZone) ?? rest[0];
  return [first, second]
    .flatMap((option) => (option === undefined ? [] : [option.value ?? '']))
    .filter((value) => value.length > 0);
}

/** Splits the CIDR textarea on commas, spaces and newlines. */
function parseCidrs(value: string): readonly string[] {
  return value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** IPv4 CIDR, the only form EKS accepts for public access. */
function isIpv4Cidr(value: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(value);
  if (match === null) return false;
  const octets = [match[1], match[2], match[3], match[4]].map((part) =>
    Number.parseInt(part ?? '', 10),
  );
  const prefix = Number.parseInt(match[5] ?? '', 10);
  return octets.every((octet) => octet >= 0 && octet <= 255) && prefix >= 0 && prefix <= 32;
}

/**
 * The create-cluster wizard: cluster configuration (name, Kubernetes version,
 * IAM role), networking (VPC, subnets, security groups), endpoint access, tags
 * and a review step.
 *
 * `CreateCluster` is genuinely long-running against LocalStack Pro: it starts a
 * real k3d cluster. The wizard therefore submits asynchronously and sends the
 * user to the cluster page, which keeps polling DescribeCluster and reports
 * progress through the flashbar until the status is ACTIVE (or FAILED).
 */
export function ClusterCreatePage({ descriptor }: ServicePageProps): ReactElement {
  const navigate = useNavigate();
  const flashbar = useFlashbar();

  const [name, setName] = useState('');
  const [versions, setVersions] = useState<readonly EksClusterVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(true);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [version, setVersion] = useState('');
  const [roleArn, setRoleArn] = useState('');
  const [tags, setTags] = useState<readonly AwsTag[]>([]);

  const [vpcs, setVpcs] = useState<
    readonly { vpcId: string; cidrBlock?: string; isDefault: boolean }[]
  >([]);
  const [vpcId, setVpcId] = useState<string | null>(null);
  const [subnetOptions, setSubnetOptions] = useState<readonly SubnetOption[]>([]);
  const [subnetIds, setSubnetIds] = useState<readonly string[]>([]);
  const [securityGroupOptions, setSecurityGroupOptions] = useState<
    readonly MultiselectProps.Option[]
  >([]);
  const [securityGroupIds, setSecurityGroupIds] = useState<readonly string[]>([]);
  const [networkLoading, setNetworkLoading] = useState(true);
  const [networkError, setNetworkError] = useState<string | null>(null);

  const [endpointAccess, setEndpointAccess] = useState<EndpointAccess>('public-and-private');
  const [publicAccessCidrs, setPublicAccessCidrs] = useState(CIDR_LABEL);

  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const versionsInFlight = useRef<AbortController | null>(null);
  const networkInFlight = useRef<AbortController | null>(null);

  const loadVersions = useCallback(async (): Promise<void> => {
    versionsInFlight.current?.abort();
    const controller = new AbortController();
    versionsInFlight.current = controller;
    setVersionsLoading(true);
    try {
      const result = await listClusterVersions(controller.signal);
      if (controller.signal.aborted) return;
      setVersions(result);
      const fallback = result.find((entry) => entry.defaultVersion) ?? result[0];
      setVersion((current) =>
        current.length > 0 && result.some((entry) => entry.version === current)
          ? current
          : (fallback?.version ?? current),
      );
      setVersionsError(
        result.length === 0
          ? 'LocalStack did not report any supported Kubernetes versions for EKS.'
          : null,
      );
    } catch (caught) {
      if (controller.signal.aborted) return;
      setVersionsError(toFriendlyEksError(caught).message);
    } finally {
      if (!controller.signal.aborted) setVersionsLoading(false);
    }
  }, []);

  const loadNetwork = useCallback(async (selectedVpcId: string | null): Promise<void> => {
    networkInFlight.current?.abort();
    const controller = new AbortController();
    networkInFlight.current = controller;
    const signal = controller.signal;
    setNetworkLoading(true);
    try {
      const [subnets, groups] = await Promise.all([
        listSubnets(selectedVpcId === null ? { signal } : { vpcId: selectedVpcId, signal }),
        listSecurityGroups(
          selectedVpcId === null
            ? { signal }
            : { filters: [{ Name: 'vpc-id', Values: [selectedVpcId] }], signal },
        ),
      ]);
      if (signal.aborted) return;
      const options: readonly SubnetOption[] = subnets.map((subnet) => ({
        label: `${subnet.subnetId}${subnet.availabilityZone === undefined ? '' : ` · ${subnet.availabilityZone}`}`,
        value: subnet.subnetId,
        ...(subnet.availabilityZone === undefined
          ? {}
          : { availabilityZone: subnet.availabilityZone }),
      }));
      setSubnetOptions(options);
      setSubnetIds((current) => {
        const available = new Set(options.map((option) => option.value ?? ''));
        const kept = current.filter((id) => available.has(id));
        // EKS wants subnets in at least two Availability Zones; preselect two
        // in distinct zones so the default flow is valid from the start.
        if (kept.length >= 2) return kept;
        return defaultSubnetSelection(options);
      });
      setSecurityGroupOptions(
        groups.items.map((group) => ({
          label: `${group.groupName} (${group.groupId})`,
          value: group.groupId,
        })),
      );
      setSecurityGroupIds((current) => {
        const available = new Set(groups.items.map((group) => group.groupId));
        return current.filter((id) => available.has(id));
      });
      setNetworkError(null);
    } catch (caught) {
      if (signal.aborted) return;
      setNetworkError(toFriendlyEksError(caught).message);
    } finally {
      if (!signal.aborted) setNetworkLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- wizard catalogue fetch
    void loadVersions();
    return () => {
      versionsInFlight.current?.abort();
    };
  }, [loadVersions]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const load = async (): Promise<void> => {
      try {
        const result = await listVpcs(controller.signal);
        if (cancelled || controller.signal.aborted) return;
        setVpcs(result);
        setVpcId(
          (current) =>
            current ?? result.find((vpc) => vpc.isDefault)?.vpcId ?? result[0]?.vpcId ?? null,
        );
      } catch (caught) {
        if (!cancelled && !controller.signal.aborted) {
          setNetworkError(toFriendlyEksError(caught).message);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- wizard network fetch
    void loadNetwork(vpcId);
    return () => {
      networkInFlight.current?.abort();
    };
  }, [loadNetwork, vpcId]);

  const versionOptions = useMemo(
    () =>
      versions.map((entry) => ({
        label: entry.version,
        value: entry.version,
        description: [
          entry.defaultVersion ? 'default' : undefined,
          entry.kubernetesPatchVersion === undefined
            ? undefined
            : `k8s ${entry.kubernetesPatchVersion}`,
          entry.status === undefined ? undefined : entry.status.replace(/_/g, ' ').toLowerCase(),
        ]
          .filter((part): part is string => part !== undefined)
          .join(' · '),
      })),
    [versions],
  );

  const cidrs = parseCidrs(publicAccessCidrs);
  const publicCidrProblem =
    endpointAccess === 'private'
      ? null
      : cidrs.length === 0
        ? 'Enter at least one CIDR block, for example 0.0.0.0/0.'
        : cidrs.some((cidr) => !isIpv4Cidr(cidr))
          ? 'Every entry must be an IPv4 CIDR block, for example 203.0.113.0/24.'
          : null;

  const nameProblem = name.length > 0 ? validateClusterName(name) : null;
  const versionProblem = version.length > 0 ? validateKubernetesVersion(version) : null;
  const roleProblem = roleArn.length > 0 ? validateRoleArn(roleArn) : null;
  // EKS requires at least two subnets in *different* Availability Zones: two
  // subnets in the same zone are rejected even though the count is fine.
  const selectedSubnets = subnetOptions.filter((option) => subnetIds.includes(option.value ?? ''));
  const selectedZones = new Set(
    selectedSubnets.flatMap((option) =>
      option.availabilityZone === undefined ? [] : [option.availabilityZone],
    ),
  );
  const subnetProblem =
    subnetIds.length < 2 || selectedZones.size < 2
      ? 'Select at least two subnets in different Availability Zones.'
      : null;

  const selectedVpc = vpcs.find((vpc) => vpc.vpcId === vpcId);

  const normalizedTags = normalizeTags(tags);
  const tagProblems = validateTags(tags);
  const tagsProblem =
    tagProblems.length === 0 ? null : tagProblems.map((problem) => problem.message).join(' ');

  const submit = async (): Promise<void> => {
    // CreateCluster has no idempotency token: a second submit would start a
    // second (k3d) cluster, so an in-flight submit must never run twice.
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createCluster({
        name: name.trim(),
        version,
        roleArn: roleArn.trim(),
        subnetIds,
        securityGroupIds,
        endpointPublicAccess: endpointAccess !== 'private',
        endpointPrivateAccess: endpointAccess !== 'public',
        ...(endpointAccess === 'private' ? {} : { publicAccessCidrs: cidrs }),
        tags: normalizedTags,
      });

      flashbar.notify({
        type: 'info',
        header: `Creating cluster ${created.name}`,
        content:
          'LocalStack is starting a k3d Kubernetes control plane. This usually takes a few minutes; the cluster page reports progress.',
      });
      navigate(`${serviceConsolePath(descriptor.id)}/clusters/${encodeURIComponent(created.name)}`);
    } catch (caught) {
      const friendly = toFriendlyEksError(caught);
      setError({ ...friendly.apiError, message: friendly.message });
      // Both fields live on the configuration step; the middle steps are only
      // selected for their own failures.
      if (
        friendly.field === 'name' ||
        friendly.field === 'version' ||
        friendly.field === 'roleArn'
      ) {
        setActiveStepIndex(0);
      } else if (friendly.field === 'network') {
        setActiveStepIndex(1);
      } else if (friendly.field === 'endpointAccess') {
        setActiveStepIndex(2);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const leave = (): void => {
    navigate(serviceConsolePath(descriptor.id));
  };

  const configurationStep = (
    <Container header={<Header variant="h2">Configure cluster</Header>}>
      <Form>
        <SpaceBetween size="m">
          {versionsError === null ? null : <Alert type="error">{versionsError}</Alert>}
          <FormField
            label="Name"
            errorText={nameProblem ?? undefined}
            constraintText={<Box variant="small">{CLUSTER_NAME_RULES.join(' · ')}</Box>}
          >
            <Input
              value={name}
              autoFocus
              disabled={submitting}
              placeholder="localdeck-cluster"
              onChange={({ detail }) => {
                setName(detail.value);
              }}
            />
          </FormField>

          <FormField
            label="Kubernetes version"
            description="The versions this LocalStack instance reports as supported. LocalStack starts the matching k3s release."
            errorText={versionProblem ?? undefined}
          >
            <Select
              selectedOption={versionOptions.find((option) => option.value === version) ?? null}
              options={[...versionOptions]}
              loadingText="Loading Kubernetes versions"
              statusType={versionsLoading ? 'loading' : 'finished'}
              disabled={submitting || versionsLoading}
              placeholder="Choose a version"
              ariaLabel="Kubernetes version"
              onChange={({ detail }) => {
                setVersion(detail.selectedOption.value ?? '');
              }}
            />
          </FormField>

          <RoleField
            label="Cluster IAM role"
            description="The role EKS uses for the control plane. LocalStack stores the ARN and reports it from DescribeCluster; it does not validate the trust policy."
            value={roleArn}
            disabled={submitting}
            {...(roleProblem === null ? {} : { errorText: roleProblem })}
            onChange={setRoleArn}
          />

          <Alert type="info" header="Cluster creation is long-running">
            LocalStack starts a real k3d cluster in Docker for every EKS cluster. LocalDeck submits
            the request and then polls DescribeCluster, reporting progress through notifications
            until the cluster is ACTIVE.
          </Alert>
        </SpaceBetween>
      </Form>
    </Container>
  );

  const networkingStep = (
    <Container
      header={
        <Header
          variant="h2"
          description="EKS wants subnets in at least two Availability Zones. LocalStack's default VPC already provides them."
        >
          Networking
        </Header>
      }
    >
      <SpaceBetween size="m">
        {networkError === null ? null : <Alert type="error">{networkError}</Alert>}

        <FormField label="VPC">
          <Select
            selectedOption={
              vpcs
                .map((vpc) => ({
                  label: `${vpc.vpcId}${vpc.isDefault ? ' (default)' : ''}`,
                  description: vpc.cidrBlock ?? '',
                  value: vpc.vpcId,
                }))
                .find((option) => option.value === vpcId) ?? null
            }
            options={vpcs.map((vpc) => ({
              label: `${vpc.vpcId}${vpc.isDefault ? ' (default)' : ''}`,
              description: vpc.cidrBlock ?? '',
              value: vpc.vpcId,
            }))}
            disabled={submitting || networkLoading || vpcs.length === 0}
            placeholder={vpcs.length === 0 ? 'LocalStack reported no VPCs' : 'Choose a VPC'}
            ariaLabel="VPC"
            onChange={({ detail }) => {
              setVpcId(detail.selectedOption.value ?? null);
            }}
          />
        </FormField>

        <FormField
          label="Subnets"
          description="The cluster's control plane networking. Select at least two subnets in different Availability Zones."
          errorText={subnetProblem ?? undefined}
        >
          <Multiselect
            selectedOptions={subnetOptions.filter((option) =>
              subnetIds.includes(option.value ?? ''),
            )}
            options={[...subnetOptions]}
            loadingText="Loading subnets"
            statusType={networkLoading ? 'loading' : 'finished'}
            disabled={submitting || networkLoading}
            filteringType="auto"
            placeholder="Choose subnets"
            ariaLabel="Subnets"
            tokenLimit={3}
            onChange={({ detail }) => {
              setSubnetIds(detail.selectedOptions.map((option) => option.value ?? ''));
            }}
          />
        </FormField>

        <FormField
          label="Security groups"
          description="Optional. LocalStack adds its own cluster security group; additional groups are stored on the cluster."
        >
          <Multiselect
            selectedOptions={securityGroupOptions.filter((option) =>
              securityGroupIds.includes(option.value ?? ''),
            )}
            options={[...securityGroupOptions]}
            loadingText="Loading security groups"
            statusType={networkLoading ? 'loading' : 'finished'}
            disabled={submitting || networkLoading}
            filteringType="auto"
            placeholder="Choose security groups (optional)"
            ariaLabel="Security groups"
            tokenLimit={3}
            onChange={({ detail }) => {
              setSecurityGroupIds(detail.selectedOptions.map((option) => option.value ?? ''));
            }}
          />
        </FormField>
      </SpaceBetween>
    </Container>
  );

  const endpointStep = (
    <Container header={<Header variant="h2">Endpoint access</Header>}>
      <SpaceBetween size="m">
        <RadioGroup
          value={endpointAccess}
          items={ENDPOINT_ACCESS_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
            description: option.description,
          }))}
          onChange={({ detail }) => {
            setEndpointAccess(detail.value as EndpointAccess);
          }}
        />

        {endpointAccess === 'private' ? null : (
          <FormField
            label="Public access CIDRs"
            description="Sources allowed to reach the public Kubernetes API endpoint, separated by commas or newlines."
            errorText={publicCidrProblem ?? undefined}
          >
            <Input
              value={publicAccessCidrs}
              disabled={submitting}
              ariaLabel="Public access CIDRs"
              onChange={({ detail }) => {
                setPublicAccessCidrs(detail.value);
              }}
            />
          </FormField>
        )}
      </SpaceBetween>
    </Container>
  );

  const tagsStep = (
    <Container header={<Header variant="h2">Tags</Header>}>
      <TagsEditor
        tags={tags}
        onChange={setTags}
        description="Key-value pairs applied to the cluster in the same CreateCluster call."
      />
    </Container>
  );

  const reviewStep = (
    <Container header={<Header variant="h2">Review and create</Header>}>
      <KeyValuePairs
        columns={1}
        items={[
          { label: 'Name', value: name.trim().length === 0 ? '—' : name },
          { label: 'Kubernetes version', value: version.length === 0 ? '—' : version },
          { label: 'Cluster IAM role', value: roleArn.length === 0 ? '—' : roleArn },
          {
            label: 'VPC',
            value:
              selectedVpc === undefined
                ? '—'
                : `${selectedVpc.vpcId}${selectedVpc.cidrBlock === undefined ? '' : ` (${selectedVpc.cidrBlock})`}`,
          },
          { label: 'Subnets', value: subnetIds.length === 0 ? '—' : subnetIds.join(', ') },
          {
            label: 'Security groups',
            value:
              securityGroupIds.length === 0
                ? 'Cluster security group only'
                : securityGroupIds.join(', '),
          },
          {
            label: 'Endpoint access',
            value:
              ENDPOINT_ACCESS_OPTIONS.find((option) => option.value === endpointAccess)?.label ??
              endpointAccess,
          },
          {
            label: 'Public access CIDRs',
            value: endpointAccess === 'private' ? 'Not applicable' : cidrs.join(', ') || '—',
          },
          {
            label: 'Tags',
            value:
              normalizedTags.length === 0
                ? 'None'
                : normalizedTags.map((tag) => `${tag.Key}=${tag.Value}`).join(', '),
          },
        ]}
      />
    </Container>
  );

  return (
    <CreateWizard
      title="Create cluster"
      description={descriptor.summary}
      breadcrumbs={[
        { text: descriptor.displayName, href: serviceConsolePath(descriptor.id) },
        { text: 'Clusters', href: serviceConsolePath(descriptor.id) },
        { text: 'Create cluster' },
      ]}
      activeStepIndex={activeStepIndex}
      steps={[
        {
          id: 'configuration',
          title: 'Configure cluster',
          description: 'Name, version and IAM role.',
          validate: () => {
            const nameProblemValue = validateClusterName(name);
            if (nameProblemValue !== null) return nameProblemValue;
            const versionProblemValue = validateKubernetesVersion(version);
            if (versionProblemValue !== null) return versionProblemValue;
            return validateRoleArn(roleArn);
          },
          content: configurationStep,
        },
        {
          id: 'networking',
          title: 'Networking',
          description: 'VPC, subnets and security groups.',
          validate: () => (vpcId === null ? 'Select a VPC.' : (subnetProblem ?? networkError)),
          content: networkingStep,
        },
        {
          id: 'endpoint',
          title: 'Endpoint access',
          description: 'Public, private or both.',
          validate: () => publicCidrProblem,
          content: endpointStep,
        },
        {
          id: 'tags',
          title: 'Tags',
          description: 'Optional key-value pairs.',
          isOptional: true,
          validate: () => tagsProblem,
          content: tagsStep,
        },
        {
          id: 'review',
          title: 'Review',
          description: 'Check the settings before creating.',
          content: reviewStep,
        },
      ]}
      summary={[
        { label: 'Service', value: descriptor.displayName },
        { label: 'Name', value: name.trim().length === 0 ? '—' : name },
        { label: 'Version', value: version.length === 0 ? '—' : version },
        { label: 'VPC', value: vpcId ?? '—' },
        { label: 'Subnets', value: `${subnetIds.length}` },
        { label: 'Endpoint access', value: endpointAccess.replace(/-/g, ' ') },
        { label: 'Tags', value: `${normalizedTags.length}` },
      ]}
      summaryTitle="Cluster summary"
      submitLabel="Create cluster"
      submitting={submitting}
      error={error}
      onSubmit={submit}
      onCancel={leave}
      onStepChange={setActiveStepIndex}
    />
  );
}

export default ClusterCreatePage;
