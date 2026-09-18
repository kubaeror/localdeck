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
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { JsonEditor } from '../../../components/JsonEditor';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { toApiError } from '../../../lib/apiClient';
import { getRole, updateAssumeRolePolicy } from '../api';
import { toFriendlyIamError } from '../errors';
import { validateTrustPolicy } from '../policy';

export interface TrustPolicyPanelProps {
  roleName: string;
}

/**
 * The role's Trust relationships tab: the assume-role policy in a JsonEditor
 * with trust-policy structure validation, saved through `UpdateAssumeRolePolicy`
 * (which replaces the document — IAM trust policies are not versioned).
 */
export function TrustPolicyPanel({ roleName }: TrustPolicyPanelProps): ReactElement {
  const flashbar = useFlashbar();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [document, setDocument] = useState('');
  const [savedDocument, setSavedDocument] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const id = requestId.current + 1;
    requestId.current = id;
    setLoading(true);
    try {
      const role = await getRole(roleName);
      if (requestId.current !== id) return;
      const text = role.assumeRolePolicyDocument ?? '';
      setDocument(text);
      setSavedDocument(text);
      setLoadError(null);
    } catch (caught) {
      if (requestId.current !== id) return;
      setLoadError(toApiError(caught));
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [roleName]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- trust policy fetch
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  const validation = validateTrustPolicy(document);
  const changed = document !== savedDocument;

  const save = async (): Promise<void> => {
    setSaving(true);
    setSaveError(null);
    try {
      await updateAssumeRolePolicy({ roleName, trustPolicy: document });
      setSavedDocument(document);
      flashbar.notify({
        type: 'success',
        header: 'Trust policy updated',
        content: roleName,
      });
    } catch (caught) {
      setSaveError(toFriendlyIamError(caught, 'trustPolicy').message);
    } finally {
      setSaving(false);
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
        header="Could not load the trust policy"
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

  return (
    <Container
      header={
        <Header
          variant="h2"
          description="The trust policy names who can assume this role. LocalDeck validates the JSON and the policy structure before LocalStack sees it."
        >
          Trust relationships
        </Header>
      }
    >
      <Form
        actions={
          <Button
            variant="primary"
            loading={saving}
            disabled={!changed || !validation.valid}
            onClick={() => {
              void save();
            }}
          >
            Update trust policy
          </Button>
        }
      >
        <SpaceBetween size="m">
          {saveError === null ? null : <Alert type="error">{saveError}</Alert>}

          <JsonEditor
            value={document}
            onChange={setDocument}
            label="Trust policy"
            ariaLabel="Trust policy JSON"
            rows={16}
            errorText={
              validation.jsonError === null && validation.structureErrors.length > 0
                ? validation.structureErrors.join(' ')
                : undefined
            }
            description="Validated as JSON, then as a trust policy document (Version, Statement, Effect, Principal, Action)."
          />

          {validation.valid ? (
            <Box>
              <StatusIndicator type="success">Valid trust policy structure</StatusIndicator>
            </Box>
          ) : null}
        </SpaceBetween>
      </Form>
    </Container>
  );
}

export default TrustPolicyPanel;
