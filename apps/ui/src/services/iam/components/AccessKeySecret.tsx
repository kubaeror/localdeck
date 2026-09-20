import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import CopyToClipboard from '@cloudscape-design/components/copy-to-clipboard';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { ReactElement } from 'react';
import type { CreatedAccessKey } from '../api';
import { accessKeyCsv } from './accessKeyCsv';

export interface AccessKeySecretProps {
  accessKey: CreatedAccessKey;
}

/** Downloads the key pair as a CSV file, deferring the object-URL revoke. */
function downloadCsv(accessKey: CreatedAccessKey): void {
  const blob = new Blob([accessKeyCsv(accessKey)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `accessKeys-${accessKey.userName ?? 'localdeck'}.csv`;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Firefox needs the URL to stay valid until the click has been handled.
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 0);
  }
}

/**
 * The access key pair the console shows once after creation: both halves with
 * copy controls and the CSV download. Shared by the create-user wizard and the
 * security credentials tab so the ceremony reads exactly the same in both
 * places.
 */
export function AccessKeySecret({ accessKey }: AccessKeySecretProps): ReactElement {
  return (
    <SpaceBetween size="m">
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
      <Button
        iconName="download"
        onClick={() => {
          downloadCsv(accessKey);
        }}
      >
        Download .csv
      </Button>
    </SpaceBetween>
  );
}

export default AccessKeySecret;
