import type { ApiError } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Modal from '@cloudscape-design/components/modal';
import Multiselect from '@cloudscape-design/components/multiselect';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import Table from '@cloudscape-design/components/table';
import type { TableProps } from '@cloudscape-design/components/table';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { toApiError } from '../../../lib/apiClient';
import { serviceConsolePath } from '../../paths';
import { addUserToGroup, getGroup, listAllUsers, removeUserFromGroup, type IamUser } from '../api';
import { toFriendlyIamError } from '../errors';

export interface GroupMembersTabProps {
  groupName: string;
}

interface AddUsersModalProps {
  groupName: string;
  memberOf: readonly string[];
  onDismiss: () => void;
  onChanged: () => void;
}

/** Picks users to add to the group; existing members are hidden. */
function AddUsersModal({
  groupName,
  memberOf,
  onDismiss,
  onChanged,
}: AddUsersModalProps): ReactElement {
  const flashbar = useFlashbar();
  const [users, setUsers] = useState<readonly IamUser[] | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAllUsers()
      .then((result) => {
        if (cancelled) return;
        setUsers(result);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setLoadError(toApiError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const add = async (): Promise<void> => {
    setSubmitting(true);
    setSubmitError(null);
    const failures: string[] = [];
    for (const userName of selected) {
      try {
        await addUserToGroup({ userName, groupName });
      } catch (caught) {
        failures.push(`${userName}: ${toFriendlyIamError(caught).message}`);
      }
    }
    setSubmitting(false);

    if (failures.length > 0) {
      setSubmitError(`Some users could not be added. ${failures.join(' ')}`);
      onChanged();
      return;
    }

    flashbar.notify({
      type: 'success',
      header: selected.length === 1 ? 'User added' : 'Users added',
      content: `${groupName} now has ${selected.length} more ${selected.length === 1 ? 'member' : 'members'}.`,
    });
    onChanged();
    onDismiss();
  };

  const candidates = (users ?? []).filter((user) => !memberOf.includes(user.userName));

  return (
    <Modal
      visible
      onDismiss={() => {
        if (!submitting) onDismiss();
      }}
      header={`Add users to ${groupName}`}
      size="medium"
      closeAriaLabel="Close add users"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={submitting} onClick={onDismiss}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={submitting}
              disabled={selected.length === 0 || loadError !== null}
              onClick={() => {
                void add();
              }}
            >
              Add users
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {submitError === null ? null : <Alert type="error">{submitError}</Alert>}
        {loadError === null ? null : (
          <Alert type="error" header="Could not load the users">
            {loadError.message}
          </Alert>
        )}

        {users === null && loadError === null ? (
          <Box textAlign="center" padding="l">
            <Spinner size="large" />
          </Box>
        ) : (
          <Multiselect
            selectedOptions={candidates
              .filter((user) => selected.includes(user.userName))
              .map((user) => ({ value: user.userName, label: user.userName }))}
            options={candidates.map((user) => ({ value: user.userName, label: user.userName }))}
            filteringType="auto"
            filteringPlaceholder="Find users"
            placeholder={
              candidates.length === 0 ? 'Every user is already a member' : 'Choose users'
            }
            tokenLimit={8}
            onChange={({ detail }) => {
              setSelected(
                detail.selectedOptions
                  .map((option) => option.value ?? '')
                  .filter((entry) => entry.length > 0),
              );
            }}
          />
        )}
      </SpaceBetween>
    </Modal>
  );
}

/**
 * The group detail Users tab: every member, with add and remove. Adding opens a
 * multi-select over the account's users; removing is immediate.
 */
export function GroupMembersTab({ groupName }: GroupMembersTabProps): ReactElement {
  const navigate = useNavigate();
  const flashbar = useFlashbar();
  const [users, setUsers] = useState<readonly IamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [addVisible, setAddVisible] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const id = requestId.current + 1;
    requestId.current = id;
    setLoading(true);
    try {
      const result = await getGroup(groupName);
      if (requestId.current !== id) return;
      setUsers(result.users);
      setError(null);
    } catch (caught) {
      if (requestId.current !== id) return;
      setError(toApiError(caught));
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [groupName]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- group member fetch
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  const remove = async (user: IamUser): Promise<void> => {
    setRemoving(user.userName);
    try {
      await removeUserFromGroup({ userName: user.userName, groupName });
      flashbar.notify({
        type: 'success',
        header: 'Removed from group',
        content: `${user.userName} was removed from ${groupName}.`,
      });
      await load();
    } catch (caught) {
      flashbar.notify({
        type: 'error',
        header: `Could not remove ${user.userName}`,
        content: toFriendlyIamError(caught).message,
      });
    } finally {
      setRemoving(null);
    }
  };

  const columns: readonly TableProps.ColumnDefinition<IamUser>[] = [
    {
      id: 'userName',
      header: 'User name',
      isRowHeader: true,
      cell: (user) => (
        <Link
          href={`${serviceConsolePath('iam')}/users/${encodeURIComponent(user.userName)}`}
          onFollow={(event) => {
            event.preventDefault();
            navigate(`${serviceConsolePath('iam')}/users/${encodeURIComponent(user.userName)}`);
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
      id: 'actions',
      header: 'Actions',
      minWidth: '150px',
      cell: (user) => (
        <Button
          variant="inline-link"
          loading={removing === user.userName}
          disabled={removing !== null && removing !== user.userName}
          onClick={() => {
            void remove(user);
          }}
        >
          Remove from group
        </Button>
      ),
    },
  ];

  return (
    <>
      <Container
        header={
          <Header
            variant="h2"
            description="Members inherit the permissions attached to this group."
            actions={
              <Button
                onClick={() => {
                  setAddVisible(true);
                }}
              >
                Add users
              </Button>
            }
          >
            Users
          </Header>
        }
      >
        <SpaceBetween size="s">
          {error === null ? null : (
            <Alert
              type="error"
              header="Could not load the group members"
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

          <Table<IamUser>
            variant="embedded"
            loading={loading}
            loadingText="Loading users"
            items={[...users]}
            columnDefinitions={columns}
            trackBy={(user) => user.userName}
            ariaLabels={{ tableLabel: 'Group members' }}
            empty={
              <Box textAlign="center" color="text-body-secondary">
                This group has no members.
              </Box>
            }
          />
        </SpaceBetween>
      </Container>

      {addVisible ? (
        <AddUsersModal
          groupName={groupName}
          memberOf={users.map((user) => user.userName)}
          onDismiss={() => {
            setAddVisible(false);
          }}
          onChanged={() => {
            void load();
          }}
        />
      ) : null}
    </>
  );
}

export default GroupMembersTab;
