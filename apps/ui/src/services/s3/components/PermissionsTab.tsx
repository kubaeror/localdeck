import {
  S3_PUBLIC_ACCESS_ALL_BLOCKED,
  S3_PUBLIC_ACCESS_DEFAULTS,
  type ApiError,
  type S3PublicAccessBlock,
} from '@localdeck/shared';
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
import { InfoTooltip } from '../../../components/InfoTooltip';
import { JsonEditor } from '../../../components/JsonEditor';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { toApiError } from '../../../lib/apiClient';
import {
  deleteBucketPolicy,
  deletePublicAccessBlock,
  getBucketPolicy,
  getPublicAccessBlock,
  putBucketPolicy,
  putPublicAccessBlock,
  S3_PUBLIC_ACCESS_NONE,
  type S3PublicAccessState,
} from '../api';
import { toFriendlyS3Error } from '../errors';
import { buildExampleBucketPolicy, validateBucketPolicy } from '../policy';
import { PublicAccessBlockSettings } from './PublicAccessBlockSettings';

export interface PermissionsTabProps {
  bucket: string;
  /**
   * Unsaved Block Public Access edits, lifted to the detail page so switching
   * tabs does not discard them. Without the prop the tab keeps its own draft.
   */
  settingsDraft?: S3PublicAccessBlock;
  onSettingsDraftChange?: (settings: S3PublicAccessBlock | undefined) => void;
  /** Unsaved policy edits, lifted to the detail page so tab switches keep them. */
  policyDraft?: string;
  onPolicyDraftChange?: (policy: string | undefined) => void;
}

function blockedCount(settings: S3PublicAccessBlock): number {
  return [
    settings.BlockPublicAcls,
    settings.IgnorePublicAcls,
    settings.BlockPublicPolicy,
    settings.RestrictPublicBuckets,
  ].filter(Boolean).length;
}

/**
 * The bucket's Permissions tab: the four Block Public Access settings with a
 * master toggle, and the bucket policy in a JsonEditor with IAM policy
 * structure validation on top of the JSON parse check.
 *
 * The settings table is driven by the four values that were actually loaded,
 * and Save writes exactly the values on screen, so partial configurations are
 * neither displayed nor persisted as something else.
 */
export function PermissionsTab({
  bucket,
  settingsDraft,
  onSettingsDraftChange,
  policyDraft,
  onPolicyDraftChange,
}: PermissionsTabProps): ReactElement {
  const flashbar = useFlashbar();

  const [loading, setLoading] = useState(true);

  const [publicAccess, setPublicAccess] = useState<S3PublicAccessState | null>(null);
  const [accessLoadError, setAccessLoadError] = useState<ApiError | null>(null);
  const [savingPublicAccess, setSavingPublicAccess] = useState(false);
  const [deletingPublicAccess, setDeletingPublicAccess] = useState(false);
  const [publicAccessError, setPublicAccessError] = useState<string | null>(null);

  const [policy, setPolicy] = useState<string | undefined>(undefined);
  const [policyLoadError, setPolicyLoadError] = useState<ApiError | null>(null);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [deletingPolicy, setDeletingPolicy] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);

  const [localSettingsDraft, setLocalSettingsDraft] = useState<S3PublicAccessBlock | null>(null);
  const [localPolicyDraft, setLocalPolicyDraft] = useState<string | null>(null);

  const requestId = useRef(0);
  const accessAbort = useRef<AbortController | null>(null);
  const policyAbort = useRef<AbortController | null>(null);

  const loadAccess = useCallback(async (): Promise<void> => {
    accessAbort.current?.abort();
    const controller = new AbortController();
    accessAbort.current = controller;
    setAccessLoadError(null);
    try {
      const access = await getPublicAccessBlock(bucket, controller.signal);
      if (controller.signal.aborted) return;
      setPublicAccess(access);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setAccessLoadError(toApiError(caught));
    }
  }, [bucket]);

  const loadPolicy = useCallback(async (): Promise<void> => {
    policyAbort.current?.abort();
    const controller = new AbortController();
    policyAbort.current = controller;
    setPolicyLoadError(null);
    try {
      const result = await getBucketPolicy(bucket, controller.signal);
      if (controller.signal.aborted) return;
      setPolicy(result);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setPolicyLoadError(toApiError(caught));
    }
  }, [bucket]);

  // Block Public Access and the policy are independent reads.
  const load = useCallback(async (): Promise<void> => {
    const id = requestId.current + 1;
    requestId.current = id;
    setLoading(true);
    await Promise.allSettled([loadAccess(), loadPolicy()]);
    if (requestId.current === id) setLoading(false);
  }, [loadAccess, loadPolicy]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bucket permissions fetch
    void load();
    return () => {
      requestId.current += 1;
      accessAbort.current?.abort();
      policyAbort.current?.abort();
    };
  }, [load]);

  const loadedSettings: S3PublicAccessBlock =
    publicAccess === null
      ? S3_PUBLIC_ACCESS_DEFAULTS
      : {
          BlockPublicAcls: publicAccess.BlockPublicAcls,
          IgnorePublicAcls: publicAccess.IgnorePublicAcls,
          BlockPublicPolicy: publicAccess.BlockPublicPolicy,
          RestrictPublicBuckets: publicAccess.RestrictPublicBuckets,
        };
  const displayedSettings = settingsDraft ?? localSettingsDraft ?? loadedSettings;
  const settingsChanged = JSON.stringify(displayedSettings) !== JSON.stringify(loadedSettings);
  const blocked = blockedCount(displayedSettings);
  const policyText = policyDraft ?? localPolicyDraft ?? policy ?? '';
  const validation = validateBucketPolicy(policyText);
  const policyChanged = policyText !== (policy ?? '');
  const hasPolicy = policy !== undefined || policyDraft !== undefined || localPolicyDraft !== null;

  const updateSettingsDraft = (next: S3PublicAccessBlock): void => {
    if (onSettingsDraftChange !== undefined) onSettingsDraftChange(next);
    else setLocalSettingsDraft(next);
  };
  const clearSettingsDraft = (): void => {
    if (onSettingsDraftChange !== undefined) onSettingsDraftChange(undefined);
    else setLocalSettingsDraft(null);
  };
  const updatePolicyDraft = (next: string): void => {
    if (onPolicyDraftChange !== undefined) onPolicyDraftChange(next);
    else setLocalPolicyDraft(next);
  };
  const clearPolicyDraft = (): void => {
    if (onPolicyDraftChange !== undefined) onPolicyDraftChange(undefined);
    else setLocalPolicyDraft(null);
  };

  const savePublicAccess = async (): Promise<void> => {
    setSavingPublicAccess(true);
    setPublicAccessError(null);
    try {
      await putPublicAccessBlock({ bucket, settings: displayedSettings });
      setPublicAccess({ ...displayedSettings, configured: true });
      clearSettingsDraft();
      flashbar.notify({
        type: 'success',
        header:
          blockedCount(displayedSettings) === 4
            ? 'Public access blocked'
            : 'Block Public Access updated',
        content: bucket,
      });
    } catch (caught) {
      setPublicAccessError(toFriendlyS3Error(caught).message);
    } finally {
      setSavingPublicAccess(false);
    }
  };

  const removePublicAccess = async (): Promise<void> => {
    setDeletingPublicAccess(true);
    setPublicAccessError(null);
    try {
      await deletePublicAccessBlock(bucket);
      // No explicit configuration is every setting off, not the console's
      // partial "defaults": showing those as 2-of-4 would contradict the
      // "No explicit configuration" note and a Save would silently re-apply
      // blocks the user just removed.
      setPublicAccess({ ...S3_PUBLIC_ACCESS_NONE, configured: false });
      clearSettingsDraft();
      flashbar.notify({
        type: 'success',
        header: 'Block Public Access configuration removed',
        content: bucket,
      });
    } catch (caught) {
      setPublicAccessError(toFriendlyS3Error(caught).message);
    } finally {
      setDeletingPublicAccess(false);
    }
  };

  const savePolicy = async (): Promise<void> => {
    setSavingPolicy(true);
    setPolicyError(null);
    try {
      await putBucketPolicy({ bucket, policy: policyText });
      setPolicy(policyText);
      clearPolicyDraft();
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
      setPolicy(undefined);
      clearPolicyDraft();
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
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                variant="link"
                loading={deletingPublicAccess}
                disabled={
                  savingPublicAccess ||
                  deletingPublicAccess ||
                  publicAccess?.configured !== true ||
                  accessLoadError !== null
                }
                onClick={() => {
                  void removePublicAccess();
                }}
              >
                Remove configuration
              </Button>
              <Button
                variant="primary"
                loading={savingPublicAccess}
                disabled={!settingsChanged || accessLoadError !== null}
                onClick={() => {
                  void savePublicAccess();
                }}
              >
                Save changes
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="m">
            {publicAccessError === null ? null : <Alert type="error">{publicAccessError}</Alert>}
            {accessLoadError === null ? null : (
              <Alert
                type="error"
                header="Could not read the Block Public Access settings"
                action={
                  <Button
                    onClick={() => {
                      void loadAccess();
                    }}
                  >
                    Retry
                  </Button>
                }
              >
                {accessLoadError.message}
              </Alert>
            )}

            <Box>
              Current status:{' '}
              <StatusIndicator
                type={blocked === 4 ? 'success' : blocked === 0 ? 'stopped' : 'warning'}
              >
                {blocked === 4
                  ? 'Blocked'
                  : blocked === 0
                    ? 'Not blocked'
                    : `Partially blocked (${blocked} of 4 settings)`}
              </StatusIndicator>
              {publicAccess?.configured === false ? (
                <Box variant="small" color="text-body-secondary">
                  No explicit configuration exists for this bucket yet.
                </Box>
              ) : null}
            </Box>

            <Toggle
              checked={blocked === 4}
              onChange={({ detail }) => {
                updateSettingsDraft(
                  detail.checked ? S3_PUBLIC_ACCESS_ALL_BLOCKED : S3_PUBLIC_ACCESS_DEFAULTS,
                );
              }}
            >
              Block all public access
            </Toggle>

            {blocked === 4 ? (
              <Alert type="info">Public access is blocked for this bucket.</Alert>
            ) : (
              <Alert type="warning">
                Turning this off does not make the bucket public by itself — a bucket policy that
                grants public access would now take effect.
              </Alert>
            )}

            <PublicAccessBlockSettings
              settings={displayedSettings}
              onChange={(setting, checked) => {
                updateSettingsDraft({ ...displayedSettings, [setting]: checked });
              }}
            />
          </SpaceBetween>
        </Form>
      </Container>

      <Container
        header={
          <Header
            variant="h2"
            description="ACLs are a legacy access-control mechanism. Bucket policies and Block Public Access are the supported controls."
          >
            Access control list (ACL)
          </Header>
        }
      >
        <SpaceBetween size="s">
          <Box color="text-body-secondary">
            Bucket and object ACLs are not available in this LocalDeck build.
          </Box>
          <InfoTooltip content="ACL operations (GetBucketAcl, PutBucketAcl and GetBucketOwnershipControls) are not enabled in the LocalDeck registry yet.">
            <Button disabled>Edit ACL</Button>
          </InfoTooltip>
        </SpaceBetween>
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
                disabled={deletingPolicy || savingPolicy || policyLoadError !== null || !hasPolicy}
                onClick={() => {
                  void removePolicy();
                }}
              >
                Delete policy
              </Button>
              <Button
                variant="primary"
                loading={savingPolicy}
                disabled={!validation.valid || !policyChanged || policyLoadError !== null}
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
            {policyLoadError === null ? null : (
              <Alert
                type="error"
                header="Could not read the bucket policy"
                action={
                  <Button
                    onClick={() => {
                      void loadPolicy();
                    }}
                  >
                    Retry
                  </Button>
                }
              >
                {policyLoadError.message}
              </Alert>
            )}

            {validation.valid && validation.grantsPublicAccess ? (
              <Alert type="warning" header="This policy grants public access">
                A statement allows a wildcard principal. With Block Public Access turned on,
                LocalStack rejects a public policy; review the statements before saving.
              </Alert>
            ) : null}

            <JsonEditor
              value={policyText}
              onChange={updatePolicyDraft}
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
                    updatePolicyDraft(buildExampleBucketPolicy(bucket));
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
