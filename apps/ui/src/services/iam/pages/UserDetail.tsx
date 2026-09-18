import type { ApiError } from '@localdeck/shared';
import Box from '@cloudscape-design/components/box';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DeleteConfirmModal } from '../../../components/DeleteConfirmModal';
import { ResourceDetailPage } from '../../../components/ResourceDetailPage';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { toApiError } from '../../../lib/apiClient';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import { deleteUser, getUser, type IamUser } from '../api';
import { AccessKeysPanel } from '../components/AccessKeysPanel';
import { AttachedPoliciesPanel } from '../components/AttachedPoliciesPanel';
import { TagsTab } from '../components/TagsTab';
import { UserGroupsTab } from '../components/UserGroupsTab';
import { isIamCode, toFriendlyIamError } from '../errors';

/**
 * One IAM user: Permissions, Groups, Security credentials and Tags, composed
 * from the module's shared panels. The page resolves the user with `GetUser`,
 * so a user deleted outside LocalDeck produces a clean 404 instead of broken
 * tabs.
 */
export function UserDetailPage({ descriptor }: ServicePageProps): ReactElement {
  const { userName = '' } = useParams();
  const navigate = useNavigate();
  const flashbar = useFlashbar();

  const [user, setUser] = useState<IamUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const id = requestId.current + 1;
    requestId.current = id;
    setLoading(true);
    try {
      const result = await getUser(userName);
      if (requestId.current !== id) return;
      setUser(result);
      setError(null);
    } catch (caught) {
      if (requestId.current !== id) return;
      setUser(null);
      setError(
        isIamCode(caught, 'NoSuchEntity')
          ? {
              code: 'NoSuchEntity',
              statusCode: 404,
              message: `The user "${userName}" does not exist in this LocalStack account.`,
            }
          : toApiError(caught),
      );
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [userName]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- user lookup for the route
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  const confirmDelete = async (): Promise<void> => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteUser(userName);
      flashbar.notify({ type: 'success', header: 'User deleted', content: userName });
      setDeleteVisible(false);
      navigate(`${serviceConsolePath(descriptor.id)}/users`);
    } catch (caught) {
      setDeleteError(toFriendlyIamError(caught).message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <ResourceDetailPage
        title={userName}
        description={user === null ? undefined : <Box variant="code">{user.arn}</Box>}
        breadcrumbs={[
          { text: descriptor.displayName, href: serviceConsolePath(descriptor.id) },
          { text: 'Users', href: `${serviceConsolePath(descriptor.id)}/users` },
          { text: userName },
        ]}
        loading={loading}
        error={error}
        onRetry={() => {
          void load();
        }}
        headerActions={
          <ButtonDropdown
            ariaLabel="User actions"
            items={[
              { id: 'copy-arn', text: 'Copy ARN' },
              { id: 'delete', text: 'Delete user' },
            ]}
            onItemClick={({ detail }) => {
              if (detail.id === 'copy-arn' && user !== null) {
                void navigator.clipboard?.writeText(user.arn);
              }
              if (detail.id === 'delete') {
                setDeleteError(null);
                setDeleteVisible(true);
              }
            }}
          >
            User actions
          </ButtonDropdown>
        }
        tabs={[
          {
            id: 'permissions',
            label: 'Permissions',
            content: <AttachedPoliciesPanel entity="user" name={userName} />,
          },
          {
            id: 'groups',
            label: 'Groups',
            content: <UserGroupsTab userName={userName} />,
          },
          {
            id: 'security-credentials',
            label: 'Security credentials',
            content: <AccessKeysPanel userName={userName} />,
          },
          {
            id: 'tags',
            label: 'Tags',
            content: <TagsTab entity="user" name={userName} />,
          },
        ]}
      />

      {deleteVisible ? (
        <DeleteConfirmModal
          visible
          title="Delete user"
          subjects={[userName]}
          description="Access keys and group memberships must be removed before the user can be deleted. This action cannot be undone."
          submitLabel="Delete user"
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

export default UserDetailPage;
