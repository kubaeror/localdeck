import type { TableProps } from '@cloudscape-design/components/table';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import Link from '@cloudscape-design/components/link';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { DeleteConfirmModal } from '../../../components/DeleteConfirmModal';
import { InfoTooltip } from '../../../components/InfoTooltip';
import { ResourceListPage } from '../../../components/ResourceListPage';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import { deleteSecurityGroup, listSecurityGroups, type Ec2SecurityGroup } from '../api';
import { copyTextToClipboard } from '../clipboard';
import { toFriendlyEc2Error } from '../errors';
import { CreateSecurityGroupModal } from '../components/CreateSecurityGroupModal';
import { EC2_PAGE_SIZE_OPTIONS } from '../listOptions';

/**
 * The console's security groups list: group id, name, description, VPC and rule
 * counts, with creation, deletion and links into each group's page. The default
 * group of a VPC cannot be deleted, so its delete action is disabled.
 */
export function SecurityGroupsListPage({ descriptor }: ServicePageProps): ReactElement {
  const navigate = useNavigate();
  const flashbar = useFlashbar();
  const [filteringText, setFilteringText] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [createVisible, setCreateVisible] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<readonly Ec2SecurityGroup[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const groupPath = useCallback(
    (groupId: string): string =>
      `${serviceConsolePath(descriptor.id)}/security-groups/${encodeURIComponent(groupId)}`,
    [descriptor.id],
  );

  const openGroup = useCallback(
    (groupId: string) => {
      navigate(groupPath(groupId));
    },
    [navigate, groupPath],
  );

  const copyGroupId = useCallback(
    async (groupId: string): Promise<void> => {
      try {
        await copyTextToClipboard(groupId);
        flashbar.notify({ type: 'success', header: 'Copied', content: groupId });
      } catch (caught) {
        flashbar.notify({
          type: 'error',
          header: 'Could not copy the security group ID',
          content: caught instanceof Error ? caught.message : 'The clipboard is not available.',
        });
      }
    },
    [flashbar],
  );

  const columns = useMemo<readonly TableProps.ColumnDefinition<Ec2SecurityGroup>[]>(
    () => [
      {
        id: 'groupId',
        header: 'Security group ID',
        sortingField: 'groupId',
        isRowHeader: true,
        cell: (group) => (
          <Link
            href={groupPath(group.groupId)}
            onFollow={(event) => {
              event.preventDefault();
              openGroup(group.groupId);
            }}
          >
            <Box variant="code" display="inline">
              {group.groupId}
            </Box>
          </Link>
        ),
      },
      {
        id: 'groupName',
        header: 'Security group name',
        sortingField: 'groupName',
        cell: (group) => (
          <Link
            href={groupPath(group.groupId)}
            onFollow={(event) => {
              event.preventDefault();
              openGroup(group.groupId);
            }}
          >
            {group.groupName}
          </Link>
        ),
      },
      {
        id: 'description',
        header: 'Description',
        cell: (group) => group.description,
      },
      {
        id: 'vpcId',
        header: 'VPC ID',
        sortingField: 'vpcId',
        cell: (group) =>
          group.vpcId === undefined ? '—' : <Box variant="code">{group.vpcId}</Box>,
      },
      {
        id: 'inboundCount',
        header: 'Inbound rules',
        cell: (group) => group.inbound.length,
      },
      {
        id: 'outboundCount',
        header: 'Outbound rules',
        cell: (group) => group.outbound.length,
      },
    ],
    [groupPath, openGroup],
  );

  const isDefault = (group: Ec2SecurityGroup): boolean => group.groupName === 'default';

  const confirmDelete = async (): Promise<void> => {
    if (deleting) return;
    const targets = deleteTargets ?? [];
    if (targets.length === 0) return;
    setDeleting(true);
    setDeleteError(null);
    const failures: Ec2SecurityGroup[] = [];
    const failureMessages: string[] = [];
    for (const group of targets) {
      try {
        await deleteSecurityGroup(group.groupId);
        flashbar.notify({
          type: 'success',
          header: 'Security group deleted',
          content: group.groupName,
        });
      } catch (caught) {
        failures.push(group);
        failureMessages.push(`${group.groupName}: ${toFriendlyEc2Error(caught).message}`);
      }
    }
    setDeleting(false);
    setReloadToken((token) => token + 1);
    if (failures.length > 0) {
      // Keep the modal open on the failed groups so the reason is readable and
      // the user can retry without selecting them again.
      setDeleteTargets(failures);
      setDeleteError(
        `${failures.length} of ${targets.length} security group${targets.length === 1 ? '' : 's'} could not be deleted. ${failureMessages.join(' ')}`,
      );
      return;
    }
    setDeleteTargets(null);
  };

  const isFiltering = filteringText.trim().length > 0;

  return (
    <>
      <ResourceListPage<Ec2SecurityGroup>
        title="Security groups"
        description="Security groups act as virtual firewalls for instances: they control inbound and outbound traffic at the instance level."
        breadcrumbs={[
          { text: descriptor.displayName, href: serviceConsolePath(descriptor.id) },
          { text: 'Security groups' },
        ]}
        columns={columns}
        getRowId={(group) => group.groupId}
        reloadToken={reloadToken}
        preferencesId="ec2-security-groups-list"
        pageSizeOptions={EC2_PAGE_SIZE_OPTIONS}
        fetcher={({ nextToken, signal }) =>
          listSecurityGroups({
            ...(nextToken === undefined ? {} : { nextToken }),
            ...(signal === undefined ? {} : { signal }),
          })
        }
        filtering={{
          text: filteringText,
          onChange: setFilteringText,
          placeholder: 'Find security groups by name, ID or VPC',
          match: (group, text) => {
            const needle = text.trim().toLowerCase();
            return [group.groupName, group.groupId, group.vpcId ?? '', group.description].some(
              (value) => value.toLowerCase().includes(needle),
            );
          },
        }}
        headerActions={
          <Button
            variant="primary"
            onClick={() => {
              setCreateVisible(true);
            }}
          >
            Create security group
          </Button>
        }
        notifications={
          <Box color="text-body-secondary">
            The default security group of a VPC cannot be deleted; its delete action stays disabled.
          </Box>
        }
        rowActions={(group) => {
          const menu = (
            <ButtonDropdown
              variant="icon"
              ariaLabel={`Actions for ${group.groupName}`}
              items={[
                { id: 'view', text: 'View details' },
                { id: 'copy', text: 'Copy security group ID' },
                {
                  id: 'delete',
                  text: 'Delete security group',
                  disabled: isDefault(group),
                },
              ]}
              onItemClick={({ detail }) => {
                if (detail.id === 'view') openGroup(group.groupId);
                if (detail.id === 'copy') void copyGroupId(group.groupId);
                if (detail.id === 'delete') {
                  setDeleteError(null);
                  setDeleteTargets([group]);
                }
              }}
            />
          );
          return isDefault(group) ? (
            <InfoTooltip content="The default security group of a VPC cannot be deleted.">
              {menu}
            </InfoTooltip>
          ) : (
            menu
          );
        }}
        bulkActions={(selected) => (
          <ButtonDropdown
            ariaLabel="Security group actions"
            items={[
              {
                id: 'delete',
                text: 'Delete security groups',
                disabled: selected.some(isDefault),
              },
            ]}
            onItemClick={({ detail }) => {
              if (detail.id === 'delete') {
                setDeleteError(null);
                setDeleteTargets(selected.filter((group) => !isDefault(group)));
              }
            }}
          >
            Actions
          </ButtonDropdown>
        )}
        emptyTitle={isFiltering ? 'No matches' : 'No security groups'}
        emptyDescription={
          isFiltering
            ? 'No security group matches the current filter. Clear the filter or try another search term.'
            : 'A security group controls the traffic that is allowed to reach an instance. Create one to get started.'
        }
      />

      {createVisible ? (
        <CreateSecurityGroupModal
          onDismiss={() => {
            setCreateVisible(false);
          }}
          onCreated={(group) => {
            setCreateVisible(false);
            flashbar.notify({
              type: 'success',
              header: 'Security group created',
              content: group.groupName,
            });
            setReloadToken((token) => token + 1);
            openGroup(group.groupId);
          }}
        />
      ) : null}

      {deleteTargets === null ? null : (
        <DeleteConfirmModal
          visible
          title={deleteTargets.length === 1 ? 'Delete security group' : 'Delete security groups'}
          subjects={deleteTargets.map((group) => group.groupName)}
          description="Deleting a security group removes its rules permanently. Instances and network interfaces that still use the group must be disassociated first, and this action cannot be undone."
          confirmationText={deleteTargets.length === 1 ? undefined : 'delete'}
          submitLabel={
            deleteTargets.length === 1 ? 'Delete security group' : 'Delete security groups'
          }
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

export default SecurityGroupsListPage;
