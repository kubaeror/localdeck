import type { TableProps } from '@cloudscape-design/components/table';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import Link from '@cloudscape-design/components/link';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { DeleteConfirmModal } from '../../../components/DeleteConfirmModal';
import { ResourceListPage } from '../../../components/ResourceListPage';
import { formatDateTime } from '../../../lib/format';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import { deleteUser, listUsers, type IamUser } from '../api';
import { useBulkDelete } from '../components/useBulkDelete';

/**
 * The IAM users list: user name, ARN and creation date, with per-row and bulk
 * deletion. Deleting a user fails while access keys or group memberships
 * remain; the failure message names what to remove first.
 */
export function UsersListPage({ descriptor }: ServicePageProps): ReactElement {
  const navigate = useNavigate();
  const [filteringText, setFilteringText] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  const bulkDelete = useBulkDelete<IamUser>({
    noun: 'user',
    label: (user) => user.userName,
    remove: (user) => deleteUser(user.userName),
    onCompleted: () => {
      setReloadToken((token) => token + 1);
    },
  });

  const userPath = useCallback(
    (userName: string): string =>
      `${serviceConsolePath(descriptor.id)}/users/${encodeURIComponent(userName)}`,
    [descriptor.id],
  );

  const openUser = useCallback(
    (userName: string) => {
      void navigate(userPath(userName));
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
        cell: (user) =>
          user.arn === undefined ? (
            <Box color="text-body-secondary">Not reported</Box>
          ) : (
            <Box variant="code">{user.arn}</Box>
          ),
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
            (user.arn ?? '').toLowerCase().includes(text.trim().toLowerCase()),
        }}
        headerActions={
          <Button
            variant="primary"
            onClick={() => {
              void navigate(`${serviceConsolePath(descriptor.id)}/users/create`);
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
              if (detail.id === 'copy-arn' && user.arn !== undefined) {
                void navigator.clipboard?.writeText(user.arn);
              }
              if (detail.id === 'delete') {
                bulkDelete.requestDelete([user]);
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
                bulkDelete.requestDelete(selected);
              }
            }}
          >
            Actions
          </ButtonDropdown>
        )}
        emptyTitle="No users"
        emptyDescription="Users are identities with long-term credentials. Create a user to give an application or person access to this account."
      />

      {bulkDelete.targets === null ? null : (
        <DeleteConfirmModal
          visible
          title={bulkDelete.targets.length === 1 ? 'Delete user' : 'Delete users'}
          subjects={bulkDelete.targets.map((user) => user.userName)}
          description="Deleting a user removes its permissions permanently. Access keys and group memberships must be removed first, and this action cannot be undone."
          confirmationText={bulkDelete.targets.length === 1 ? undefined : 'delete'}
          submitLabel={bulkDelete.targets.length === 1 ? 'Delete user' : 'Delete users'}
          loading={bulkDelete.deleting}
          {...(bulkDelete.failures.length === 0
            ? {}
            : { errorText: bulkDelete.failures.join(' ') })}
          onDismiss={() => {
            if (bulkDelete.deleting) return;
            bulkDelete.dismiss();
          }}
          onConfirm={() => {
            void bulkDelete.confirm();
          }}
        />
      )}
    </>
  );
}

export default UsersListPage;
