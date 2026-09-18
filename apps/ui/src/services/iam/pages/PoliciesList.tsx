import type { TableProps } from '@cloudscape-design/components/table';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import Link from '@cloudscape-design/components/link';
import SegmentedControl from '@cloudscape-design/components/segmented-control';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { DeleteConfirmModal } from '../../../components/DeleteConfirmModal';
import { ResourceListPage } from '../../../components/ResourceListPage';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import { deletePolicy, listPolicies, type IamPolicy, type IamPolicyScope } from '../api';
import { toFriendlyIamError } from '../errors';

/**
 * The IAM policies list: policy name, type (AWS managed / customer managed) and
 * the number of attached entities. The scope selector switches the source list
 * — LocalStack has well over a thousand AWS managed policies, so the two scopes
 * are never fetched together. AWS managed policies are read-only.
 */
export function PoliciesListPage({ descriptor }: ServicePageProps): ReactElement {
  const navigate = useNavigate();
  const flashbar = useFlashbar();
  const [scope, setScope] = useState<IamPolicyScope>('Local');
  const [filteringText, setFilteringText] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<IamPolicy | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const policyPath = useCallback(
    (policyArn: string): string =>
      `${serviceConsolePath(descriptor.id)}/policies/${encodeURIComponent(policyArn)}`,
    [descriptor.id],
  );

  const openPolicy = useCallback(
    (policyArn: string) => {
      navigate(policyPath(policyArn));
    },
    [navigate, policyPath],
  );

  const columns = useMemo<readonly TableProps.ColumnDefinition<IamPolicy>[]>(
    () => [
      {
        id: 'policyName',
        header: 'Policy name',
        sortingField: 'policyName',
        isRowHeader: true,
        cell: (policy) => (
          <Link
            href={policyPath(policy.arn)}
            onFollow={(event) => {
              event.preventDefault();
              openPolicy(policy.arn);
            }}
          >
            {policy.policyName}
          </Link>
        ),
      },
      {
        id: 'policyType',
        header: 'Type',
        cell: (policy) => (policy.scope === 'AWS' ? 'AWS managed' : 'Customer managed'),
      },
      {
        id: 'attachmentCount',
        header: 'Attached entities',
        sortingField: 'attachmentCount',
        cell: (policy) => policy.attachmentCount,
      },
    ],
    [openPolicy, policyPath],
  );

  const confirmDelete = async (): Promise<void> => {
    if (deleteTarget === null) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deletePolicy(deleteTarget.arn);
      flashbar.notify({
        type: 'success',
        header: 'Policy deleted',
        content: deleteTarget.policyName,
      });
      setDeleteTarget(null);
      setReloadToken((token) => token + 1);
    } catch (caught) {
      setDeleteError(toFriendlyIamError(caught).message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <ResourceListPage<IamPolicy>
        key={scope}
        title="Policies"
        description={descriptor.summary}
        breadcrumbs={[
          { text: descriptor.displayName, href: serviceConsolePath(descriptor.id) },
          { text: 'Policies' },
        ]}
        columns={columns}
        getRowId={(policy) => policy.arn}
        reloadToken={reloadToken}
        fetcher={({ nextToken, signal }) =>
          listPolicies({
            scope,
            ...(nextToken === undefined ? {} : { nextToken }),
            ...(signal === undefined ? {} : { signal }),
          })
        }
        filtering={{
          text: filteringText,
          onChange: setFilteringText,
          placeholder: 'Find policies by name',
          match: (policy, text) =>
            policy.policyName.toLowerCase().includes(text.trim().toLowerCase()) ||
            policy.arn.toLowerCase().includes(text.trim().toLowerCase()),
        }}
        notifications={
          <SpaceBetween size="xs">
            <SegmentedControl
              selectedId={scope}
              label="Policy type"
              options={[
                { id: 'Local', text: 'Customer managed' },
                { id: 'AWS', text: 'AWS managed' },
              ]}
              onChange={({ detail }) => {
                const next = detail.selectedId;
                if (next !== 'Local' && next !== 'AWS') return;
                setScope(next);
                setFilteringText('');
                setDeleteTarget(null);
              }}
            />
            {scope === 'AWS' ? (
              <Box variant="small" color="text-body-secondary">
                AWS managed policies are maintained by AWS and cannot be edited or deleted here.
              </Box>
            ) : null}
          </SpaceBetween>
        }
        headerActions={
          <Button
            variant="primary"
            onClick={() => {
              navigate(`${serviceConsolePath(descriptor.id)}/policies/create`);
            }}
          >
            Create policy
          </Button>
        }
        rowActions={(policy) => (
          <ButtonDropdown
            variant="icon"
            ariaLabel={`Actions for ${policy.policyName}`}
            items={[
              { id: 'view', text: 'View details' },
              { id: 'copy-arn', text: 'Copy ARN' },
              {
                id: 'delete',
                text: 'Delete',
                disabled: policy.scope === 'AWS',
              },
            ]}
            onItemClick={({ detail }) => {
              if (detail.id === 'view') openPolicy(policy.arn);
              if (detail.id === 'copy-arn') {
                void navigator.clipboard?.writeText(policy.arn);
              }
              if (detail.id === 'delete' && policy.scope !== 'AWS') {
                setDeleteError(null);
                setDeleteTarget(policy);
              }
            }}
          />
        )}
        emptyTitle="No policies"
        emptyDescription={
          scope === 'Local'
            ? 'Customer managed policies define permissions you can attach to users, groups and roles. Create a policy to get started.'
            : 'This LocalStack instance reports no AWS managed policies.'
        }
      />

      {deleteTarget === null ? null : (
        <DeleteConfirmModal
          visible
          title="Delete policy"
          subjects={[deleteTarget.policyName]}
          description="Deleting a policy removes it permanently from every entity it is attached to. This action cannot be undone."
          submitLabel="Delete policy"
          loading={deleting}
          {...(deleteError === null ? {} : { errorText: deleteError })}
          onDismiss={() => {
            if (deleting) return;
            setDeleteTarget(null);
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

export default PoliciesListPage;
