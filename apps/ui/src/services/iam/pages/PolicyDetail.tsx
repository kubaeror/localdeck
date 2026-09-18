import type { ApiError } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table from '@cloudscape-design/components/table';
import type { TableProps } from '@cloudscape-design/components/table';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DeleteConfirmModal } from '../../../components/DeleteConfirmModal';
import { JsonEditor } from '../../../components/JsonEditor';
import { ResourceDetailPage } from '../../../components/ResourceDetailPage';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { toApiError } from '../../../lib/apiClient';
import { formatDateTime } from '../../../lib/format';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import {
  createPolicyVersion,
  deletePolicy,
  getPolicy,
  getPolicyDocument,
  listEntitiesForPolicy,
  type IamPolicy,
  type IamPolicyEntities,
} from '../api';
import { isIamCode, toFriendlyIamError } from '../errors';
import { validateIdentityPolicy } from '../policy';

interface EntityRow {
  name: string;
  id?: string;
}

interface EntityTableProps {
  title: string;
  items: readonly EntityRow[];
  /** Console path segment: users, groups or roles. */
  segment: string;
  loading: boolean;
}

function EntityTable({ title, items, segment, loading }: EntityTableProps): ReactElement {
  const navigate = useNavigate();
  const columns: readonly TableProps.ColumnDefinition<EntityRow>[] = [
    {
      id: 'name',
      header: title,
      isRowHeader: true,
      cell: (entity) => (
        <Link
          href={`${serviceConsolePath('iam')}/${segment}/${encodeURIComponent(entity.name)}`}
          onFollow={(event) => {
            event.preventDefault();
            navigate(`${serviceConsolePath('iam')}/${segment}/${encodeURIComponent(entity.name)}`);
          }}
        >
          {entity.name}
        </Link>
      ),
    },
  ];

  return (
    <Table<EntityRow>
      variant="embedded"
      loading={loading}
      loadingText={`Loading ${title.toLowerCase()}`}
      items={[...items]}
      columnDefinitions={columns}
      trackBy={(entity) => entity.name}
      ariaLabels={{ tableLabel: title }}
      empty={
        <Box textAlign="center" color="text-body-secondary">
          No {title.toLowerCase()} are attached to this policy.
        </Box>
      }
    />
  );
}

/**
 * One IAM policy: the policy document (read-only for AWS managed policies,
 * editable as a new version for customer managed ones) and every entity the
 * policy is attached to. Editing follows IAM semantics: `CreatePolicyVersion`
 * with `SetAsDefault`, never an in-place update.
 */
export function PolicyDetailPage({ descriptor }: ServicePageProps): ReactElement {
  const { policyArn = '' } = useParams();
  const navigate = useNavigate();
  const flashbar = useFlashbar();

  const [policy, setPolicy] = useState<IamPolicy | null>(null);
  const [document, setDocument] = useState('');
  const [savedDocument, setSavedDocument] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const [entities, setEntities] = useState<IamPolicyEntities | null>(null);
  const [entitiesError, setEntitiesError] = useState<ApiError | null>(null);
  const [entitiesLoading, setEntitiesLoading] = useState(true);

  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const requestId = useRef(0);

  const isAwsManaged = policyArn.startsWith('arn:aws:iam::aws:policy/');

  const load = useCallback(async (): Promise<void> => {
    const id = requestId.current + 1;
    requestId.current = id;
    setLoading(true);
    try {
      const result = await getPolicy(policyArn);
      const text = await getPolicyDocument({
        policyArn,
        ...(result.defaultVersionId === undefined ? {} : { versionId: result.defaultVersionId }),
      });
      if (requestId.current !== id) return;
      setPolicy(result);
      setDocument(text);
      setSavedDocument(text);
      setError(null);
    } catch (caught) {
      if (requestId.current !== id) return;
      setPolicy(null);
      setError(
        isIamCode(caught, 'NoSuchEntity')
          ? {
              code: 'NoSuchEntity',
              statusCode: 404,
              message: `The policy "${policyArn}" does not exist in this LocalStack account.`,
            }
          : toApiError(caught),
      );
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [policyArn]);

  const loadEntities = useCallback(async (): Promise<void> => {
    setEntitiesLoading(true);
    try {
      const result = await listEntitiesForPolicy(policyArn);
      setEntities(result);
      setEntitiesError(null);
    } catch (caught) {
      setEntitiesError(toApiError(caught));
    } finally {
      setEntitiesLoading(false);
    }
  }, [policyArn]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- policy lookup for the route
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- attached entities fetch
    void loadEntities();
  }, [loadEntities]);

  const validation = validateIdentityPolicy(document);
  const changed = document !== savedDocument;

  const savePolicy = async (): Promise<void> => {
    setSaving(true);
    setSaveError(null);
    try {
      await createPolicyVersion({ policyArn, policyDocument: document });
      setSavedDocument(document);
      setEditing(false);
      flashbar.notify({
        type: 'success',
        header: 'Policy updated',
        content: 'LocalStack created a new default version of the policy.',
      });
      await load();
    } catch (caught) {
      setSaveError(toFriendlyIamError(caught, 'policyDocument').message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deletePolicy(policyArn);
      flashbar.notify({
        type: 'success',
        header: 'Policy deleted',
        content: policy?.policyName ?? policyArn,
      });
      setDeleteVisible(false);
      navigate(`${serviceConsolePath(descriptor.id)}/policies`);
    } catch (caught) {
      setDeleteError(toFriendlyIamError(caught).message);
    } finally {
      setDeleting(false);
    }
  };

  const documentTab = (
    <Container
      header={
        <Header
          variant="h2"
          description={
            isAwsManaged
              ? 'AWS managed policies are maintained by AWS and cannot be edited here.'
              : 'Saving creates a new policy version and makes it the default, the way IAM updates a policy.'
          }
          actions={
            isAwsManaged ? undefined : editing ? (
              <SpaceBetween direction="horizontal" size="xs">
                <Button
                  variant="link"
                  disabled={saving}
                  onClick={() => {
                    setDocument(savedDocument);
                    setEditing(false);
                    setSaveError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  loading={saving}
                  disabled={!changed || !validation.valid}
                  onClick={() => {
                    void savePolicy();
                  }}
                >
                  Save new version
                </Button>
              </SpaceBetween>
            ) : (
              <Button
                onClick={() => {
                  setEditing(true);
                }}
              >
                Edit policy
              </Button>
            )
          }
        >
          Policy document
        </Header>
      }
    >
      <SpaceBetween size="m">
        {saveError === null ? null : <Alert type="error">{saveError}</Alert>}

        {policy !== null ? (
          <Box variant="small" color="text-body-secondary">
            Default version: <Box variant="code">{policy.defaultVersionId ?? 'unknown'}</Box>
            {' · '}
            Last updated: {formatDateTime(policy.updateDate)}
          </Box>
        ) : null}

        <JsonEditor
          value={document}
          {...(editing && !isAwsManaged ? { onChange: setDocument } : {})}
          readOnly={!editing || isAwsManaged}
          label="Policy document"
          ariaLabel="Policy document JSON"
          rows={20}
          errorText={
            editing && validation.jsonError === null && validation.structureErrors.length > 0
              ? validation.structureErrors.join(' ')
              : undefined
          }
        />

        {editing && validation.valid ? (
          <Box>
            <StatusIndicator type="success">Valid IAM policy structure</StatusIndicator>
          </Box>
        ) : null}
      </SpaceBetween>
    </Container>
  );

  const entitiesTab = (
    <Container
      header={
        <Header
          variant="h2"
          description="Users, groups and roles this policy is attached to."
          actions={
            <Button
              iconName="refresh"
              ariaLabel="Refresh attached entities"
              loading={entitiesLoading}
              onClick={() => {
                void loadEntities();
              }}
            />
          }
        >
          Attached entities
        </Header>
      }
    >
      <SpaceBetween size="l">
        {entitiesError === null ? null : (
          <Alert
            type="error"
            header="Could not load the attached entities"
            action={
              <Button
                onClick={() => {
                  void loadEntities();
                }}
              >
                Retry
              </Button>
            }
          >
            {entitiesError.message}
          </Alert>
        )}

        {entitiesLoading && entities === null ? (
          <Box textAlign="center" padding="l">
            <Spinner size="large" />
          </Box>
        ) : (
          <>
            <EntityTable
              title="Users"
              segment="users"
              items={entities?.users ?? []}
              loading={entitiesLoading}
            />
            <EntityTable
              title="Groups"
              segment="groups"
              items={entities?.groups ?? []}
              loading={entitiesLoading}
            />
            <EntityTable
              title="Roles"
              segment="roles"
              items={entities?.roles ?? []}
              loading={entitiesLoading}
            />
          </>
        )}
      </SpaceBetween>
    </Container>
  );

  return (
    <>
      <ResourceDetailPage
        title={policy?.policyName ?? policyArn}
        description={<Box variant="code">{policyArn}</Box>}
        breadcrumbs={[
          { text: descriptor.displayName, href: serviceConsolePath(descriptor.id) },
          { text: 'Policies', href: `${serviceConsolePath(descriptor.id)}/policies` },
          { text: policy?.policyName ?? policyArn },
        ]}
        loading={loading}
        error={error}
        onRetry={() => {
          void load();
        }}
        headerActions={
          <ButtonDropdown
            ariaLabel="Policy actions"
            items={[
              { id: 'copy-arn', text: 'Copy ARN' },
              { id: 'delete', text: 'Delete policy', disabled: isAwsManaged },
            ]}
            onItemClick={({ detail }) => {
              if (detail.id === 'copy-arn') {
                void navigator.clipboard?.writeText(policyArn);
              }
              if (detail.id === 'delete' && !isAwsManaged) {
                setDeleteError(null);
                setDeleteVisible(true);
              }
            }}
          >
            Policy actions
          </ButtonDropdown>
        }
        tabs={[
          { id: 'permissions', label: 'Permissions', content: documentTab },
          { id: 'attached-entities', label: 'Attached entities', content: entitiesTab },
        ]}
      />

      {deleteVisible ? (
        <DeleteConfirmModal
          visible
          title="Delete policy"
          subjects={[policy?.policyName ?? policyArn]}
          description="The policy is removed permanently from every entity it is attached to. This action cannot be undone."
          submitLabel="Delete policy"
          loading={deleting}
          {...(deleteError === null ? {} : { errorText: deleteError })}
          onDismiss={() => {
            if (deleting) return;
            setDeleteVisible(false);
            setDeleteError(null);
          }}
          onConfirm={() => {
            void confirmDelete();
          }}
        />
      ) : null}
    </>
  );
}

export default PolicyDetailPage;
