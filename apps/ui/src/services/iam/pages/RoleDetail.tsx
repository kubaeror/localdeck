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
import { deleteRole, getRole, type IamRole } from '../api';
import { AttachedPoliciesPanel } from '../components/AttachedPoliciesPanel';
import { TagsTab } from '../components/TagsTab';
import { TrustPolicyPanel } from '../components/TrustPolicyPanel';
import { isIamCode, toFriendlyIamError } from '../errors';

/**
 * One IAM role: Permissions, Trust relationships (editable) and Tags. The
 * attached-policy and tag panels are the module's shared ones, so a role and a
 * user behave identically wherever IAM allows it.
 */
export function RoleDetailPage({ descriptor }: ServicePageProps): ReactElement {
  const { roleName = '' } = useParams();
  const navigate = useNavigate();
  const flashbar = useFlashbar();

  const [role, setRole] = useState<IamRole | null>(null);
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
      const result = await getRole(roleName);
      if (requestId.current !== id) return;
      setRole(result);
      setError(null);
    } catch (caught) {
      if (requestId.current !== id) return;
      setRole(null);
      setError(
        isIamCode(caught, 'NoSuchEntity')
          ? {
              code: 'NoSuchEntity',
              statusCode: 404,
              message: `The role "${roleName}" does not exist in this LocalStack account.`,
            }
          : toApiError(caught),
      );
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [roleName]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- role lookup for the route
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  const confirmDelete = async (): Promise<void> => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteRole(roleName);
      flashbar.notify({ type: 'success', header: 'Role deleted', content: roleName });
      setDeleteVisible(false);
      navigate(`${serviceConsolePath(descriptor.id)}/roles`);
    } catch (caught) {
      setDeleteError(toFriendlyIamError(caught).message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <ResourceDetailPage
        title={roleName}
        description={role === null ? undefined : <Box variant="code">{role.arn}</Box>}
        breadcrumbs={[
          { text: descriptor.displayName, href: serviceConsolePath(descriptor.id) },
          { text: 'Roles', href: `${serviceConsolePath(descriptor.id)}/roles` },
          { text: roleName },
        ]}
        loading={loading}
        error={error}
        onRetry={() => {
          void load();
        }}
        headerActions={
          <ButtonDropdown
            ariaLabel="Role actions"
            items={[
              { id: 'copy-arn', text: 'Copy ARN' },
              { id: 'delete', text: 'Delete role' },
            ]}
            onItemClick={({ detail }) => {
              if (detail.id === 'copy-arn' && role !== null) {
                void navigator.clipboard?.writeText(role.arn);
              }
              if (detail.id === 'delete') {
                setDeleteError(null);
                setDeleteVisible(true);
              }
            }}
          >
            Role actions
          </ButtonDropdown>
        }
        tabs={[
          {
            id: 'permissions',
            label: 'Permissions',
            content: <AttachedPoliciesPanel entity="role" name={roleName} />,
          },
          {
            id: 'trust-relationships',
            label: 'Trust relationships',
            content: <TrustPolicyPanel roleName={roleName} />,
          },
          {
            id: 'tags',
            label: 'Tags',
            content: <TagsTab entity="role" name={roleName} />,
          },
        ]}
      />

      {deleteVisible ? (
        <DeleteConfirmModal
          visible
          title="Delete role"
          subjects={[roleName]}
          description="Every attached policy must be detached before the role can be deleted. This action cannot be undone."
          submitLabel="Delete role"
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

export default RoleDetailPage;
