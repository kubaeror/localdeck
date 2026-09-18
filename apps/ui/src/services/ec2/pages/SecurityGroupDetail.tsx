import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DeleteConfirmModal } from '../../../components/DeleteConfirmModal';
import { InfoTooltip } from '../../../components/InfoTooltip';
import { ResourceDetailPage } from '../../../components/ResourceDetailPage';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import {
  deleteSecurityGroup,
  getSecurityGroup,
  revokeSecurityGroupIngress,
  type Ec2SecurityGroupRule,
  type SecurityGroupIngressRule,
} from '../api';
import { toFriendlyEc2Error } from '../errors';
import { useEc2Resource } from '../hooks';
import { AddIngressRuleModal } from '../components/AddIngressRuleModal';
import { EmulatedBadge } from '../components/EmulatedBadge';
import { ResourceTagsTab } from '../components/ResourceTagsTab';
import { SecurityGroupRulesTable } from '../components/SecurityGroupRulesTable';

/**
 * Rebuilds the API input for revoking exactly one stored rule. Every member is
 * carried over — security-group references, prefix lists and the description —
 * so a revoke cannot match a broader rule than the one the user clicked.
 */
function toRevokeInput(rule: Ec2SecurityGroupRule): SecurityGroupIngressRule {
  return {
    protocol: rule.protocol,
    ...(rule.fromPort === undefined ? {} : { fromPort: rule.fromPort }),
    ...(rule.toPort === undefined ? {} : { toPort: rule.toPort }),
    ...(rule.description === undefined ? {} : { description: rule.description }),
    ...(rule.ipv4Ranges.length === 0 ? {} : { cidrIpv4: rule.ipv4Ranges }),
    ...(rule.ipv6Ranges.length === 0 ? {} : { cidrIpv6: rule.ipv6Ranges }),
    ...(rule.prefixListIds.length === 0 ? {} : { prefixListIds: rule.prefixListIds }),
    ...(rule.referencedGroups.length === 0 ? {} : { referencedGroups: rule.referencedGroups }),
  };
}

/** Human label for one rule, shown in the revoke confirmation. */
function ruleLabel(rule: Ec2SecurityGroupRule): string {
  const protocol = rule.protocol === '-1' ? 'All traffic' : rule.protocol.toUpperCase();
  const ports =
    rule.protocol === '-1' || (rule.fromPort === undefined && rule.toPort === undefined)
      ? 'all ports'
      : rule.toPort === undefined || rule.fromPort === rule.toPort
        ? `port ${String(rule.fromPort ?? 'all')}`
        : `ports ${String(rule.fromPort ?? 'all')}-${String(rule.toPort)}`;
  const sources = [
    ...rule.ipv4Ranges,
    ...rule.ipv6Ranges,
    ...rule.prefixListIds,
    ...rule.referencedGroups,
  ];
  return `${protocol} ${ports}${sources.length === 0 ? '' : ` from ${sources.join(', ')}`}`;
}

/**
 * One security group: inbound and outbound rules with add/revoke actions, plus
 * details and tags. The default group of a VPC cannot be deleted, so its delete
 * action is disabled with an explanation. Outbound rules are read-only in this
 * module, so the add action is rendered disabled with the reason.
 */
export function SecurityGroupDetailPage({ descriptor }: ServicePageProps): ReactElement {
  const { groupId = '' } = useParams();
  const navigate = useNavigate();
  const flashbar = useFlashbar();

  const loader = useCallback(() => getSecurityGroup(groupId), [groupId]);
  const { data: group, loading, error, reload } = useEc2Resource(loader);

  const [addVisible, setAddVisible] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<{
    rule: Ec2SecurityGroupRule;
    rowId: string;
  } | null>(null);
  const [revokingRowId, setRevokingRowId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const confirmRevoke = async (): Promise<void> => {
    if (revokeTarget === null || revokingRowId !== null) return;
    setRevokingRowId(revokeTarget.rowId);
    setRevokeError(null);
    try {
      await revokeSecurityGroupIngress({ groupId, rule: toRevokeInput(revokeTarget.rule) });
      flashbar.notify({
        type: 'success',
        header: 'Inbound rule revoked',
        content:
          `${revokeTarget.rule.protocol} ${revokeTarget.rule.fromPort ?? ''}-${revokeTarget.rule.toPort ?? ''}`.trim(),
      });
      setRevokeTarget(null);
      await reload();
    } catch (caught) {
      setRevokeError(toFriendlyEc2Error(caught).message);
    } finally {
      setRevokingRowId(null);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (deleting) return;
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
          void reload();
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
                        revokingRowId={revokingRowId}
                        onRevoke={(rule, rowId) => {
                          setRevokeError(null);
                          setRevokeTarget({ rule, rowId });
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
                          actions={
                            <InfoTooltip content="This LocalDeck module manages inbound rules only. Outbound rules are shown read-only; AuthorizeSecurityGroupEgress is not part of the EC2 whitelist.">
                              <Button disabled>Add outbound rule</Button>
                            </InfoTooltip>
                          }
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
                        void reload();
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
          {...(group?.vpcId === undefined ? {} : { vpcId: group.vpcId })}
          onDismiss={() => {
            setAddVisible(false);
          }}
          onAdded={() => {
            setAddVisible(false);
            flashbar.notify({ type: 'success', header: 'Inbound rule added', content: groupId });
            void reload();
          }}
        />
      ) : null}

      {revokeTarget === null ? null : (
        <DeleteConfirmModal
          visible
          title="Revoke inbound rule"
          subjects={[ruleLabel(revokeTarget.rule)]}
          confirmationText="revoke"
          submitLabel="Revoke rule"
          description="Revoking this inbound rule removes it from the security group immediately. Traffic the rule allowed is no longer permitted, and this action cannot be undone."
          loading={revokingRowId !== null}
          {...(revokeError === null ? {} : { errorText: revokeError })}
          onDismiss={() => {
            if (revokingRowId !== null) return;
            setRevokeTarget(null);
            setRevokeError(null);
          }}
          onConfirm={() => {
            void confirmRevoke();
          }}
        />
      )}

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
