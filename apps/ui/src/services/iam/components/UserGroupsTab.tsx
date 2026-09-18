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
import {
  addUserToGroup,
  listAllGroups,
  listGroupsForUser,
  removeUserFromGroup,
  type IamGroup,
} from '../api';
import { toFriendlyIamError } from '../errors';

export interface UserGroupsTabProps {
  userName: string;
}

interface AddToGroupsModalProps {
  userName: string;
  memberOf: readonly string[];
  onDismiss: () => void;
  onChanged: () => void;
}

/** Picks the groups a user should join; groups they are already in are hidden. */
function AddToGroupsModal({
  userName,
  memberOf,
  onDismiss,
  onChanged,
}: AddToGroupsModalProps): ReactElement {
  const flashbar = useFlashbar();
  const [groups, setGroups] = useState<readonly IamGroup[] | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAllGroups()
      .then((result) => {
        if (cancelled) return;
        setGroups(result);
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
    for (const groupName of selected) {
      try {
        await addUserToGroup({ userName, groupName });
      } catch (caught) {
        failures.push(`${groupName}: ${toFriendlyIamError(caught).message}`);
      }
    }
    setSubmitting(false);

    if (failures.length > 0) {
      setSubmitError(`Some groups could not be updated. ${failures.join(' ')}`);
      onChanged();
      return;
    }

    flashbar.notify({
      type: 'success',
      header: selected.length === 1 ? 'Added to group' : 'Added to groups',
      content: userName,
    });
    onChanged();
    onDismiss();
  };

  const candidates = (groups ?? []).filter((group) => !memberOf.includes(group.groupName));

  return (
    <Modal
      visible
      onDismiss={() => {
        if (!submitting) onDismiss();
      }}
      header={`Add ${userName} to groups`}
      size="medium"
      closeAriaLabel="Close add to groups"
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
              Add to groups
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {submitError === null ? null : <Alert type="error">{submitError}</Alert>}
        {loadError === null ? null : (
          <Alert type="error" header="Could not load the groups">
            {loadError.message}
          </Alert>
        )}

        {groups === null && loadError === null ? (
          <Box textAlign="center" padding="l">
            <Spinner size="large" />
          </Box>
        ) : (
          <Multiselect
            selectedOptions={candidates
              .filter((group) => selected.includes(group.groupName))
              .map((group) => ({ value: group.groupName, label: group.groupName }))}
            options={candidates.map((group) => ({
              value: group.groupName,
              label: group.groupName,
            }))}
            filteringType="auto"
            filteringPlaceholder="Find groups"
            placeholder={candidates.length === 0 ? 'No other groups exist' : 'Choose groups'}
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
 * The user detail Groups tab: every group the user belongs to, with add and
 * remove. Adding opens a multi-select over the account's groups; removing is
 * immediate.
 */
export function UserGroupsTab({ userName }: UserGroupsTabProps): ReactElement {
  const navigate = useNavigate();
  const flashbar = useFlashbar();
  const [groups, setGroups] = useState<readonly IamGroup[]>([]);
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
      const result = await listGroupsForUser(userName);
      if (requestId.current !== id) return;
      setGroups(result);
      setError(null);
    } catch (caught) {
      if (requestId.current !== id) return;
      setError(toApiError(caught));
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [userName]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- group membership fetch
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  const remove = async (group: IamGroup): Promise<void> => {
    setRemoving(group.groupName);
    try {
      await removeUserFromGroup({ userName, groupName: group.groupName });
      flashbar.notify({
        type: 'success',
        header: 'Removed from group',
        content: `${userName} was removed from ${group.groupName}.`,
      });
      await load();
    } catch (caught) {
      flashbar.notify({
        type: 'error',
        header: `Could not remove ${userName} from ${group.groupName}`,
        content: toFriendlyIamError(caught).message,
      });
    } finally {
      setRemoving(null);
    }
  };

  const columns: readonly TableProps.ColumnDefinition<IamGroup>[] = [
    {
      id: 'groupName',
      header: 'Group name',
      isRowHeader: true,
      cell: (group) => (
        <Link
          href={`${serviceConsolePath('iam')}/groups/${encodeURIComponent(group.groupName)}`}
          onFollow={(event) => {
            event.preventDefault();
            navigate(`${serviceConsolePath('iam')}/groups/${encodeURIComponent(group.groupName)}`);
          }}
        >
          {group.groupName}
        </Link>
      ),
    },
    {
      id: 'arn',
      header: 'Group ARN',
      cell: (group) =>
        group.arn === undefined ? (
          <Box color="text-body-secondary">Not reported</Box>
        ) : (
          <Box variant="code">{group.arn}</Box>
        ),
    },
    {
      id: 'actions',
      header: 'Actions',
      minWidth: '150px',
      cell: (group) => (
        <Button
          variant="inline-link"
          loading={removing === group.groupName}
          disabled={removing !== null && removing !== group.groupName}
          onClick={() => {
            void remove(group);
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
            description="Group memberships grant the permissions attached to the group."
            actions={
              <Button
                onClick={() => {
                  setAddVisible(true);
                }}
              >
                Add to groups
              </Button>
            }
          >
            Groups
          </Header>
        }
      >
        <SpaceBetween size="s">
          {error === null ? null : (
            <Alert
              type="error"
              header="Could not load the groups"
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

          <Table<IamGroup>
            variant="embedded"
            loading={loading}
            loadingText="Loading groups"
            items={[...groups]}
            columnDefinitions={columns}
            trackBy={(group) => group.groupName}
            ariaLabels={{ tableLabel: 'Groups' }}
            empty={
              <Box textAlign="center" color="text-body-secondary">
                This user is not a member of any group.
              </Box>
            }
          />
        </SpaceBetween>
      </Container>

      {addVisible ? (
        <AddToGroupsModal
          userName={userName}
          memberOf={groups.map((group) => group.groupName)}
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

export default UserGroupsTab;
