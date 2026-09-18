import Box from '@cloudscape-design/components/box';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import {
  colorBackgroundContainerContent,
  colorBorderDividerDefault,
} from '@cloudscape-design/design-tokens';
import type { ReactElement } from 'react';

/**
 * Application footer. The trademark notice below is a legal requirement for
 * this project and must not be removed or reworded.
 */
export function AppFooter(): ReactElement {
  return (
    <footer
      style={{
        borderTop: `1px solid ${colorBorderDividerDefault}`,
        background: colorBackgroundContainerContent,
      }}
    >
      <Box padding={{ vertical: 's', horizontal: 'l' }}>
        <SpaceBetween size="xxs">
          <Box variant="small" color="text-body-secondary">
            LocalDeck is an open-source console for LocalStack, the local cloud emulator. LocalStack
            and this console run independently: LocalDeck never starts, stops or reconfigures your
            emulator.
          </Box>
          <Box variant="small" color="text-body-secondary">
            Amazon Web Services, AWS and the Powered by AWS logo are trademarks of Amazon.com, Inc.
            or its affiliates. LocalDeck is not affiliated with or endorsed by Amazon Web Services.
          </Box>
          <Box variant="small">
            <Link
              href="https://docs.localstack.cloud/"
              external
              ariaLabel="LocalStack documentation (opens in a new tab)"
            >
              LocalStack documentation
            </Link>
          </Box>
        </SpaceBetween>
      </Box>
    </footer>
  );
}
