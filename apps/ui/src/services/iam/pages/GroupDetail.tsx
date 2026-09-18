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
import { deleteGroup, getGroup, type IamGroup } from '../api';
import { AttachedPoliciesPanel } from '../components/AttachedPoliciesPanel';
import { GroupMembersTab } from '../components/GroupMembersTab';
import { isIamCode, toFriendlyIamError } from '../errors';

/** Group tags and inline policies are not whitelisted/verified yet. */
const GROUP_TAGS_REASON =
  'Group tags (TagGroup / UntagGroup / ListGroupTags) are not whitelisted in LocalDeck yet, so tags cannot be read or written here.';
const INLINE_POLICIES_REASON =
  'Inline policies (PutGroupPolicy / ListGroupPolicies / GetGroupPolicy / DeleteGroupPolicy) are not whitelisted in LocalDeck yet, so inline policies cannot be read or written here.';

/**
 * One IAM user group: Permissions (managed policy attachments) and Users
 * (membership management). Deleting fails while members or policies remain;
 * the failure names the first thing to remove.
 */
export function GroupDetailPage({ descriptor }: ServicePageProps): ReactElement {
  const { groupName = '' } = useParams();
  const navigate = useNavigate();
  const flashbar = useFlashbar();

  const [group, setGroup] = useState<IamGroup | null>(null);
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
      const result = await getGroup(groupName);
      if (requestId.current !== id) return;
      setGroup(result.group);
      setError(null);
    } catch (caught) {
      if (requestId.current !== id) return;
      setGroup(null);
      setError(
        isIamCode(caught, 'NoSuchEntity')
          ? {
              code: 'NoSuchEntity',
              statusCode: 404,
              message: `The group "${groupName}" does not exist in this LocalStack account.`,
            }
          : toApiError(caught),
      );
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [groupName]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- group lookup for the route
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  const confirmDelete = async (): Promise<void> => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteGroup(groupName);
      flashbar.notify({ type: 'success', header: 'Group deleted', content: groupName });
      setDeleteVisible(false);
      navigate(`${serviceConsolePath(descriptor.id)}/groups`);
    } catch (caught) {
      setDeleteError(toFriendlyIamError(caught).message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <ResourceDetailPage
        title={groupName}
        description={
          group === null ? undefined : group.arn === undefined ? (
            <Box color="text-body-secondary">ARN not reported</Box>
          ) : (
            <Box variant="code">{group.arn}</Box>
          )
        }
        breadcrumbs={[
          { text: descriptor.displayName, href: serviceConsolePath(descriptor.id) },
          { text: 'User groups', href: `${serviceConsolePath(descriptor.id)}/groups` },
          { text: groupName },
        ]}
        loading={loading && group === null}
        error={error}
        onRetry={() => {
          void load();
        }}
        headerActions={
          <ButtonDropdown
            ariaLabel="Group actions"
            items={[
              {
                id: 'copy-arn',
                text: 'Copy ARN',
                disabled: group?.arn === undefined,
                ...(group?.arn === undefined
                  ? { disabledReason: 'LocalStack did not report an ARN for this group.' }
                  : {}),
              },
              { id: 'delete', text: 'Delete group' },
            ]}
            onItemClick={({ detail }) => {
              if (detail.id === 'copy-arn' && group?.arn !== undefined) {
                void navigator.clipboard?.writeText(group.arn);
              }
              if (detail.id === 'delete') {
                setDeleteError(null);
                setDeleteVisible(true);
              }
            }}
          >
            Group actions
          </ButtonDropdown>
        }
        tabs={[
          {
            id: 'permissions',
            label: 'Permissions',
            content: <AttachedPoliciesPanel entity="group" name={groupName} />,
          },
          {
            id: 'users',
            label: 'Users',
            content: <GroupMembersTab groupName={groupName} />,
          },
          {
            id: 'inline-policies',
            label: 'Inline policies',
            disabled: true,
            disabledReason: INLINE_POLICIES_REASON,
            content: null,
          },
          {
            id: 'tags',
            label: 'Tags',
            disabled: true,
            disabledReason: GROUP_TAGS_REASON,
            content: null,
          },
        ]}
      />

      {deleteVisible ? (
        <DeleteConfirmModal
          visible
          title="Delete group"
          subjects={[groupName]}
          description="Deleting a group is permanent. Remove every member and detach every attached policy first; LocalStack refuses the deletion while either remains."
          submitLabel="Delete group"
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

export default GroupDetailPage;
