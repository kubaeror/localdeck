import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { ReactElement } from 'react';
import { InfoTooltip } from '../../../components/InfoTooltip';

export interface PermissionsBoundaryNoticeProps {
  entity: 'user' | 'role';
  name: string;
}

const REASON =
  'PutUserPermissionsBoundary / PutRolePermissionsBoundary and their Get/Delete counterparts are not whitelisted in LocalDeck yet, so permissions boundaries cannot be read or written here.';

/**
 * The console's permissions-boundary surface, rendered as an explicitly
 * disabled action: LocalDeck does not call the permissions-boundary operations
 * yet (they are not in the registry whitelist), and hiding the feature would
 * pretend the boundary state does not exist.
 */
export function PermissionsBoundaryNotice({
  entity,
  name,
}: PermissionsBoundaryNoticeProps): ReactElement {
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
        <Box>
          {entity === 'user' ? 'The user' : 'The role'}{' '}
          <Box variant="code" display="inline">
            {name}
          </Box>{' '}
          may have a permissions boundary set outside LocalDeck, but Describe
          {entity === 'user' ? 'User' : 'Role'} does not report one that LocalDeck can read.
        </Box>
        <InfoTooltip content={REASON}>
          <Button disabled>Set permissions boundary</Button>
        </InfoTooltip>
      </SpaceBetween>
    </Container>
  );
}

export default PermissionsBoundaryNotice;
