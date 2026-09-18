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
import { TagsEditor, validateTags } from '../../../components/TagsEditor';
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
import { meaningfulTags } from '../tags';

export interface PropertiesTabProps {
  bucket: string;
  /** From ListBuckets on the detail page; the tab does not re-fetch it. */
  creationDate?: string;
  /**
   * Unsaved versioning choice, lifted to the detail page so switching tabs
   * does not discard it. Without the prop the tab keeps its own draft.
   */
  versioningDraft?: boolean;
  onVersioningDraftChange?: (enabled: boolean | undefined) => void;
  /** Unsaved tag edits, lifted to the detail page so tab switches keep them. */
  tagsDraft?: readonly AwsTag[];
  onTagsDraftChange?: (tags: readonly AwsTag[] | undefined) => void;
}

/**
 * The bucket's Properties tab: versioning on/off, the tags editor and the
 * default-encryption readout. Versioning, tags and encryption load
 * independently, so one failing read keeps the other sections usable, and
 * every change is a separate, explicit save.
 */
export function PropertiesTab({
  bucket,
  creationDate,
  versioningDraft,
  onVersioningDraftChange,
  tagsDraft,
  onTagsDraftChange,
}: PropertiesTabProps): ReactElement {
  const flashbar = useFlashbar();

  const [loading, setLoading] = useState(true);

  const [versioning, setVersioning] = useState<S3BucketVersioning | null>(null);
  const [versioningLoadError, setVersioningLoadError] = useState<ApiError | null>(null);
  const [savingVersioning, setSavingVersioning] = useState(false);
  const [versioningError, setVersioningError] = useState<string | null>(null);

  const [tags, setTags] = useState<readonly AwsTag[]>([]);
  const [savedTags, setSavedTags] = useState<readonly AwsTag[]>([]);
  const [tagsLoadError, setTagsLoadError] = useState<ApiError | null>(null);
  const [savingTags, setSavingTags] = useState(false);
  const [tagsError, setTagsError] = useState<string | null>(null);

  const [encryption, setEncryption] = useState<S3BucketEncryption | null>(null);
  const [encryptionLoadError, setEncryptionLoadError] = useState<ApiError | null>(null);
  const [location, setLocation] = useState('');
  const [bucketLoadError, setBucketLoadError] = useState<ApiError | null>(null);

  // Drafts used when the detail page does not lift them.
  const [localVersioningDraft, setLocalVersioningDraft] = useState<boolean | null>(null);
  const [localTagsDraft, setLocalTagsDraft] = useState<readonly AwsTag[] | null>(null);

  const propertiesRequestId = useRef(0);
  const versioningAbort = useRef<AbortController | null>(null);
  const tagsAbort = useRef<AbortController | null>(null);
  const encryptionAbort = useRef<AbortController | null>(null);
  const locationAbort = useRef<AbortController | null>(null);

  const loadVersioning = useCallback(async (): Promise<void> => {
    versioningAbort.current?.abort();
    const controller = new AbortController();
    versioningAbort.current = controller;
    setVersioningLoadError(null);
    try {
      const result = await getBucketVersioning(bucket, controller.signal);
      if (controller.signal.aborted) return;
      setVersioning(result);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setVersioningLoadError(toApiError(caught));
    }
  }, [bucket]);

  const loadTags = useCallback(async (): Promise<void> => {
    tagsAbort.current?.abort();
    const controller = new AbortController();
    tagsAbort.current = controller;
    setTagsLoadError(null);
    try {
      const result = await getBucketTags(bucket, controller.signal);
      if (controller.signal.aborted) return;
      setTags(result);
      setSavedTags(result);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setTagsLoadError(toApiError(caught));
    }
  }, [bucket]);

  const loadEncryption = useCallback(async (): Promise<void> => {
    encryptionAbort.current?.abort();
    const controller = new AbortController();
    encryptionAbort.current = controller;
    setEncryptionLoadError(null);
    try {
      const result = await getBucketEncryption(bucket, controller.signal);
      if (controller.signal.aborted) return;
      setEncryption(result);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setEncryptionLoadError(toApiError(caught));
    }
  }, [bucket]);

  // Versioning, tags and encryption are independent reads: one failure must
  // not hide the sections that did load.
  const loadProperties = useCallback(async (): Promise<void> => {
    const id = propertiesRequestId.current + 1;
    propertiesRequestId.current = id;
    setLoading(true);
    await Promise.allSettled([loadVersioning(), loadTags(), loadEncryption()]);
    if (propertiesRequestId.current === id) setLoading(false);
  }, [loadEncryption, loadTags, loadVersioning]);

  // The bucket's region is a separate read so a missing location cannot hide
  // the versioning and tag sections.
  const loadLocation = useCallback(async (): Promise<void> => {
    locationAbort.current?.abort();
    const controller = new AbortController();
    locationAbort.current = controller;
    setBucketLoadError(null);
    try {
      const result = await getBucketLocation(bucket, controller.signal);
      if (controller.signal.aborted) return;
      setLocation(result);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setBucketLoadError(toApiError(caught));
    }
  }, [bucket]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bucket properties fetch
    void loadProperties();
    void loadLocation();
    return () => {
      propertiesRequestId.current += 1;
      versioningAbort.current?.abort();
      tagsAbort.current?.abort();
      encryptionAbort.current?.abort();
      locationAbort.current?.abort();
    };
  }, [loadProperties, loadLocation]);

  const currentVersioningEnabled = versioning?.status === 'Enabled';
  const versioningEnabled = versioningDraft ?? localVersioningDraft ?? currentVersioningEnabled;
  const versioningChanged = versioningEnabled !== currentVersioningEnabled;

  const displayedTags = tagsDraft ?? localTagsDraft ?? tags;
  const tagsChanged = JSON.stringify(displayedTags) !== JSON.stringify(savedTags);
  const tagProblems = validateTags(displayedTags);
  const tagsInvalid = tagProblems.length > 0;

  const updateVersioningDraft = (enabled: boolean): void => {
    if (onVersioningDraftChange !== undefined) onVersioningDraftChange(enabled);
    else setLocalVersioningDraft(enabled);
  };
  const clearVersioningDraft = (): void => {
    if (onVersioningDraftChange !== undefined) onVersioningDraftChange(undefined);
    else setLocalVersioningDraft(null);
  };
  const updateTagsDraft = (next: readonly AwsTag[]): void => {
    if (onTagsDraftChange !== undefined) onTagsDraftChange(next);
    else setLocalTagsDraft(next);
  };
  const clearTagsDraft = (): void => {
    if (onTagsDraftChange !== undefined) onTagsDraftChange(undefined);
    else setLocalTagsDraft(null);
  };

  const saveVersioning = async (): Promise<void> => {
    setSavingVersioning(true);
    setVersioningError(null);
    try {
      await putBucketVersioning({ bucket, enabled: versioningEnabled });
      // MFA delete is loaded state we never write here; keep it as it was.
      setVersioning({
        status: versioningEnabled ? 'Enabled' : 'Suspended',
        mfaDelete: versioning?.mfaDelete ?? false,
      });
      clearVersioningDraft();
      flashbar.notify({
        type: 'success',
        header: versioningEnabled ? 'Versioning enabled' : 'Versioning suspended',
        content: bucket,
      });
    } catch (caught) {
      setVersioningError(toFriendlyS3Error(caught).message);
    } finally {
      setSavingVersioning(false);
    }
  };

  const saveTags = async (): Promise<void> => {
    const problem = tagProblems[0]?.message ?? null;
    if (problem !== null) {
      setTagsError(problem);
      return;
    }
    const toSave = meaningfulTags(displayedTags);
    setSavingTags(true);
    setTagsError(null);
    try {
      if (toSave.length === 0) await deleteBucketTags(bucket);
      else await putBucketTags({ bucket, tags: toSave });
      setTags(toSave);
      setSavedTags(toSave);
      clearTagsDraft();
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

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Bucket overview</Header>}>
        <SpaceBetween size="m">
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
                  encryptionLoadError !== null ? (
                    <StatusIndicator type="warning">Unknown</StatusIndicator>
                  ) : encryption === null || !encryption.configured ? (
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
          {encryptionLoadError === null ? null : (
            <Alert
              type="error"
              header="Could not read the default encryption"
              action={
                <Button
                  onClick={() => {
                    void loadEncryption();
                  }}
                >
                  Retry
                </Button>
              }
            >
              {encryptionLoadError.message}
            </Alert>
          )}
        </SpaceBetween>
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
              disabled={!versioningChanged || versioningLoadError !== null}
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
            {versioningLoadError === null ? null : (
              <Alert
                type="error"
                header="Could not read the bucket versioning"
                action={
                  <Button
                    onClick={() => {
                      void loadVersioning();
                    }}
                  >
                    Retry
                  </Button>
                }
              >
                {versioningLoadError.message}
              </Alert>
            )}
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
            <Box>
              MFA delete:{' '}
              <StatusIndicator type={versioning?.mfaDelete === true ? 'success' : 'stopped'}>
                {versioning?.mfaDelete === true ? 'Enabled' : 'Disabled'}
              </StatusIndicator>{' '}
              <Box variant="small" color="text-body-secondary">
                MFA delete can only be changed by the account root user, so LocalDeck keeps the
                loaded value.
              </Box>
            </Box>
            <FormField label="Bucket versioning">
              <RadioGroup
                value={versioningEnabled ? 'enabled' : 'disabled'}
                onChange={({ detail }) => {
                  updateVersioningDraft(detail.value === 'enabled');
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
              disabled={!tagsChanged || tagsInvalid || tagsLoadError !== null}
              onClick={() => {
                void saveTags();
              }}
            >
              Save changes
            </Button>
          }
        >
          <SpaceBetween size="m">
            {tagsLoadError === null ? null : (
              <Alert
                type="error"
                header="Could not read the bucket tags"
                action={
                  <Button
                    onClick={() => {
                      void loadTags();
                    }}
                  >
                    Retry
                  </Button>
                }
              >
                {tagsLoadError.message}
              </Alert>
            )}
            <TagsEditor
              tags={displayedTags}
              onChange={updateTagsDraft}
              errorText={tagsError ?? undefined}
              description="Saving replaces the bucket's entire tag set; saving with no tags removes it."
            />
          </SpaceBetween>
        </Form>
      </Container>
    </SpaceBetween>
  );
}

export default PropertiesTab;
