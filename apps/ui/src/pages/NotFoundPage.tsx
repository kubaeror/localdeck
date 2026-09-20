import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ContentLayout from '@cloudscape-design/components/content-layout';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { CONSOLE_HOME_PATH } from '../services/paths';

export function NotFoundPage(): ReactElement {
  const navigate = useNavigate();

  return (
    <ContentLayout>
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="m">
          <Box variant="h1">Page not found</Box>
          <Box variant="p" color="inherit">
            This part of the LocalDeck console does not exist (yet).
          </Box>
          <Box margin={{ top: 'xs' }}>
            <Button
              variant="primary"
              onClick={() => {
                void navigate(CONSOLE_HOME_PATH);
              }}
            >
              Back to Console Home
            </Button>
          </Box>
        </SpaceBetween>
      </Box>
    </ContentLayout>
  );
}
