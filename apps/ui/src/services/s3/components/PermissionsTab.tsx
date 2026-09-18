import { S3_PUBLIC_ACCESS_ALL_BLOCKED, S3_PUBLIC_ACCESS_DEFAULTS } from '@localdeck/shared';
import type { ApiError } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Toggle from '@cloudscape-design/components/toggle';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { JsonEditor } from '../../../components/JsonEditor';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { toApiError } from '../../../lib/apiClient';
import {
  deleteBucketPolicy,
  getBucketPolicy,
  getPublicAccessBlock,
  putBucketPolicy,
  putPublicAccessBlock,
  type S3PublicAccessState,
} from '../api';
import { toFriendlyS3Error } from '../errors';
import { EXAMPLE_BUCKET_POLICY, validateBucketPolicy } from '../policy';
import { PublicAccessBlockSettings } from './PublicAccessBlockSettings';

export interface PermissionsTabProps {
  bucket: string;
}

function isFullyBlocked(state: S3PublicAccessState | null): boolean {
  if (state === null) return false;
  return (
    state.BlockPublicAcls &&
    state.IgnorePublicAcls &&
    state.BlockPublicPolicy &&
    state.RestrictPublicBuckets
  );
}

/**
 * The bucket's Permissions tab: the Block Public Access master toggle with all
 * four settings spelled out, and the bucket policy in a JsonEditor with IAM
 * policy structure validation on top of the JSON parse check.
 */
export function PermissionsTab({ bucket }: PermissionsTabProps): ReactElement {
  const flashbar = useFlashbar();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiError | null>(null);

  const [publicAccess, setPublicAccess] = useState<S3PublicAccessState | null>(null);
  const [blocked, setBlocked] = useState(true);
  const [savingPublicAccess, setSavingPublicAccess] = useState(false);
  const [publicAccessError, setPublicAccessError] = useState<string | null>(null);

  const [policyText, setPolicyText] = useState('');
  const [savedPolicy, setSavedPolicy] = useState<string | undefined>(undefined);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [deletingPolicy, setDeletingPolicy] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const id = requestId.current + 1;
    requestId.current = id;
    setLoading(true);
    setLoadError(null);
    try {
      const [access, policy] = await Promise.all([
        getPublicAccessBlock(bucket),
        getBucketPolicy(bucket),
      ]);
      if (requestId.current !== id) return;
      setPublicAccess(access);
      setBlocked(isFullyBlocked(access));
      setPolicyText(policy ?? '');
      setSavedPolicy(policy);
    } catch (caught) {
      if (requestId.current !== id) return;
      setLoadError(toApiError(caught));
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [bucket]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bucket permissions fetch
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  const validation = validateBucketPolicy(policyText);
  const policyChanged = policyText !== (savedPolicy ?? '');

  const savePublicAccess = async (): Promise<void> => {
    setSavingPublicAccess(true);
    setPublicAccessError(null);
    try {
      const settings = blocked ? S3_PUBLIC_ACCESS_ALL_BLOCKED : S3_PUBLIC_ACCESS_DEFAULTS;
      await putPublicAccessBlock({ bucket, settings });
      setPublicAccess({ ...settings, configured: true });
      flashbar.notify({
        type: 'success',
        header: blocked ? 'Public access blocked' : 'Block Public Access updated',
        content: bucket,
      });
    } catch (caught) {
      setPublicAccessError(toFriendlyS3Error(caught).message);
    } finally {
      setSavingPublicAccess(false);
    }
  };

  const savePolicy = async (): Promise<void> => {
    setSavingPolicy(true);
    setPolicyError(null);
    try {
      await putBucketPolicy({ bucket, policy: policyText });
      setSavedPolicy(policyText);
      flashbar.notify({ type: 'success', header: 'Bucket policy saved', content: bucket });
    } catch (caught) {
      setPolicyError(toFriendlyS3Error(caught).message);
    } finally {
      setSavingPolicy(false);
    }
  };

  const removePolicy = async (): Promise<void> => {
    setDeletingPolicy(true);
    setPolicyError(null);
    try {
      await deleteBucketPolicy(bucket);
      setSavedPolicy(undefined);
      setPolicyText('');
      flashbar.notify({ type: 'success', header: 'Bucket policy deleted', content: bucket });
    } catch (caught) {
      setPolicyError(toFriendlyS3Error(caught).message);
    } finally {
      setDeletingPolicy(false);
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
        header="Could not load the bucket permissions"
        action={
          <Button
            onClick={() => {
              void load();
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

  const settings = blocked ? S3_PUBLIC_ACCESS_ALL_BLOCKED : S3_PUBLIC_ACCESS_DEFAULTS;

  return (
    <SpaceBetween size="l">
      <Container
        header={
          <Header
            variant="h2"
            description="Block Public Access stops public ACLs and policies from making this bucket public."
          >
            Block Public Access
          </Header>
        }
      >
        <Form
          actions={
            <Button
              variant="primary"
              loading={savingPublicAccess}
              disabled={blocked === isFullyBlocked(publicAccess)}
              onClick={() => {
                void savePublicAccess();
              }}
            >
              Save changes
            </Button>
          }
        >
          <SpaceBetween size="m">
            {publicAccessError === null ? null : <Alert type="error">{publicAccessError}</Alert>}

            <Box>
              Current status:{' '}
              <StatusIndicator type={isFullyBlocked(publicAccess) ? 'success' : 'warning'}>
                {isFullyBlocked(publicAccess) ? 'Blocked' : 'Not fully blocked'}
              </StatusIndicator>
              {publicAccess?.configured === false ? (
                <Box variant="small" color="text-body-secondary">
                  No explicit configuration exists for this bucket yet.
                </Box>
              ) : null}
            </Box>

            <Toggle
              checked={blocked}
              onChange={({ detail }) => {
                setBlocked(detail.checked);
              }}
            >
              Block all public access
            </Toggle>

            {blocked ? (
              <Alert type="info">Public access is blocked for this bucket.</Alert>
            ) : (
              <Alert type="warning">
                Turning this off does not make the bucket public by itself — a bucket policy that
                grants public access would now take effect.
              </Alert>
            )}

            <PublicAccessBlockSettings settings={settings} />
          </SpaceBetween>
        </Form>
      </Container>

      <Container
        header={
          <Header
            variant="h2"
            description="A bucket policy is a JSON resource-based IAM policy. The api validates the JSON and the IAM structure before LocalStack sees it."
          >
            Bucket policy
          </Header>
        }
      >
        <Form
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                variant="link"
                disabled={deletingPolicy || savingPolicy || savedPolicy === undefined}
                onClick={() => {
                  void removePolicy();
                }}
              >
                Delete policy
              </Button>
              <Button
                variant="primary"
                loading={savingPolicy}
                disabled={!validation.valid || !policyChanged}
                onClick={() => {
                  void savePolicy();
                }}
              >
                Save policy
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="m">
            {policyError === null ? null : <Alert type="error">{policyError}</Alert>}

            {validation.valid && validation.grantsPublicAccess ? (
              <Alert type="warning" header="This policy grants public access">
                A statement allows a wildcard principal. With Block Public Access turned on,
                LocalStack rejects a public policy; review the statements before saving.
              </Alert>
            ) : null}

            <JsonEditor
              value={policyText}
              onChange={setPolicyText}
              label="Bucket policy"
              ariaLabel="Bucket policy JSON"
              rows={18}
              errorText={
                validation.jsonError === null && validation.structureErrors.length > 0
                  ? validation.structureErrors.join(' ')
                  : undefined
              }
              description="Validated as JSON, then as an IAM policy document (Version, Statement, Effect, Principal, Action, Resource)."
            />

            {policyText.trim().length === 0 ? (
              <Box>
                <Button
                  variant="inline-link"
                  onClick={() => {
                    setPolicyText(EXAMPLE_BUCKET_POLICY);
                    setPolicyError(null);
                  }}
                >
                  Use example policy
                </Button>
              </Box>
            ) : null}

            {validation.valid ? (
              <Box>
                <StatusIndicator type="success">Valid IAM policy structure</StatusIndicator>
              </Box>
            ) : null}
          </SpaceBetween>
        </Form>
      </Container>
    </SpaceBetween>
  );
}

export default PermissionsTab;
