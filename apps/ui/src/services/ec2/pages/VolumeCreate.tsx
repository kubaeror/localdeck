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
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreateWizard } from '../../../components/CreateWizard';
import { TagsEditor } from '../../../components/TagsEditor';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { toApiError } from '../../../lib/apiClient';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import { createVolume, listAvailabilityZones, type Ec2AvailabilityZone } from '../api';
import { toFriendlyEc2Error } from '../errors';

const VOLUME_TYPES: readonly SelectProps.Option[] = [
  { label: 'gp3 (General Purpose SSD)', value: 'gp3' },
  { label: 'gp2 (General Purpose SSD, previous generation)', value: 'gp2' },
  { label: 'io1 (Provisioned IOPS SSD)', value: 'io1' },
  { label: 'io2 (Provisioned IOPS SSD, latest generation)', value: 'io2' },
  { label: 'st1 (Throughput Optimized HDD)', value: 'st1' },
  { label: 'sc1 (Cold HDD)', value: 'sc1' },
  { label: 'standard (Magnetic, previous generation)', value: 'standard' },
];

/** Volume types that take an explicit IOPS value. */
const IOPS_TYPES = new Set(['io1', 'io2', 'gp3']);
/** Volume types that take an explicit throughput value. */
const THROUGHPUT_TYPES = new Set(['gp3']);

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
  const [encrypted, setEncrypted] = useState(false);
  const [tags, setTags] = useState<readonly AwsTag[]>([]);

  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

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

  const size = Number.parseInt(sizeGiB, 10);
  const sizeProblem = !Number.isInteger(size)
    ? 'Enter the volume size in GiB.'
    : size < 1 || size > 16384
      ? 'The volume size must be between 1 and 16384 GiB.'
      : null;

  const iopsValue = Number.parseInt(iops, 10);
  const iopsProblem =
    !IOPS_TYPES.has(volumeType) || volumeType === 'gp3'
      ? null
      : !Number.isInteger(iopsValue) || iopsValue < 100 || iopsValue > 64000
        ? 'Provisioned IOPS must be between 100 and 64000.'
        : null;

  const throughputValue = Number.parseInt(throughput, 10);
  const throughputProblem = !THROUGHPUT_TYPES.has(volumeType)
    ? null
    : !Number.isInteger(throughputValue) || throughputValue < 125 || throughputValue > 1000
      ? 'Throughput must be between 125 and 1000 MiB/s.'
      : null;

  const submit = async (): Promise<void> => {
    if (zone === null) {
      setError({
        code: 'VALIDATION_FAILED',
        statusCode: 400,
        message: 'Select an Availability Zone for the volume.',
      });
      setActiveStepIndex(0);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await createVolume({
        availabilityZone: zone,
        sizeGiB: size,
        volumeType,
        encrypted,
        ...(volumeType === 'io1' || volumeType === 'io2' ? { iops: iopsValue } : {}),
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
            <FormField label="Size (GiB)" errorText={sizeProblem ?? undefined}>
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
                  setVolumeType(detail.selectedOption.value ?? 'gp3');
                }}
              />
            </FormField>
          </SpaceBetween>

          <SpaceBetween direction="horizontal" size="m">
            {IOPS_TYPES.has(volumeType) && volumeType !== 'gp3' ? (
              <FormField label="Provisioned IOPS" errorText={iopsProblem ?? undefined}>
                <Input
                  value={iops}
                  inputMode="numeric"
                  ariaLabel="Provisioned IOPS"
                  onChange={({ detail }) => {
                    setIops(detail.value);
                  }}
                />
              </FormField>
            ) : null}
            {THROUGHPUT_TYPES.has(volumeType) ? (
              <FormField
                label="Throughput (MiB/s)"
                description="gp3 volumes let you provision throughput independently of size."
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
            ) : null}
          </SpaceBetween>

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
              value: IOPS_TYPES.has(volumeType) && volumeType !== 'gp3' ? iops : 'Default',
            },
            {
              label: 'Throughput',
              value: THROUGHPUT_TYPES.has(volumeType) ? `${throughput} MiB/s` : 'Default',
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
              : (sizeProblem ?? iopsProblem ?? throughputProblem),
          content: detailsStep,
        },
        {
          id: 'tags',
          title: 'Tags',
          isOptional: true,
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
