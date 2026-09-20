import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import { useCallback, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { serviceConsolePath } from '../../paths';
import { listSecurityGroupsByIds } from '../api';
import { useEc2Resource } from '../hooks';
import { SecurityGroupRulesTable } from './SecurityGroupRulesTable';

export interface InstanceSecurityTabProps {
  instanceId: string;
  /**
   * Security group ids from the instance description. Only the serialized ids
   * drive the fetch: a polling refresh returns a new array object every time,
   * which used to trigger an extra DescribeSecurityGroups call every 10 s.
   */
  securityGroupIds: readonly string[];
  /** Service descriptor id, so links do not hardcode `ec2` (EC2-D04). */
  serviceId: string;
}

/**
 * The console's Security tab: one section per security group the instance
 * belongs to, with its inbound and outbound rules and a link into the group's
 * own console page. Security groups here are read-only because editing them
 * belongs to the group, not the instance — the group page has the editor.
 */
export function InstanceSecurityTab({
  instanceId,
  securityGroupIds,
  serviceId,
}: InstanceSecurityTabProps): ReactElement {
  const navigate = useNavigate();
  const idsKey = securityGroupIds.join(',');
  const loader = useCallback(
    () => listSecurityGroupsByIds(idsKey.length === 0 ? [] : idsKey.split(',')),
    [idsKey],
  );
  const { data, loading, error, reload } = useEc2Resource(loader);

  if (loading) {
    return (
      <Box textAlign="center" padding="l">
        <Spinner size="large" />
      </Box>
    );
  }

  if (error !== null) {
    return (
      <Alert
        type="error"
        header="Could not load the security groups"
        action={
          <Button
            onClick={() => {
              void reload();
            }}
          >
            Retry
          </Button>
        }
      >
        {error.message}
      </Alert>
    );
  }

  const groups = data ?? [];

  if (groups.length === 0) {
    return (
      <Container header={<Header variant="h2">Security groups</Header>}>
        <Box color="text-body-secondary">
          {securityGroupIds.length === 0
            ? `Instance ${instanceId} is not associated with any security group.`
            : `Instance ${instanceId} reports security group ids that LocalStack no longer returns. Refresh the instance to reconcile them.`}
        </Box>
      </Container>
    );
  }

  const groupPath = (groupId: string): string =>
    `${serviceConsolePath(serviceId)}/security-groups/${encodeURIComponent(groupId)}`;

  return (
    <SpaceBetween size="l">
      {groups.map((group) => (
        <Container
          key={group.groupId}
          header={
            <Header
              variant="h2"
              description={group.description}
              actions={
                <Button
                  onClick={() => {
                    void navigate(groupPath(group.groupId));
                  }}
                >
                  View security group
                </Button>
              }
            >
              {group.groupName}{' '}
              <Link
                href={groupPath(group.groupId)}
                onFollow={(event) => {
                  event.preventDefault();
                  void navigate(groupPath(group.groupId));
                }}
              >
                ({group.groupId})
              </Link>
            </Header>
          }
        >
          <SpaceBetween size="l">
            <SpaceBetween size="xs">
              <Box variant="h3">Inbound rules</Box>
              <SecurityGroupRulesTable rules={group.inbound} direction="inbound" />
            </SpaceBetween>
            <SpaceBetween size="xs">
              <Box variant="h3">Outbound rules</Box>
              <SecurityGroupRulesTable rules={group.outbound} direction="outbound" />
            </SpaceBetween>
          </SpaceBetween>
        </Container>
      ))}
    </SpaceBetween>
  );
}

export default InstanceSecurityTab;
