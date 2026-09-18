import type { TableProps } from '@cloudscape-design/components/table';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import Link from '@cloudscape-design/components/link';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { DeleteConfirmModal } from '../../../components/DeleteConfirmModal';
import { ResourceListPage } from '../../../components/ResourceListPage';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { formatDateTime } from '../../../lib/format';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import { deleteUser, listUsers, type IamUser } from '../api';
import { toFriendlyIamError } from '../errors';

/**
 * The IAM users list: user name, ARN and creation date, with per-row and bulk
 * deletion. Deleting a user fails while access keys or group memberships
 * remain; the failure message names what to remove first.
 */
export function UsersListPage({ descriptor }: ServicePageProps): ReactElement {
  const navigate = useNavigate();
  const flashbar = useFlashbar();
  const [filteringText, setFilteringText] = useState('');
  const [deleteTargets, setDeleteTargets] = useState<readonly IamUser[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const userPath = useCallback(
    (userName: string): string =>
      `${serviceConsolePath(descriptor.id)}/users/${encodeURIComponent(userName)}`,
    [descriptor.id],
  );

  const openUser = useCallback(
    (userName: string) => {
      navigate(userPath(userName));
    },
    [navigate, userPath],
  );

  const columns = useMemo<readonly TableProps.ColumnDefinition<IamUser>[]>(
    () => [
      {
        id: 'userName',
        header: 'User name',
        sortingField: 'userName',
        isRowHeader: true,
        cell: (user) => (
          <Link
            href={userPath(user.userName)}
            onFollow={(event) => {
              event.preventDefault();
              openUser(user.userName);
            }}
          >
            {user.userName}
          </Link>
        ),
      },
      {
        id: 'arn',
        header: 'User ARN',
        cell: (user) => <Box variant="code">{user.arn}</Box>,
      },
      {
        id: 'createDate',
        header: 'Creation date',
        sortingField: 'createDate',
        cell: (user) => formatDateTime(user.createDate),
      },
    ],
    [openUser, userPath],
  );

  const confirmDelete = async (): Promise<void> => {
    const targets = deleteTargets ?? [];
    if (targets.length === 0) return;

    setDeleting(true);
    setDeleteError(null);
    for (const user of targets) {
      try {
        await deleteUser(user.userName);
        flashbar.notify({ type: 'success', header: 'User deleted', content: user.userName });
      } catch (caught) {
        flashbar.notify({
          type: 'error',
          header: `Could not delete ${user.userName}`,
          content: toFriendlyIamError(caught).message,
        });
      }
    }
    setDeleting(false);
    setDeleteTargets(null);
    setReloadToken((token) => token + 1);
  };

  return (
    <>
      <ResourceListPage<IamUser>
        title="Users"
        description={descriptor.summary}
        breadcrumbs={[
          { text: descriptor.displayName, href: serviceConsolePath(descriptor.id) },
          { text: 'Users' },
        ]}
        columns={columns}
        getRowId={(user) => user.userName}
        reloadToken={reloadToken}
        fetcher={({ nextToken, signal }) =>
          listUsers({
            ...(nextToken === undefined ? {} : { nextToken }),
            ...(signal === undefined ? {} : { signal }),
          })
        }
        filtering={{
          text: filteringText,
          onChange: setFilteringText,
          placeholder: 'Find users by name',
          match: (user, text) =>
            user.userName.toLowerCase().includes(text.trim().toLowerCase()) ||
            user.arn.toLowerCase().includes(text.trim().toLowerCase()),
        }}
        headerActions={
          <Button
            variant="primary"
            onClick={() => {
              navigate(`${serviceConsolePath(descriptor.id)}/users/create`);
            }}
          >
            Create user
          </Button>
        }
        rowActions={(user) => (
          <ButtonDropdown
            variant="icon"
            ariaLabel={`Actions for ${user.userName}`}
            items={[
              { id: 'view', text: 'View details' },
              { id: 'copy-arn', text: 'Copy ARN' },
              { id: 'delete', text: 'Delete' },
            ]}
            onItemClick={({ detail }) => {
              if (detail.id === 'view') openUser(user.userName);
              if (detail.id === 'copy-arn') {
                void navigator.clipboard?.writeText(user.arn);
              }
              if (detail.id === 'delete') {
                setDeleteError(null);
                setDeleteTargets([user]);
              }
            }}
          />
        )}
        bulkActions={(selected) => (
          <ButtonDropdown
            ariaLabel="Bulk actions"
            items={[{ id: 'delete', text: 'Delete' }]}
            onItemClick={({ detail }) => {
              if (detail.id === 'delete') {
                setDeleteError(null);
                setDeleteTargets(selected);
              }
            }}
          >
            Actions
          </ButtonDropdown>
        )}
        emptyTitle="No users"
        emptyDescription="Users are identities with long-term credentials. Create a user to give an application or person access to this account."
      />

      {deleteTargets === null ? null : (
        <DeleteConfirmModal
          visible
          title={deleteTargets.length === 1 ? 'Delete user' : 'Delete users'}
          subjects={deleteTargets.map((user) => user.userName)}
          description="Deleting a user removes its permissions permanently. Access keys and group memberships must be removed first, and this action cannot be undone."
          confirmationText={deleteTargets.length === 1 ? undefined : 'delete'}
          submitLabel={deleteTargets.length === 1 ? 'Delete user' : 'Delete users'}
          loading={deleting}
          {...(deleteError === null ? {} : { errorText: deleteError })}
          onDismiss={() => {
            if (deleting) return;
            setDeleteTargets(null);
            setDeleteError(null);
          }}
          onConfirm={() => {
            void confirmDelete();
          }}
        />
      )}
    </>
  );
}

export default UsersListPage;
