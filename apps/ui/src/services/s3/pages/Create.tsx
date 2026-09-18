import {
  S3_PUBLIC_ACCESS_ALL_BLOCKED,
  S3_PUBLIC_ACCESS_DEFAULTS,
  type AwsTag,
} from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import RadioGroup from '@cloudscape-design/components/radio-group';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Toggle from '@cloudscape-design/components/toggle';
import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ApiError } from '@localdeck/shared';
import { CreateWizard } from '../../../components/CreateWizard';
import { TagsEditor } from '../../../components/TagsEditor';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import { createBucket } from '../api';
import { toFriendlyS3Error } from '../errors';
import { bucketNameRules, S3_REGIONS, validateBucketName } from '../naming';
import { PublicAccessBlockSettings } from '../components/PublicAccessBlockSettings';

/** Drops tag rows the user added but never filled in. */
function meaningfulTags(tags: readonly AwsTag[]): readonly AwsTag[] {
  return tags.filter((tag) => tag.Key.trim().length > 0 || tag.Value.trim().length > 0);
}

/** Duplicate keys and the 50-key limit block the Tags step. */
function tagsProblem(tags: readonly AwsTag[]): string | null {
  const keys = tags.map((tag) => tag.Key).filter((key) => key.length > 0);
  if (new Set(keys).size !== keys.length) return 'Remove duplicate tag keys before continuing.';
  if (tags.length > 50) return 'A bucket can have at most 50 tags.';
  return null;
}

/**
 * The console's create-bucket wizard: name and region, versioning, tags, Block
 * Public Access and a review step, with the summary column kept in sync.
 *
 * Bucket naming rules are validated client-side; a name LocalStack rejects
 * with `BucketAlreadyExists` comes back as an inline error on the name field
 * (and returns the wizard to that step) instead of a generic failure banner.
 */
export function CreatePage({ descriptor }: ServicePageProps): ReactElement {
  const navigate = useNavigate();
  const flashbar = useFlashbar();
  const [name, setName] = useState('');
  const [region, setRegion] = useState('us-east-1');
  const [versioning, setVersioning] = useState(false);
  const [tags, setTags] = useState<readonly AwsTag[]>([]);
  const [blockPublicAccess, setBlockPublicAccess] = useState(true);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [bucketNameError, setBucketNameError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const backToList = (): void => {
    navigate(serviceConsolePath(descriptor.id));
  };

  const clientProblem = name.length > 0 ? validateBucketName(name) : null;
  const publicAccessSettings = blockPublicAccess
    ? S3_PUBLIC_ACCESS_ALL_BLOCKED
    : S3_PUBLIC_ACCESS_DEFAULTS;

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    setBucketNameError(null);
    try {
      await createBucket({
        name,
        region,
        versioning,
        tags: meaningfulTags(tags),
        blockPublicAccess,
      });
      flashbar.notify({
        type: 'success',
        header: 'Bucket created',
        content: name,
      });
      navigate(`${serviceConsolePath(descriptor.id)}/buckets/${encodeURIComponent(name)}`);
    } catch (caught) {
      const friendly = toFriendlyS3Error(caught);
      if (friendly.field === 'bucketName') {
        setBucketNameError(friendly.message);
        setActiveStepIndex(0);
      } else {
        setError({ ...friendly.apiError, message: friendly.message });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const detailsStep = (
    <Container header={<Header variant="h2">Bucket name and Region</Header>}>
      <Form>
        <SpaceBetween size="l">
          <FormField
            label="Bucket name"
            description="A bucket name must be unique and is used in the object URLs."
            errorText={bucketNameError ?? clientProblem ?? undefined}
            constraintText={<Box variant="small">{bucketNameRules().join(' · ')}</Box>}
          >
            <Input
              value={name}
              autoFocus
              disabled={submitting}
              placeholder="my-bucket"
              onChange={({ detail }) => {
                setName(detail.value);
                setBucketNameError(null);
              }}
            />
          </FormField>

          <FormField
            label="Region"
            description="The region the bucket lives in. LocalStack accepts any region."
          >
            <Select
              selectedOption={{ value: region, label: region }}
              disabled={submitting}
              options={S3_REGIONS.map((value) => ({ value, label: value }))}
              onChange={({ detail }) => {
                setRegion(detail.selectedOption.value ?? 'us-east-1');
              }}
            />
          </FormField>
        </SpaceBetween>
      </Form>
    </Container>
  );

  const versioningStep = (
    <Container header={<Header variant="h2">Versioning</Header>}>
      <Form>
        <FormField
          label="Bucket versioning"
          description="Versioning keeps every version of an object in the bucket, so overwrites and deletes are recoverable."
        >
          <RadioGroup
            value={versioning ? 'enabled' : 'disabled'}
            onChange={({ detail }) => {
              setVersioning(detail.value === 'enabled');
            }}
            items={[
              {
                value: 'disabled',
                label: 'Disable',
                description: 'Overwrites and deletes replace the current object version.',
              },
              {
                value: 'enabled',
                label: 'Enable',
                description:
                  'Keep every version; delete markers hide objects without removing them.',
              },
            ]}
          />
        </FormField>
      </Form>
    </Container>
  );

  const tagsStep = (
    <Container header={<Header variant="h2">Tags</Header>}>
      <TagsEditor
        tags={tags}
        onChange={setTags}
        description="Tags are key-value pairs applied to the bucket, useful for cost allocation and search."
      />
    </Container>
  );

  const publicAccessStep = (
    <Container header={<Header variant="h2">Block Public Access</Header>}>
      <SpaceBetween size="m">
        <Toggle
          checked={blockPublicAccess}
          onChange={({ detail }) => {
            setBlockPublicAccess(detail.checked);
          }}
        >
          Block <i>all</i> public access
        </Toggle>

        {blockPublicAccess ? (
          <Alert type="info">
            Public access is blocked for this bucket. Objects stay private unless access is granted
            through a bucket policy or ACL.
          </Alert>
        ) : (
          <Alert type="warning">
            Public access is not fully blocked: a bucket policy can make this bucket public.
          </Alert>
        )}

        <PublicAccessBlockSettings settings={publicAccessSettings} />
      </SpaceBetween>
    </Container>
  );

  const reviewStep = (
    <Container header={<Header variant="h2">Review</Header>}>
      <SpaceBetween size="m">
        <KeyValuePairs
          columns={1}
          items={[
            { label: 'Bucket name', value: <Box variant="code">{name}</Box> },
            { label: 'Region', value: region },
            { label: 'Versioning', value: versioning ? 'Enabled' : 'Disabled' },
            {
              label: 'Tags',
              value:
                meaningfulTags(tags).length === 0
                  ? 'No tags'
                  : meaningfulTags(tags)
                      .map((tag) => `${tag.Key}=${tag.Value}`)
                      .join(', '),
            },
            {
              label: 'Block Public Access',
              value: blockPublicAccess ? 'Block all public access' : 'Not fully blocked',
            },
          ]}
        />
        <Alert type="info" header="What happens next">
          LocalDeck creates the bucket and applies the versioning, tag and public-access settings in
          sequence. Failures after creation name the step that failed.
        </Alert>
      </SpaceBetween>
    </Container>
  );

  return (
    <CreateWizard
      title="Create bucket"
      description={descriptor.summary}
      breadcrumbs={[
        { text: descriptor.displayName, href: serviceConsolePath(descriptor.id) },
        { text: 'Create bucket' },
      ]}
      activeStepIndex={activeStepIndex}
      steps={[
        {
          id: 'details',
          title: 'Bucket name and Region',
          description: 'Name the bucket and choose the region it lives in.',
          validate: () => validateBucketName(name),
          content: detailsStep,
        },
        {
          id: 'versioning',
          title: 'Versioning',
          isOptional: true,
          content: versioningStep,
        },
        {
          id: 'tags',
          title: 'Tags',
          isOptional: true,
          validate: () => tagsProblem(tags),
          content: tagsStep,
        },
        {
          id: 'public-access',
          title: 'Block Public Access',
          isOptional: true,
          content: publicAccessStep,
        },
        {
          id: 'review',
          title: 'Review',
          content: reviewStep,
          summaryExtra: (
            <Container header={<Header variant="h2">Operations</Header>}>
              <Box variant="small" color="text-body-secondary">
                CreateBucket
                {versioning ? ', PutBucketVersioning' : ''}
                {meaningfulTags(tags).length > 0 ? ', PutBucketTagging' : ''}, PutPublicAccessBlock
              </Box>
            </Container>
          ),
        },
      ]}
      summary={[
        { label: 'Service', value: descriptor.displayName },
        { label: 'Bucket name', value: name.length === 0 ? '—' : name },
        { label: 'Region', value: region },
        { label: 'Versioning', value: versioning ? 'Enabled' : 'Disabled' },
        { label: 'Tags', value: `${meaningfulTags(tags).length}` },
        { label: 'Block Public Access', value: blockPublicAccess ? 'On' : 'Off' },
      ]}
      summaryTitle="Bucket summary"
      submitLabel="Create bucket"
      submitting={submitting}
      error={error}
      onSubmit={submit}
      onCancel={backToList}
      onStepChange={setActiveStepIndex}
    />
  );
}

export default CreatePage;
