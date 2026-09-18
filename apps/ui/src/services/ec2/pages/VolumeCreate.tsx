import type { ApiError, AwsTag } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Select from '@cloudscape-design/components/select';
import type { SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Toggle from '@cloudscape-design/components/toggle';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreateWizard } from '../../../components/CreateWizard';
import { TagsEditor, validateTags } from '../../../components/TagsEditor';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { toApiError } from '../../../lib/apiClient';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import {
  createVolume,
  listAvailabilityZones,
  newClientToken,
  type Ec2AvailabilityZone,
} from '../api';
import { toFriendlyEc2Error } from '../errors';
import {
  defaultVolumePerformance,
  validateVolumeIops,
  validateVolumeSize,
  validateVolumeThroughput,
  volumeTypeLimit,
} from '../limits';

const VOLUME_TYPES: readonly SelectProps.Option[] = [
  { label: 'gp3 (General Purpose SSD)', value: 'gp3' },
  { label: 'gp2 (General Purpose SSD, previous generation)', value: 'gp2' },
  { label: 'io1 (Provisioned IOPS SSD)', value: 'io1' },
  { label: 'io2 (Provisioned IOPS SSD, latest generation)', value: 'io2' },
  { label: 'st1 (Throughput Optimized HDD)', value: 'st1' },
  { label: 'sc1 (Cold HDD)', value: 'sc1' },
  { label: 'standard (Magnetic, previous generation)', value: 'standard' },
];

/** Snapshot ids the wizard accepts: `snap-` plus at least 8 hex characters. */
const SNAPSHOT_PATTERN = /^snap-[0-9a-f]{8,}$/i;

/**
 * The console's create-volume wizard: availability zone, size, type and
 * performance settings, tags and review. The volume is created through
 * `CreateVolume` and the page then opens its detail view.
 */
export function VolumeCreatePage({ descriptor }: ServicePageProps): ReactElement {
  const navigate = useNavigate();
  const flashbar = useFlashbar();

  const [zones, setZones] = useState<readonly Ec2AvailabilityZone[]>([]);
  const [zonesLoading, setZonesLoading] = useState(true);
  const [zonesError, setZonesError] = useState<ApiError | null>(null);
  const [zone, setZone] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [sizeGiB, setSizeGiB] = useState('8');
  const [volumeType, setVolumeType] = useState('gp3');
  const [iops, setIops] = useState('3000');
  const [throughput, setThroughput] = useState('125');
  const [snapshotId, setSnapshotId] = useState('');
  const [encrypted, setEncrypted] = useState(false);
  const [tags, setTags] = useState<readonly AwsTag[]>([]);

  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  // One token per wizard mount: a retry after an ambiguous failure is
  // idempotent on the service side instead of creating a second volume.
  const clientToken = useRef(newClientToken());

  const loadZones = useCallback(async (): Promise<void> => {
    setZonesLoading(true);
    try {
      const result = await listAvailabilityZones();
      setZones(result);
      setZone((current) =>
        current !== null && result.some((entry) => entry.zoneName === current)
          ? current
          : (result[0]?.zoneName ?? null),
      );
      setZonesError(null);
    } catch (caught) {
      setZonesError(toApiError(caught));
    } finally {
      setZonesLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- availability zone fetch for the wizard
    void loadZones();
  }, [loadZones]);

  const meaningfulTags = useMemo(
    () => tags.filter((tag) => tag.Key.trim().length > 0 || tag.Value.trim().length > 0),
    [tags],
  );
  const tagProblems = validateTags(tags);
  const tagsProblem =
    tagProblems.length === 0 ? null : tagProblems.map((problem) => problem.message).join(' ');

  const size = Number.parseInt(sizeGiB, 10);
  const sizeProblem = validateVolumeSize(volumeType, size);

  const iopsValue = Number.parseInt(iops, 10);
  const iopsProblem = validateVolumeIops(volumeType, size, iopsValue);

  const throughputValue = Number.parseInt(throughput, 10);
  const throughputProblem = validateVolumeThroughput(volumeType, throughputValue);

  const snapshotProblem =
    snapshotId.trim().length === 0
      ? null
      : SNAPSHOT_PATTERN.test(snapshotId.trim())
        ? null
        : 'Use a snapshot id like snap-0123456789abcdef0.';

  const iopsLimit = volumeTypeLimit(volumeType).iops;
  const throughputLimit = volumeTypeLimit(volumeType).throughput;

  const selectVolumeType = (next: string): void => {
    setVolumeType(next);
    const defaults = defaultVolumePerformance(next);
    if (defaults.iops !== undefined) setIops(String(defaults.iops));
    if (defaults.throughput !== undefined) setThroughput(String(defaults.throughput));
  };

  const submit = async (): Promise<void> => {
    if (submitting) return;
    if (zone === null) {
      setError({
        code: 'VALIDATION_FAILED',
        statusCode: 400,
        message: 'Select an Availability Zone for the volume.',
      });
      setActiveStepIndex(0);
      return;
    }
    if (sizeProblem !== null || iopsProblem !== null || throughputProblem !== null) {
      setActiveStepIndex(0);
      return;
    }
    if (snapshotProblem !== null) {
      setActiveStepIndex(0);
      return;
    }
    if (tagsProblem !== null) {
      // The tags step validates the same set; this keeps a programmatic submit
      // from sending invalid tags even if the wizard gate were bypassed.
      setActiveStepIndex(1);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await createVolume({
        availabilityZone: zone,
        sizeGiB: size,
        volumeType,
        clientToken: clientToken.current,
        encrypted,
        ...(snapshotId.trim().length === 0 ? {} : { snapshotId: snapshotId.trim() }),
        ...(iopsLimit === undefined ? {} : { iops: iopsValue }),
        ...(throughputLimit === undefined ? {} : { throughput: throughputValue }),
        tags: [
          ...(name.trim().length === 0 ? [] : [{ Key: 'Name', Value: name.trim() }]),
          ...meaningfulTags.filter((tag) => tag.Key !== 'Name'),
        ],
      });
      flashbar.notify({
        type: 'success',
        header: 'Volume created',
        content: created.name ?? created.volumeId,
      });
      navigate(
        `${serviceConsolePath(descriptor.id)}/volumes/${encodeURIComponent(created.volumeId)}`,
      );
    } catch (caught) {
      const friendly = toFriendlyEc2Error(caught);
      setError({ ...friendly.apiError, message: friendly.message });
      if (friendly.field === 'volumeSize') setActiveStepIndex(0);
    } finally {
      setSubmitting(false);
    }
  };

  const detailsStep = (
    <Container header={<Header variant="h2">Volume details</Header>}>
      <Form>
        <SpaceBetween size="m">
          {zonesError === null ? null : (
            <Alert
              type="error"
              header="Could not load the Availability Zones"
              action={
                <Button
                  onClick={() => {
                    void loadZones();
                  }}
                >
                  Retry
                </Button>
              }
            >
              {zonesError.message}
            </Alert>
          )}

          <FormField
            label="Availability Zone"
            description="The zone the volume lives in. Attach it only to instances in the same zone."
          >
            <Select
              selectedOption={
                zones
                  .map((entry) => ({ label: entry.zoneName, value: entry.zoneName }))
                  .find((option) => option.value === zone) ?? null
              }
              options={zones.map((entry) => ({ label: entry.zoneName, value: entry.zoneName }))}
              disabled={zonesLoading}
              placeholder="Choose an Availability Zone"
              ariaLabel="Availability Zone"
              onChange={({ detail }) => {
                setZone(detail.selectedOption.value ?? null);
              }}
            />
          </FormField>

          <FormField
            label="Name"
            description="Sets the Name tag, which is how the console identifies the volume in lists."
          >
            <Input
              value={name}
              placeholder="data-volume"
              disabled={submitting}
              onChange={({ detail }) => {
                setName(detail.value);
              }}
            />
          </FormField>

          <SpaceBetween direction="horizontal" size="m">
            <FormField
              label="Size (GiB)"
              errorText={sizeProblem ?? undefined}
              constraintText={
                volumeType === 'st1' || volumeType === 'sc1'
                  ? 'st1/sc1 volumes start at 125 GiB.'
                  : undefined
              }
            >
              <Input
                value={sizeGiB}
                inputMode="numeric"
                ariaLabel="Volume size"
                onChange={({ detail }) => {
                  setSizeGiB(detail.value);
                }}
              />
            </FormField>
            <FormField label="Volume type">
              <Select
                selectedOption={VOLUME_TYPES.find((option) => option.value === volumeType) ?? null}
                options={[...VOLUME_TYPES]}
                ariaLabel="Volume type"
                onChange={({ detail }) => {
                  selectVolumeType(detail.selectedOption.value ?? 'gp3');
                }}
              />
            </FormField>
          </SpaceBetween>

          <SpaceBetween direction="horizontal" size="m">
            {iopsLimit === undefined ? null : (
              <FormField
                label="Provisioned IOPS"
                description={
                  volumeType === 'gp3'
                    ? `gp3 volumes include ${iopsLimit.default} IOPS; you can provision up to ${iopsLimit.max}.`
                    : undefined
                }
                errorText={iopsProblem ?? undefined}
              >
                <Input
                  value={iops}
                  inputMode="numeric"
                  ariaLabel="Provisioned IOPS"
                  onChange={({ detail }) => {
                    setIops(detail.value);
                  }}
                />
              </FormField>
            )}
            {throughputLimit === undefined ? null : (
              <FormField
                label="Throughput (MiB/s)"
                description={`gp3 volumes include ${throughputLimit.default} MiB/s and can provision up to ${throughputLimit.max}.`}
                errorText={throughputProblem ?? undefined}
              >
                <Input
                  value={throughput}
                  inputMode="numeric"
                  ariaLabel="Throughput"
                  onChange={({ detail }) => {
                    setThroughput(detail.value);
                  }}
                />
              </FormField>
            )}
          </SpaceBetween>

          <FormField
            label="Snapshot ID (optional)"
            description="Create the volume from an existing snapshot. LocalStack's DescribeSnapshots is not part of this module, so enter the id directly."
            errorText={snapshotProblem ?? undefined}
          >
            <Input
              value={snapshotId}
              placeholder="snap-0123456789abcdef0"
              ariaLabel="Snapshot ID"
              onChange={({ detail }) => {
                setSnapshotId(detail.value);
              }}
            />
          </FormField>

          <Toggle
            checked={encrypted}
            onChange={({ detail }) => {
              setEncrypted(detail.checked);
            }}
          >
            Encrypt this volume
          </Toggle>
        </SpaceBetween>
      </Form>
    </Container>
  );

  const tagsStep = (
    <Container header={<Header variant="h2">Tags</Header>}>
      <TagsEditor
        tags={tags}
        onChange={setTags}
        description="Tags are applied to the volume in the same CreateVolume call."
      />
    </Container>
  );

  const reviewStep = (
    <Container header={<Header variant="h2">Review and create</Header>}>
      <SpaceBetween size="m">
        <KeyValuePairs
          columns={2}
          items={[
            { label: 'Name', value: name.trim().length === 0 ? '— (no Name tag)' : name },
            { label: 'Availability Zone', value: zone ?? 'Not selected' },
            { label: 'Size', value: `${sizeGiB} GiB` },
            { label: 'Volume type', value: volumeType },
            {
              label: 'Provisioned IOPS',
              value: iopsLimit === undefined ? 'Default' : iops,
            },
            {
              label: 'Throughput',
              value: throughputLimit === undefined ? 'Default' : `${throughput} MiB/s`,
            },
            {
              label: 'Snapshot',
              value: snapshotId.trim().length === 0 ? 'None' : snapshotId.trim(),
            },
            { label: 'Encryption', value: encrypted ? 'Encrypted' : 'Not encrypted' },
            {
              label: 'Tags',
              value:
                meaningfulTags.length === 0
                  ? 'None'
                  : meaningfulTags.map((tag) => `${tag.Key}=${tag.Value}`).join(', '),
            },
          ]}
        />
        <Alert type="info">
          LocalStack stores volumes as metadata: the volume answers DescribeVolumes and can be
          attached to an instance in the same Availability Zone.
        </Alert>
      </SpaceBetween>
    </Container>
  );

  return (
    <CreateWizard
      title="Create volume"
      description="Create an EBS volume in this LocalStack account."
      breadcrumbs={[
        { text: descriptor.displayName, href: serviceConsolePath(descriptor.id) },
        { text: 'Volumes', href: `${serviceConsolePath(descriptor.id)}/volumes` },
        { text: 'Create volume' },
      ]}
      activeStepIndex={activeStepIndex}
      steps={[
        {
          id: 'details',
          title: 'Volume details',
          description: 'Zone, size and type.',
          validate: () =>
            zone === null
              ? 'Select an Availability Zone.'
              : (sizeProblem ?? iopsProblem ?? throughputProblem ?? snapshotProblem),
          content: detailsStep,
        },
        {
          id: 'tags',
          title: 'Tags',
          isOptional: true,
          validate: () => tagsProblem,
          content: tagsStep,
        },
        {
          id: 'review',
          title: 'Review and create',
          content: reviewStep,
        },
      ]}
      summary={[
        { label: 'Service', value: descriptor.displayName },
        { label: 'Name', value: name.trim().length === 0 ? '—' : name },
        { label: 'Availability Zone', value: zone ?? '—' },
        { label: 'Size', value: `${sizeGiB} GiB` },
        { label: 'Volume type', value: volumeType },
        { label: 'Encrypted', value: encrypted ? 'Yes' : 'No' },
        { label: 'Tags', value: `${meaningfulTags.length}` },
      ]}
      summaryTitle="Volume summary"
      submitLabel="Create volume"
      submitting={submitting}
      error={error}
      onSubmit={submit}
      onCancel={() => {
        navigate(`${serviceConsolePath(descriptor.id)}/volumes`);
      }}
      onStepChange={setActiveStepIndex}
    />
  );
}

export default VolumeCreatePage;
