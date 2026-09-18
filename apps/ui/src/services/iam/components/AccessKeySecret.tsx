import Box from '@cloudscape-design/components/box';
import CopyToClipboard from '@cloudscape-design/components/copy-to-clipboard';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { ReactElement } from 'react';
import type { CreatedAccessKey } from '../api';

export interface AccessKeySecretProps {
  accessKey: CreatedAccessKey;
}

/**
 * The access key pair the console shows once after creation: both halves with
 * copy controls. Shared by the create-user wizard and the security credentials
 * tab so the ceremony reads exactly the same in both places.
 */
export function AccessKeySecret({ accessKey }: AccessKeySecretProps): ReactElement {
  return (
    <KeyValuePairs
      columns={1}
      items={[
        {
          label: 'Access key',
          value: (
            <SpaceBetween direction="horizontal" size="xxs">
              <Box variant="code">{accessKey.accessKeyId}</Box>
              <CopyToClipboard
                variant="icon"
                textToCopy={accessKey.accessKeyId}
                copyButtonAriaLabel="Copy access key"
                copySuccessText="Access key copied"
                copyErrorText="Could not copy the access key"
              />
            </SpaceBetween>
          ),
        },
        {
          label: 'Secret access key',
          value: (
            <SpaceBetween direction="horizontal" size="xxs">
              <Box variant="code">{accessKey.secretAccessKey}</Box>
              <CopyToClipboard
                variant="icon"
                textToCopy={accessKey.secretAccessKey}
                copyButtonAriaLabel="Copy secret access key"
                copySuccessText="Secret access key copied"
                copyErrorText="Could not copy the secret access key"
              />
            </SpaceBetween>
          ),
        },
      ]}
    />
  );
}

export default AccessKeySecret;
