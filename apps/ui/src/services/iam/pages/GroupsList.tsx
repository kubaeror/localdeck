import type { ApiError } from '@localdeck/shared';
import type { TableProps } from '@cloudscape-design/components/table';
import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import Link from '@cloudscape-design/components/link';
import { useCallback, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { DeleteConfirmModal } from '../../../components/DeleteConfirmModal';
import { ResourceListPage } from '../../../components/ResourceListPage';
import { formatDateTime } from '../../../lib/format';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import { deleteGroup, getGroup, listGroups, type IamGroup } from '../api';
import { toApiError } from '../../../lib/apiClient';
import { useBulkDelete } from '../components/useBulkDelete';

/** A group row plus the member count the table shows. */
interface GroupRow extends IamGroup {
  userCount?: number;
}

/**
 * The IAM user groups list: group name, member count and creation date.
 *
 * IAM's `ListGroups` does not include member counts, so each page is enriched
 * with one `GetGroup` call per group. Counts are cached for the session and a
 * group whose member list cannot be read shows "—"; when every enrichment on a
 * page fails, a non-blocking warning explains that against an error state
 * instead of silently rendering a page of "—" values.
 */
export function GroupsListPage({ descriptor }: ServicePageProps): ReactElement {
  const navigate = useNavigate();
  const [filteringText, setFilteringText] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [enrichmentError, setEnrichmentError] = useState<ApiError | null>(null);
  /** Member counts keyed by group name, filled lazily while paging. */
  const userCounts = useRef(new Map<string, number>());

  const bulkDelete = useBulkDelete<GroupRow>({
    noun: 'group',
    label: (group) => group.groupName,
    remove: async (group) => {
      await deleteGroup(group.groupName);
      userCounts.current.delete(group.groupName);
    },
    onCompleted: () => {
      setReloadToken((token) => token + 1);
    },
  });

  const groupPath = useCallback(
    (groupName: string): string =>
      `${serviceConsolePath(descriptor.id)}/groups/${encodeURIComponent(groupName)}`,
    [descriptor.id],
  );

  const openGroup = useCallback(
    (groupName: string) => {
      void navigate(groupPath(groupName));
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
          let failures = 0;
          let firstError: ApiError | null = null;
          const enriched = await Promise.all(
            page.items.map(async (group): Promise<GroupRow> => {
              const cached = userCounts.current.get(group.groupName);
              if (cached !== undefined) return { ...group, userCount: cached };
              try {
                const detail = await getGroup(group.groupName);
                userCounts.current.set(group.groupName, detail.users.length);
                return { ...group, userCount: detail.users.length };
              } catch (caught) {
                failures += 1;
                firstError ??= toApiError(caught);
                // Show the cached value when there is one; otherwise "—".
                const fallback = userCounts.current.get(group.groupName);
                return fallback === undefined ? { ...group } : { ...group, userCount: fallback };
              }
            }),
          );
          // An enrichment outage must not look like a page of empty groups.
          setEnrichmentError(
            page.items.length > 0 && failures === page.items.length ? firstError : null,
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
              void navigate(`${serviceConsolePath(descriptor.id)}/groups/create`);
            }}
          >
            Create group
          </Button>
        }
        notifications={
          enrichmentError === null ? undefined : (
            <Alert
              type="warning"
              header="Group member counts are unavailable"
              action={
                <Button
                  onClick={() => {
                    setReloadToken((token) => token + 1);
                  }}
                >
                  Retry
                </Button>
              }
            >
              LocalStack did not answer GetGroup for this page, so member counts show “—”. The group
              list itself is current. {enrichmentError.message}
            </Alert>
          )
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
              if (detail.id === 'copy-arn' && group.arn !== undefined) {
                void navigator.clipboard?.writeText(group.arn);
              }
              if (detail.id === 'delete') {
                bulkDelete.requestDelete([group]);
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
        emptyTitle="No user groups"
        emptyDescription="Groups are collections of users that share permissions. Attach a policy to a group once instead of to every user."
      />

      {bulkDelete.targets === null ? null : (
        <DeleteConfirmModal
          visible
          title={bulkDelete.targets.length === 1 ? 'Delete group' : 'Delete groups'}
          subjects={bulkDelete.targets.map((group) => group.groupName)}
          description="Deleting a group is permanent. Remove every member and detach the policies attached to the group first; LocalStack refuses the deletion while either remains."
          confirmationText={bulkDelete.targets.length === 1 ? undefined : 'delete'}
          submitLabel={bulkDelete.targets.length === 1 ? 'Delete group' : 'Delete groups'}
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

export default GroupsListPage;
