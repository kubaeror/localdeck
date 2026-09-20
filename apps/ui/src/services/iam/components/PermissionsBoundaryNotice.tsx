import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { ReactElement } from 'react';
import { InfoTooltip } from '../../../components/InfoTooltip';
import type { IamPermissionsBoundary } from '../api';

export interface PermissionsBoundaryNoticeProps {
  entity: 'user' | 'role';
  name: string;
  /** The boundary `GetUser`/`GetRole` reported; undefined when none is set. */
  boundary?: IamPermissionsBoundary;
}

const WRITE_REASON =
  'LocalDeck reads a permissions boundary from GetUser/GetRole, but PutUserPermissionsBoundary / PutRolePermissionsBoundary and DeleteUserPermissionsBoundary / DeleteRolePermissionsBoundary are not whitelisted yet, so setting or removing a boundary is not available here.';

/**
 * The console's permissions-boundary surface. `GetUser`/`GetRole` report the
 * boundary ARN, so the notice renders it read-only with its policy type; the
 * write operations are not whitelisted, which the disabled action explains
 * instead of pretending the boundary state does not exist.
 */
export function PermissionsBoundaryNotice({
  entity,
  name,
  boundary,
}: PermissionsBoundaryNoticeProps): ReactElement {
  const identity = entity === 'user' ? 'user' : 'role';
  return (
    <Container
      header={
        <Header
          variant="h2"
          description="A permissions boundary is an advanced feature that sets the maximum permissions an identity can have."
        >
          Permissions boundary
        </Header>
      }
    >
      <SpaceBetween size="s">
        {boundary === undefined ? (
          <Box>
            The {identity}{' '}
            <Box variant="code" display="inline">
              {name}
            </Box>{' '}
            does not have a permissions boundary set.
          </Box>
        ) : (
          <>
            <Box>
              The {identity}{' '}
              <Box variant="code" display="inline">
                {name}
              </Box>{' '}
              uses the following managed policy as its permissions boundary.
            </Box>
            <KeyValuePairs
              columns={2}
              items={[
                {
                  label: 'Boundary policy ARN',
                  value: <Box variant="code">{boundary.arn}</Box>,
                },
                {
                  label: 'Policy type',
                  value: boundary.scope === 'AWS' ? 'AWS managed' : 'Customer managed',
                },
              ]}
            />
          </>
        )}
        <InfoTooltip content={WRITE_REASON}>
          <Button disabled>
            {boundary === undefined ? 'Set permissions boundary' : 'Change permissions boundary'}
          </Button>
        </InfoTooltip>
      </SpaceBetween>
    </Container>
  );
}

export default PermissionsBoundaryNotice;
