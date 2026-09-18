import type { ApiError, AwsTag } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import CopyToClipboard from '@cloudscape-design/components/copy-to-clipboard';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import RadioGroup from '@cloudscape-design/components/radio-group';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useEffect, useRef, useState, useCallback, type ReactElement } from 'react';
import { TagsEditor } from '../../../components/TagsEditor';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { toApiError } from '../../../lib/apiClient';
import { formatDateTime } from '../../../lib/format';
import {
  deleteBucketTags,
  getBucketEncryption,
  getBucketLocation,
  getBucketTags,
  getBucketVersioning,
  putBucketTags,
  putBucketVersioning,
  type S3BucketEncryption,
  type S3BucketVersioning,
} from '../api';
import { toFriendlyS3Error } from '../errors';

export interface PropertiesTabProps {
  bucket: string;
  /** From ListBuckets on the detail page; the tab does not re-fetch it. */
  creationDate?: string;
}

/**
 * The bucket's Properties tab: versioning on/off, the tags editor and the
 * default-encryption readout. Every change is a separate, explicit save, and
 * failures are rendered next to the section that caused them.
 */
export function PropertiesTab({ bucket, creationDate }: PropertiesTabProps): ReactElement {
  const flashbar = useFlashbar();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiError | null>(null);

  const [versioning, setVersioning] = useState<S3BucketVersioning | null>(null);
  const [versioningDraft, setVersioningDraft] = useState(false);
  const [savingVersioning, setSavingVersioning] = useState(false);
  const [versioningError, setVersioningError] = useState<string | null>(null);

  const [tags, setTags] = useState<readonly AwsTag[]>([]);
  const [savedTags, setSavedTags] = useState<readonly AwsTag[]>([]);
  const [savingTags, setSavingTags] = useState(false);
  const [tagsError, setTagsError] = useState<string | null>(null);

  const [encryption, setEncryption] = useState<S3BucketEncryption | null>(null);
  const [location, setLocation] = useState('');
  const [bucketLoadError, setBucketLoadError] = useState<ApiError | null>(null);
  const propertiesRequestId = useRef(0);
  const locationRequestId = useRef(0);

  // Versioning, tags and encryption are independent reads.
  const loadProperties = useCallback(async (): Promise<void> => {
    const id = propertiesRequestId.current + 1;
    propertiesRequestId.current = id;
    setLoading(true);
    setLoadError(null);
    try {
      const [versioningResult, tagResult, encryptionResult] = await Promise.all([
        getBucketVersioning(bucket),
        getBucketTags(bucket),
        getBucketEncryption(bucket),
      ]);
      if (propertiesRequestId.current !== id) return;
      setVersioning(versioningResult);
      setVersioningDraft(versioningResult.status === 'Enabled');
      setTags(tagResult);
      setSavedTags(tagResult);
      setEncryption(encryptionResult);
    } catch (caught) {
      if (propertiesRequestId.current !== id) return;
      setLoadError(toApiError(caught));
    } finally {
      if (propertiesRequestId.current === id) setLoading(false);
    }
  }, [bucket]);

  // The bucket's region is a separate read so a missing location cannot hide
  // the versioning and tag sections.
  const loadLocation = useCallback(async (): Promise<void> => {
    const id = locationRequestId.current + 1;
    locationRequestId.current = id;
    setBucketLoadError(null);
    try {
      const result = await getBucketLocation(bucket);
      if (locationRequestId.current !== id) return;
      setLocation(result);
    } catch (caught) {
      if (locationRequestId.current !== id) return;
      setBucketLoadError(toApiError(caught));
    }
  }, [bucket]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bucket properties fetch
    void loadProperties();
    return () => {
      propertiesRequestId.current += 1;
    };
  }, [loadProperties]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bucket location fetch
    void loadLocation();
    return () => {
      locationRequestId.current += 1;
    };
  }, [loadLocation]);

  const currentVersioningEnabled = versioning?.status === 'Enabled';
  const tagsChanged = JSON.stringify(tags) !== JSON.stringify(savedTags);

  const saveVersioning = async (): Promise<void> => {
    setSavingVersioning(true);
    setVersioningError(null);
    try {
      await putBucketVersioning({ bucket, enabled: versioningDraft });
      setVersioning({ status: versioningDraft ? 'Enabled' : 'Suspended', mfaDelete: false });
      flashbar.notify({
        type: 'success',
        header: versioningDraft ? 'Versioning enabled' : 'Versioning suspended',
        content: bucket,
      });
    } catch (caught) {
      setVersioningError(toFriendlyS3Error(caught).message);
    } finally {
      setSavingVersioning(false);
    }
  };

  const saveTags = async (): Promise<void> => {
    setSavingTags(true);
    setTagsError(null);
    try {
      if (tags.length === 0) await deleteBucketTags(bucket);
      else await putBucketTags({ bucket, tags });
      setSavedTags(tags);
      flashbar.notify({ type: 'success', header: 'Tags saved', content: bucket });
    } catch (caught) {
      setTagsError(toFriendlyS3Error(caught).message);
    } finally {
      setSavingTags(false);
    }
  };

  if (loading) {
    return (
      <Box textAlign="center" padding="l">
        <Spinner size="large" />
      </Box>
    );
  }

  if (loadError !== null) {
    return (
      <Alert
        type="error"
        header="Could not load the bucket properties"
        action={
          <Button
            onClick={() => {
              void loadProperties();
            }}
          >
            Retry
          </Button>
        }
      >
        {loadError.message}
      </Alert>
    );
  }

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Bucket overview</Header>}>
        <KeyValuePairs
          columns={3}
          items={[
            { label: 'Name', value: <Box variant="code">{bucket}</Box> },
            {
              label: 'ARN',
              value: (
                <SpaceBetween direction="horizontal" size="xxs">
                  <Box variant="code">arn:aws:s3:::{bucket}</Box>
                  <CopyToClipboard
                    variant="icon"
                    textToCopy={`arn:aws:s3:::${bucket}`}
                    copyButtonAriaLabel="Copy ARN"
                    copySuccessText="ARN copied"
                    copyErrorText="Could not copy the ARN"
                  />
                </SpaceBetween>
              ),
            },
            { label: 'Region', value: bucketLoadError === null ? location : 'unknown' },
            { label: 'Creation date', value: formatDateTime(creationDate) },
            {
              label: 'Default encryption',
              value:
                encryption === null || !encryption.configured ? (
                  <SpaceBetween size="xxs">
                    <StatusIndicator type="success">SSE-S3 (S3-managed keys)</StatusIndicator>
                    <Box variant="small" color="text-body-secondary">
                      No explicit encryption configuration; S3 applies SSE-S3 by default.
                    </Box>
                  </SpaceBetween>
                ) : (
                  <SpaceBetween size="xxs">
                    <Box variant="code">{encryption.algorithm ?? 'unknown'}</Box>
                    {encryption.kmsKeyArn === undefined ? null : (
                      <Box variant="small">{encryption.kmsKeyArn}</Box>
                    )}
                    {encryption.bucketKeyEnabled === true ? (
                      <Box variant="small">Bucket key enabled</Box>
                    ) : null}
                  </SpaceBetween>
                ),
            },
          ]}
        />
        {bucketLoadError === null ? null : (
          <Alert
            type="error"
            header="Could not read the bucket location"
            action={
              <Button
                onClick={() => {
                  void loadLocation();
                }}
              >
                Retry
              </Button>
            }
          >
            {bucketLoadError.message}
          </Alert>
        )}
      </Container>

      <Container
        header={
          <Header
            variant="h2"
            description="Versioning keeps every version of an object, so overwrites and deletes are recoverable."
          >
            Bucket Versioning
          </Header>
        }
      >
        <Form
          actions={
            <Button
              variant="primary"
              loading={savingVersioning}
              disabled={versioningDraft === currentVersioningEnabled}
              onClick={() => {
                void saveVersioning();
              }}
            >
              Save changes
            </Button>
          }
        >
          <SpaceBetween size="m">
            {versioningError === null ? null : <Alert type="error">{versioningError}</Alert>}
            <Box>
              Current status:{' '}
              <StatusIndicator
                type={
                  versioning?.status === 'Enabled'
                    ? 'success'
                    : versioning?.status === 'Suspended'
                      ? 'warning'
                      : 'stopped'
                }
              >
                {versioning?.status === 'Enabled'
                  ? 'Enabled'
                  : versioning?.status === 'Suspended'
                    ? 'Suspended'
                    : 'Unversioned'}
              </StatusIndicator>
            </Box>
            <FormField label="Bucket versioning">
              <RadioGroup
                value={versioningDraft ? 'enabled' : 'disabled'}
                onChange={({ detail }) => {
                  setVersioningDraft(detail.value === 'enabled');
                }}
                items={[
                  {
                    value: 'disabled',
                    label: 'Suspend versioning',
                    description: 'New objects get the null version; existing versions are kept.',
                  },
                  {
                    value: 'enabled',
                    label: 'Enable versioning',
                    description: 'Every object change creates a new version.',
                  },
                ]}
              />
            </FormField>
          </SpaceBetween>
        </Form>
      </Container>

      <Container header={<Header variant="h2">Tags</Header>}>
        <Form
          actions={
            <Button
              variant="primary"
              loading={savingTags}
              disabled={!tagsChanged}
              onClick={() => {
                void saveTags();
              }}
            >
              Save changes
            </Button>
          }
        >
          <TagsEditor
            tags={tags}
            onChange={setTags}
            errorText={tagsError ?? undefined}
            description="Saving replaces the bucket's entire tag set; saving with no tags removes it."
          />
        </Form>
      </Container>
    </SpaceBetween>
  );
}

export default PropertiesTab;
