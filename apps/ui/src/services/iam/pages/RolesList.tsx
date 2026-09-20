import type { TableProps } from '@cloudscape-design/components/table';
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
import { deleteRole, listRoles, type IamRole } from '../api';
import { useBulkDelete } from '../components/useBulkDelete';
import { summarizeTrustedEntities } from '../policy';

/**
 * The IAM roles list: role name, the entities that can assume it (derived from
 * each role's trust policy) and creation date. Deleting a role fails while
 * policies remain attached; the failure message explains what to detach.
 */
export function RolesListPage({ descriptor }: ServicePageProps): ReactElement {
  const navigate = useNavigate();
  const [filteringText, setFilteringText] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  const bulkDelete = useBulkDelete<IamRole>({
    noun: 'role',
    label: (role) => role.roleName,
    remove: (role) => deleteRole(role.roleName),
    onCompleted: () => {
      setReloadToken((token) => token + 1);
    },
  });

  const rolePath = useCallback(
    (roleName: string): string =>
      `${serviceConsolePath(descriptor.id)}/roles/${encodeURIComponent(roleName)}`,
    [descriptor.id],
  );

  const openRole = useCallback(
    (roleName: string) => {
      void navigate(rolePath(roleName));
    },
    [navigate, rolePath],
  );

  const columns = useMemo<readonly TableProps.ColumnDefinition<IamRole>[]>(
    () => [
      {
        id: 'roleName',
        header: 'Role name',
        sortingField: 'roleName',
        isRowHeader: true,
        cell: (role) => (
          <Link
            href={rolePath(role.roleName)}
            onFollow={(event) => {
              event.preventDefault();
              openRole(role.roleName);
            }}
          >
            {role.roleName}
          </Link>
        ),
      },
      {
        id: 'trustedEntities',
        header: 'Trusted entities',
        cell: (role) => summarizeTrustedEntities(role.assumeRolePolicyDocument),
      },
      {
        id: 'createDate',
        header: 'Creation date',
        sortingField: 'createDate',
        cell: (role) => formatDateTime(role.createDate),
      },
    ],
    [openRole, rolePath],
  );

  return (
    <>
      <ResourceListPage<IamRole>
        title="Roles"
        description={descriptor.summary}
        breadcrumbs={[
          { text: descriptor.displayName, href: serviceConsolePath(descriptor.id) },
          { text: 'Roles' },
        ]}
        columns={columns}
        getRowId={(role) => role.roleName}
        reloadToken={reloadToken}
        fetcher={({ nextToken, signal }) =>
          listRoles({
            ...(nextToken === undefined ? {} : { nextToken }),
            ...(signal === undefined ? {} : { signal }),
          })
        }
        filtering={{
          text: filteringText,
          onChange: setFilteringText,
          placeholder: 'Find roles by name',
          match: (role, text) => role.roleName.toLowerCase().includes(text.trim().toLowerCase()),
        }}
        headerActions={
          <Button
            variant="primary"
            onClick={() => {
              void navigate(`${serviceConsolePath(descriptor.id)}/roles/create`);
            }}
          >
            Create role
          </Button>
        }
        rowActions={(role) => (
          <ButtonDropdown
            variant="icon"
            ariaLabel={`Actions for ${role.roleName}`}
            items={[
              { id: 'view', text: 'View details' },
              { id: 'copy-arn', text: 'Copy ARN' },
              { id: 'delete', text: 'Delete' },
            ]}
            onItemClick={({ detail }) => {
              if (detail.id === 'view') openRole(role.roleName);
              if (detail.id === 'copy-arn' && role.arn !== undefined) {
                void navigator.clipboard?.writeText(role.arn);
              }
              if (detail.id === 'delete') {
                bulkDelete.requestDelete([role]);
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
        emptyTitle="No roles"
        emptyDescription="Roles are identities that trusted entities assume. Create a role to grant temporary access to a service or account."
      />

      {bulkDelete.targets === null ? null : (
        <DeleteConfirmModal
          visible
          title={bulkDelete.targets.length === 1 ? 'Delete role' : 'Delete roles'}
          subjects={bulkDelete.targets.map((role) => role.roleName)}
          description="Deleting a role removes its permissions permanently. Every attached policy must be detached first, and this action cannot be undone."
          confirmationText={bulkDelete.targets.length === 1 ? undefined : 'delete'}
          submitLabel={bulkDelete.targets.length === 1 ? 'Delete role' : 'Delete roles'}
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

export default RolesListPage;
