import type { ApiError } from '@localdeck/shared';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DeleteConfirmModal } from '../../../components/DeleteConfirmModal';
import { InfoTooltip } from '../../../components/InfoTooltip';
import { ResourceDetailPage } from '../../../components/ResourceDetailPage';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { toApiError } from '../../../lib/apiClient';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import {
  deleteSecurityGroup,
  getSecurityGroup,
  revokeSecurityGroupIngress,
  type Ec2SecurityGroup,
  type Ec2SecurityGroupRule,
  type SecurityGroupIngressRule,
} from '../api';
import { toFriendlyEc2Error } from '../errors';
import { AddIngressRuleModal } from '../components/AddIngressRuleModal';
import { EmulatedBadge } from '../components/EmulatedBadge';
import { ResourceTagsTab } from '../components/ResourceTagsTab';
import { SecurityGroupRulesTable } from '../components/SecurityGroupRulesTable';

/** Rebuilds the API input for revoking exactly one stored rule. */
function toRevokeInput(rule: Ec2SecurityGroupRule): SecurityGroupIngressRule {
  return {
    protocol: rule.protocol,
    ...(rule.fromPort === undefined ? {} : { fromPort: rule.fromPort }),
    ...(rule.toPort === undefined ? {} : { toPort: rule.toPort }),
    ...(rule.ipv4Ranges.length === 0 ? {} : { cidrIpv4: rule.ipv4Ranges }),
    ...(rule.ipv6Ranges.length === 0 ? {} : { cidrIpv6: rule.ipv6Ranges }),
  };
}

/**
 * One security group: inbound and outbound rules with add/revoke actions, plus
 * details and tags. The default group of a VPC cannot be deleted, so its delete
 * action is disabled with an explanation.
 */
export function SecurityGroupDetailPage({ descriptor }: ServicePageProps): ReactElement {
  const { groupId = '' } = useParams();
  const navigate = useNavigate();
  const flashbar = useFlashbar();

  const [group, setGroup] = useState<Ec2SecurityGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [addVisible, setAddVisible] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const id = requestId.current + 1;
    requestId.current = id;
    setLoading(true);
    try {
      const result = await getSecurityGroup(groupId);
      if (requestId.current !== id) return;
      setGroup(result);
      setError(null);
    } catch (caught) {
      if (requestId.current !== id) return;
      setGroup(null);
      setError(toApiError(caught));
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- security group lookup for the route
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  const revoke = async (rule: Ec2SecurityGroupRule): Promise<void> => {
    setRevoking(true);
    try {
      await revokeSecurityGroupIngress({ groupId, rule: toRevokeInput(rule) });
      flashbar.notify({
        type: 'success',
        header: 'Inbound rule revoked',
        content: `${rule.protocol} ${rule.fromPort ?? ''}-${rule.toPort ?? ''}`.trim(),
      });
      await load();
    } catch (caught) {
      flashbar.notify({
        type: 'error',
        header: 'Could not revoke the rule',
        content: toFriendlyEc2Error(caught).message,
      });
    } finally {
      setRevoking(false);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteSecurityGroup(groupId);
      flashbar.notify({ type: 'success', header: 'Security group deleted', content: groupId });
      setDeleteVisible(false);
      navigate(`${serviceConsolePath(descriptor.id)}/security-groups`);
    } catch (caught) {
      setDeleteError(toFriendlyEc2Error(caught).message);
    } finally {
      setDeleting(false);
    }
  };

  const listingPath = `${serviceConsolePath(descriptor.id)}/security-groups`;
  const isDefault = group?.groupName === 'default';

  const addRuleButton = (
    <Button
      variant="primary"
      disabled={group === null}
      onClick={() => {
        setAddVisible(true);
      }}
    >
      Add inbound rule
    </Button>
  );

  const deleteButton =
    isDefault === true ? (
      <InfoTooltip content="The default security group of a VPC cannot be deleted.">
        <Button disabled>Delete security group</Button>
      </InfoTooltip>
    ) : (
      <Button
        disabled={group === null}
        onClick={() => {
          setDeleteError(null);
          setDeleteVisible(true);
        }}
      >
        Delete security group
      </Button>
    );

  return (
    <>
      <ResourceDetailPage
        title={group?.groupName ?? groupId}
        description={group === null ? undefined : <Box variant="code">{group.groupId}</Box>}
        breadcrumbs={[
          { text: descriptor.displayName, href: serviceConsolePath(descriptor.id) },
          { text: 'Security groups', href: listingPath },
          { text: group?.groupName ?? groupId },
        ]}
        loading={loading}
        error={error}
        onRetry={() => {
          void load();
        }}
        status={
          group === null ? undefined : (
            <EmulatedBadge detail="LocalStack emulates this security group in memory: rules are stored and returned by the EC2 API, but no packets are filtered." />
          )
        }
        headerActions={
          <SpaceBetween direction="horizontal" size="xs">
            {addRuleButton}
            {deleteButton}
          </SpaceBetween>
        }
        tabs={
          group === null
            ? []
            : [
                {
                  id: 'inbound',
                  label: 'Inbound rules',
                  content: (
                    <Container
                      header={
                        <Header
                          variant="h2"
                          description="Rules that allow traffic to reach the resources this group is attached to."
                          actions={
                            <Button
                              onClick={() => {
                                setAddVisible(true);
                              }}
                            >
                              Add inbound rule
                            </Button>
                          }
                        >
                          Inbound rules
                        </Header>
                      }
                    >
                      <SecurityGroupRulesTable
                        rules={group.inbound}
                        direction="inbound"
                        revoking={revoking}
                        onRevoke={(rule) => {
                          void revoke(rule);
                        }}
                      />
                    </Container>
                  ),
                },
                {
                  id: 'outbound',
                  label: 'Outbound rules',
                  content: (
                    <Container
                      header={
                        <Header
                          variant="h2"
                          description="Rules that allow traffic from the group's resources to travel out. LocalStack creates an allow-all rule by default."
                        >
                          Outbound rules
                        </Header>
                      }
                    >
                      <SecurityGroupRulesTable rules={group.outbound} direction="outbound" />
                    </Container>
                  ),
                },
                {
                  id: 'details',
                  label: 'Details',
                  content: (
                    <Container header={<Header variant="h2">Details</Header>}>
                      <KeyValuePairs
                        columns={2}
                        items={[
                          { label: 'Security group ID', value: group.groupId },
                          { label: 'Security group name', value: group.groupName },
                          { label: 'Description', value: group.description },
                          { label: 'VPC ID', value: group.vpcId ?? '—' },
                          { label: 'Owner', value: group.ownerId ?? '—' },
                          {
                            label: 'ARN',
                            value:
                              group.arn === undefined ? '—' : <Box variant="code">{group.arn}</Box>,
                          },
                          { label: 'Inbound rules', value: String(group.inbound.length) },
                          { label: 'Outbound rules', value: String(group.outbound.length) },
                        ]}
                      />
                    </Container>
                  ),
                },
                {
                  id: 'tags',
                  label: 'Tags',
                  content: (
                    <ResourceTagsTab
                      key={group.groupId}
                      resourceId={group.groupId}
                      tags={group.tags}
                      description="Tags applied to the security group. Saving applies only the changed keys through CreateTags and DeleteTags."
                      onSaved={() => {
                        void load();
                      }}
                    />
                  ),
                },
              ]
        }
      />

      {addVisible ? (
        <AddIngressRuleModal
          groupId={groupId}
          groupName={group?.groupName ?? groupId}
          onDismiss={() => {
            setAddVisible(false);
          }}
          onAdded={() => {
            setAddVisible(false);
            flashbar.notify({ type: 'success', header: 'Inbound rule added', content: groupId });
            void load();
          }}
        />
      ) : null}

      {deleteVisible ? (
        <DeleteConfirmModal
          visible
          title="Delete security group"
          subjects={[group?.groupName ?? groupId]}
          description="Deleting a security group removes its rules permanently. Instances and network interfaces that still use the group must be disassociated first, and this action cannot be undone."
          submitLabel="Delete security group"
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

export default SecurityGroupDetailPage;
