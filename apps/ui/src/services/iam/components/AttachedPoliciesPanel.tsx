import type { ApiError } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import type { TableProps } from '@cloudscape-design/components/table';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { toApiError } from '../../../lib/apiClient';
import { serviceConsolePath } from '../../paths';
import {
  detachPolicy,
  listAttachedPolicies,
  type AttachedEntityKind,
  type IamAttachedPolicy,
} from '../api';
import { toFriendlyIamError } from '../errors';
import { AttachPolicyModal } from './AttachPolicyModal';

export interface AttachedPoliciesPanelProps {
  entity: AttachedEntityKind;
  name: string;
}

/**
 * The console's "Permissions policies" table, shared by users, groups and
 * roles: the managed policies attached to the entity, with attach and detach
 * actions. Detaching is immediate and reversible; failures are reported in a
 * flashbar instead of blocking the table.
 */
export function AttachedPoliciesPanel({ entity, name }: AttachedPoliciesPanelProps): ReactElement {
  const navigate = useNavigate();
  const flashbar = useFlashbar();
  const [policies, setPolicies] = useState<readonly IamAttachedPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [attachVisible, setAttachVisible] = useState(false);
  const [detachingArn, setDetachingArn] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const id = requestId.current + 1;
    requestId.current = id;
    setLoading(true);
    try {
      const result = await listAttachedPolicies(entity, name);
      if (requestId.current !== id) return;
      setPolicies(result);
      setError(null);
    } catch (caught) {
      if (requestId.current !== id) return;
      setError(toApiError(caught));
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [entity, name]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- attached policies fetch
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  const detach = async (policy: IamAttachedPolicy): Promise<void> => {
    setDetachingArn(policy.policyArn);
    try {
      await detachPolicy(entity, name, policy.policyArn);
      flashbar.notify({
        type: 'success',
        header: 'Policy detached',
        content: `${policy.policyName} was detached from ${name}.`,
      });
      await load();
    } catch (caught) {
      flashbar.notify({
        type: 'error',
        header: `Could not detach ${policy.policyName}`,
        content: toFriendlyIamError(caught).message,
      });
    } finally {
      setDetachingArn(null);
    }
  };

  const columns: readonly TableProps.ColumnDefinition<IamAttachedPolicy>[] = [
    {
      id: 'policyName',
      header: 'Policy name',
      isRowHeader: true,
      cell: (policy) => (
        <Link
          href={`${serviceConsolePath('iam')}/policies/${encodeURIComponent(policy.policyArn)}`}
          onFollow={(event) => {
            event.preventDefault();
            void navigate(
              `${serviceConsolePath('iam')}/policies/${encodeURIComponent(policy.policyArn)}`,
            );
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
      id: 'policyArn',
      header: 'Policy ARN',
      cell: (policy) => <Box variant="code">{policy.policyArn}</Box>,
    },
    {
      id: 'actions',
      header: 'Actions',
      minWidth: '110px',
      cell: (policy) => (
        <Button
          variant="inline-link"
          loading={detachingArn === policy.policyArn}
          disabled={detachingArn !== null && detachingArn !== policy.policyArn}
          onClick={() => {
            void detach(policy);
          }}
        >
          Detach
        </Button>
      ),
    },
  ];

  return (
    <Container
      header={
        <Header
          variant="h2"
          description="Managed policies attached to this resource grant its permissions. Detaching a policy takes effect immediately."
          actions={
            <Button
              onClick={() => {
                setAttachVisible(true);
              }}
            >
              Add permissions
            </Button>
          }
        >
          Permissions policies
        </Header>
      }
    >
      <SpaceBetween size="s">
        {error === null ? null : (
          <Alert
            type="error"
            header="Could not load the attached policies"
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

        <Table<IamAttachedPolicy>
          variant="embedded"
          loading={loading}
          loadingText="Loading attached policies"
          items={[...policies]}
          columnDefinitions={columns}
          trackBy={(policy) => policy.policyArn}
          ariaLabels={{ tableLabel: 'Attached policies' }}
          empty={
            <Box textAlign="center" color="text-body-secondary">
              This resource has no attached policies. Choose “Add permissions” to attach one.
            </Box>
          }
        />
      </SpaceBetween>

      {attachVisible ? (
        <AttachPolicyModal
          entity={entity}
          name={name}
          onDismiss={() => {
            setAttachVisible(false);
          }}
          onAttached={() => {
            void load();
          }}
        />
      ) : null}
    </Container>
  );
}

export default AttachedPoliciesPanel;
