import type { ApiError } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table from '@cloudscape-design/components/table';
import type { TableProps } from '@cloudscape-design/components/table';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { DeleteConfirmModal } from '../../../components/DeleteConfirmModal';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { toApiError } from '../../../lib/apiClient';
import { formatDateTime } from '../../../lib/format';
import {
  createAccessKey,
  deleteAccessKey,
  listAccessKeys,
  updateAccessKey,
  type CreatedAccessKey,
  type IamAccessKey,
} from '../api';
import { toFriendlyIamError } from '../errors';
import { AccessKeySecret } from './AccessKeySecret';

export interface AccessKeysPanelProps {
  userName: string;
}

function statusIndicator(status: string): ReactElement {
  return status === 'Active' ? (
    <StatusIndicator type="success">Active</StatusIndicator>
  ) : (
    <StatusIndicator type="stopped">Inactive</StatusIndicator>
  );
}

interface CreateAccessKeyModalProps {
  userName: string;
  hasActiveKey: boolean;
  onDismiss: () => void;
  /** Called after a key was created, so the table can refresh. */
  onCreated: () => void;
}

/**
 * The console's "Create access key" flow: confirm the warning, create the key
 * and show both halves exactly once. The secret access key cannot be retrieved
 * again, so the modal never closes itself before the user has seen it.
 */
function CreateAccessKeyModal({
  userName,
  hasActiveKey,
  onDismiss,
  onCreated,
}: CreateAccessKeyModalProps): ReactElement {
  const flashbar = useFlashbar();
  const [created, setCreated] = useState<CreatedAccessKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const key = await createAccessKey(userName);
      setCreated(key);
      onCreated();
      flashbar.notify({
        type: 'success',
        header: 'Access key created',
        content: `Access key ${key.accessKeyId} is active for ${userName}.`,
      });
    } catch (caught) {
      setError(toFriendlyIamError(caught, null).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible
      onDismiss={() => {
        if (!submitting) onDismiss();
      }}
      header="Create access key"
      size="medium"
      closeAriaLabel="Close create access key"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            {created === null ? (
              <>
                <Button variant="link" disabled={submitting} onClick={onDismiss}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  loading={submitting}
                  onClick={() => {
                    void create();
                  }}
                >
                  Create access key
                </Button>
              </>
            ) : (
              <Button variant="primary" onClick={onDismiss}>
                Done
              </Button>
            )}
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {error === null ? null : <Alert type="error">{error}</Alert>}

        {created === null ? (
          <>
            <Alert type="warning" header="The secret access key is shown only once">
              Store the secret access key immediately after you create it; you cannot retrieve it
              again.
            </Alert>
            {hasActiveKey ? (
              <Alert type="info">
                This user already has an active access key. IAM allows at most two keys per user.
              </Alert>
            ) : null}
          </>
        ) : (
          <>
            <Alert type="success" header="Access key created">
              This is the only time the secret access key is shown. Copy it now, or download the
              .csv file; IAM cannot return it again.
            </Alert>
            <AccessKeySecret accessKey={created} />
          </>
        )}
      </SpaceBetween>
    </Modal>
  );
}

/**
 * The user detail "Security credentials" tab: the access key list with create,
 * activate/deactivate and delete. Creation opens the console's key ceremony
 * because the secret is returned exactly once.
 */
export function AccessKeysPanel({ userName }: AccessKeysPanelProps): ReactElement {
  const flashbar = useFlashbar();
  const [keys, setKeys] = useState<readonly IamAccessKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [createVisible, setCreateVisible] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<IamAccessKey | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const id = requestId.current + 1;
    requestId.current = id;
    setLoading(true);
    try {
      const result = await listAccessKeys(userName);
      if (requestId.current !== id) return;
      setKeys(result);
      setError(null);
    } catch (caught) {
      if (requestId.current !== id) return;
      setError(toApiError(caught));
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [userName]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- access key list fetch
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  const setActive = async (key: IamAccessKey, active: boolean): Promise<void> => {
    setUpdatingId(key.accessKeyId);
    try {
      await updateAccessKey({ userName, accessKeyId: key.accessKeyId, active });
      flashbar.notify({
        type: 'success',
        header: active ? 'Access key activated' : 'Access key deactivated',
        content: key.accessKeyId,
      });
      await load();
    } catch (caught) {
      flashbar.notify({
        type: 'error',
        header: `Could not ${active ? 'activate' : 'deactivate'} ${key.accessKeyId}`,
        content: toFriendlyIamError(caught).message,
      });
    } finally {
      setUpdatingId(null);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (deleteTarget === null) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccessKey({ userName, accessKeyId: deleteTarget.accessKeyId });
      flashbar.notify({
        type: 'success',
        header: 'Access key deleted',
        content: deleteTarget.accessKeyId,
      });
      setDeleteTarget(null);
      await load();
    } catch (caught) {
      setDeleteError(toFriendlyIamError(caught).message);
    } finally {
      setDeleting(false);
    }
  };

  const columns: readonly TableProps.ColumnDefinition<IamAccessKey>[] = [
    {
      id: 'accessKeyId',
      header: 'Access key ID',
      isRowHeader: true,
      cell: (key) => <Box variant="code">{key.accessKeyId}</Box>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (key) => statusIndicator(key.status),
    },
    {
      id: 'createDate',
      header: 'Created',
      cell: (key) => formatDateTime(key.createDate),
    },
    {
      id: 'actions',
      header: 'Actions',
      minWidth: '170px',
      cell: (key) => (
        <SpaceBetween direction="horizontal" size="xs">
          <Button
            variant="inline-link"
            loading={updatingId === key.accessKeyId}
            disabled={updatingId !== null && updatingId !== key.accessKeyId}
            onClick={() => {
              void setActive(key, key.status !== 'Active');
            }}
          >
            {key.status === 'Active' ? 'Deactivate' : 'Activate'}
          </Button>
          <Button
            variant="inline-link"
            onClick={() => {
              setDeleteError(null);
              setDeleteTarget(key);
            }}
          >
            Delete
          </Button>
        </SpaceBetween>
      ),
    },
  ];

  return (
    <>
      <Container
        header={
          <Header
            variant="h2"
            description="Access keys let an application call AWS APIs as this user. A user can have at most two keys."
            actions={
              <Button
                disabled={keys.length >= 2}
                onClick={() => {
                  setCreateVisible(true);
                }}
              >
                Create access key
              </Button>
            }
          >
            Security credentials
          </Header>
        }
      >
        <SpaceBetween size="s">
          {keys.length >= 2 ? (
            <Alert type="info">
              This user already has the maximum of two access keys. Delete one to create another.
            </Alert>
          ) : null}

          {error === null ? null : (
            <Alert
              type="error"
              header="Could not load the access keys"
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
              {error.message}
            </Alert>
          )}

          <Table<IamAccessKey>
            variant="embedded"
            loading={loading}
            loadingText="Loading access keys"
            items={[...keys]}
            columnDefinitions={columns}
            trackBy={(key) => key.accessKeyId}
            ariaLabels={{ tableLabel: 'Access keys' }}
            empty={
              <Box textAlign="center" color="text-body-secondary">
                This user has no access keys. Create one to let an application sign requests as this
                user.
              </Box>
            }
          />
        </SpaceBetween>
      </Container>

      {createVisible ? (
        <CreateAccessKeyModal
          userName={userName}
          hasActiveKey={keys.some((key) => key.status === 'Active')}
          onDismiss={() => {
            setCreateVisible(false);
          }}
          onCreated={() => {
            void load();
          }}
        />
      ) : null}

      {deleteTarget === null ? null : (
        <DeleteConfirmModal
          visible
          title="Delete access key"
          subjects={[deleteTarget.accessKeyId]}
          description="Applications using this access key lose access immediately. This action cannot be undone."
          submitLabel="Delete access key"
          loading={deleting}
          {...(deleteError === null ? {} : { errorText: deleteError })}
          onDismiss={() => {
            if (deleting) return;
            setDeleteTarget(null);
          }}
          onConfirm={() => {
            void confirmDelete();
          }}
        />
      )}
    </>
  );
}

export default AccessKeysPanel;
