import type { TableProps } from '@cloudscape-design/components/table';
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
import { deleteGroup, getGroup, listGroups, type IamGroup } from '../api';
import { toFriendlyIamError } from '../errors';

/** A group row plus the member count the table shows. */
interface GroupRow extends IamGroup {
  userCount?: number;
}

/**
 * The IAM user groups list: group name, member count and creation date.
 *
 * IAM's `ListGroups` does not include member counts, so each page is enriched
 * with one `GetGroup` call per group (LocalStack accounts hold few groups). A
 * group whose member list cannot be read shows "—" instead of failing the page.
 */
export function GroupsListPage({ descriptor }: ServicePageProps): ReactElement {
  const navigate = useNavigate();
  const flashbar = useFlashbar();
  const [filteringText, setFilteringText] = useState('');
  const [deleteTargets, setDeleteTargets] = useState<readonly GroupRow[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const groupPath = useCallback(
    (groupName: string): string =>
      `${serviceConsolePath(descriptor.id)}/groups/${encodeURIComponent(groupName)}`,
    [descriptor.id],
  );

  const openGroup = useCallback(
    (groupName: string) => {
      navigate(groupPath(groupName));
    },
    [navigate, groupPath],
  );

  const columns = useMemo<readonly TableProps.ColumnDefinition<GroupRow>[]>(
    () => [
      {
        id: 'groupName',
        header: 'Group name',
        sortingField: 'groupName',
        isRowHeader: true,
        cell: (group) => (
          <Link
            href={groupPath(group.groupName)}
            onFollow={(event) => {
              event.preventDefault();
              openGroup(group.groupName);
            }}
          >
            {group.groupName}
          </Link>
        ),
      },
      {
        id: 'userCount',
        header: 'Users',
        sortingField: 'userCount',
        cell: (group) => (group.userCount === undefined ? '—' : group.userCount),
      },
      {
        id: 'createDate',
        header: 'Creation date',
        sortingField: 'createDate',
        cell: (group) => formatDateTime(group.createDate),
      },
    ],
    [groupPath, openGroup],
  );

  const confirmDelete = async (): Promise<void> => {
    const targets = deleteTargets ?? [];
    if (targets.length === 0) return;

    setDeleting(true);
    setDeleteError(null);
    for (const group of targets) {
      try {
        await deleteGroup(group.groupName);
        flashbar.notify({ type: 'success', header: 'Group deleted', content: group.groupName });
      } catch (caught) {
        flashbar.notify({
          type: 'error',
          header: `Could not delete ${group.groupName}`,
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
      <ResourceListPage<GroupRow>
        title="User groups"
        description={descriptor.summary}
        breadcrumbs={[
          { text: descriptor.displayName, href: serviceConsolePath(descriptor.id) },
          { text: 'User groups' },
        ]}
        columns={columns}
        getRowId={(group) => group.groupName}
        reloadToken={reloadToken}
        fetcher={async ({ nextToken, signal }) => {
          const page = await listGroups({
            ...(nextToken === undefined ? {} : { nextToken }),
            ...(signal === undefined ? {} : { signal }),
          });
          const enriched = await Promise.all(
            page.items.map(async (group): Promise<GroupRow> => {
              try {
                const detail = await getGroup(group.groupName);
                return { ...group, userCount: detail.users.length };
              } catch {
                return { ...group };
              }
            }),
          );
          return {
            items: enriched,
            ...(page.nextToken === undefined ? {} : { nextToken: page.nextToken }),
          };
        }}
        filtering={{
          text: filteringText,
          onChange: setFilteringText,
          placeholder: 'Find user groups by name',
          match: (group, text) => group.groupName.toLowerCase().includes(text.trim().toLowerCase()),
        }}
        headerActions={
          <Button
            variant="primary"
            onClick={() => {
              navigate(`${serviceConsolePath(descriptor.id)}/groups/create`);
            }}
          >
            Create group
          </Button>
        }
        rowActions={(group) => (
          <ButtonDropdown
            variant="icon"
            ariaLabel={`Actions for ${group.groupName}`}
            items={[
              { id: 'view', text: 'View details' },
              { id: 'copy-arn', text: 'Copy ARN' },
              { id: 'delete', text: 'Delete' },
            ]}
            onItemClick={({ detail }) => {
              if (detail.id === 'view') openGroup(group.groupName);
              if (detail.id === 'copy-arn') {
                void navigator.clipboard?.writeText(group.arn);
              }
              if (detail.id === 'delete') {
                setDeleteError(null);
                setDeleteTargets([group]);
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
        emptyTitle="No user groups"
        emptyDescription="Groups are collections of users that share permissions. Attach a policy to a group once instead of to every user."
      />

      {deleteTargets === null ? null : (
        <DeleteConfirmModal
          visible
          title={deleteTargets.length === 1 ? 'Delete group' : 'Delete groups'}
          subjects={deleteTargets.map((group) => group.groupName)}
          description="Deleting a group removes its attached policies permanently. Every member must be removed from the group first, and this action cannot be undone."
          confirmationText={deleteTargets.length === 1 ? undefined : 'delete'}
          submitLabel={deleteTargets.length === 1 ? 'Delete group' : 'Delete groups'}
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

export default GroupsListPage;
