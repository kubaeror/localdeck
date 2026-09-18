import type { ApiError } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { toApiError } from '../../../lib/apiClient';
import { serviceConsolePath } from '../../paths';
import { getSecurityGroupsForInstance, type Ec2Instance, type Ec2SecurityGroup } from '../api';
import { SecurityGroupRulesTable } from './SecurityGroupRulesTable';

export interface InstanceSecurityTabProps {
  instance: Ec2Instance;
}

/**
 * The console's Security tab: one section per security group the instance
 * belongs to, with its inbound and outbound rules and a link into the group's
 * own console page. Security groups here are read-only because editing them
 * belongs to the group, not the instance — the group page has the editor.
 */
export function InstanceSecurityTab({ instance }: InstanceSecurityTabProps): ReactElement {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<readonly Ec2SecurityGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const id = requestId.current + 1;
    requestId.current = id;
    setLoading(true);
    try {
      const result = await getSecurityGroupsForInstance(instance);
      if (requestId.current !== id) return;
      setGroups(result);
      setError(null);
    } catch (caught) {
      if (requestId.current !== id) return;
      setError(toApiError(caught));
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [instance]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- security group fetch for the tab
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

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
              void load();
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

  if (groups.length === 0) {
    return (
      <Container header={<Header variant="h2">Security groups</Header>}>
        <Box color="text-body-secondary">
          This instance is not associated with any security group.
        </Box>
      </Container>
    );
  }

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
                    navigate(
                      `${serviceConsolePath('ec2')}/security-groups/${encodeURIComponent(group.groupId)}`,
                    );
                  }}
                >
                  View security group
                </Button>
              }
            >
              {group.groupName}{' '}
              <Link
                href={`${serviceConsolePath('ec2')}/security-groups/${encodeURIComponent(group.groupId)}`}
                onFollow={(event) => {
                  event.preventDefault();
                  navigate(
                    `${serviceConsolePath('ec2')}/security-groups/${encodeURIComponent(group.groupId)}`,
                  );
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
