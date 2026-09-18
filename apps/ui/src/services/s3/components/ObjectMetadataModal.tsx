import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import CopyToClipboard from '@cloudscape-design/components/copy-to-clipboard';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Modal from '@cloudscape-design/components/modal';
import Spinner from '@cloudscape-design/components/spinner';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { JsonEditor } from '../../../components/JsonEditor';
import { formatBytes, formatDateTime } from '../../../lib/format';
import { stringifyJson } from '../../../lib/json';
import { headObject, type S3ObjectEntry, type S3ObjectMetadata } from '../api';
import { toFriendlyS3Error } from '../errors';

export interface ObjectMetadataModalProps {
  bucket: string;
  entry: S3ObjectEntry;
  onDismiss: () => void;
  onDownload: () => void;
}

/**
 * The console's object metadata view: HeadObject results as key-value pairs,
 * the user-defined metadata, and the raw response for the JSON-minded. The
 * caller mounts it only while it is open, so it loads once per open.
 */
export function ObjectMetadataModal({
  bucket,
  entry,
  onDismiss,
  onDownload,
}: ObjectMetadataModalProps): ReactElement {
  const [metadata, setMetadata] = useState<S3ObjectMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (): Promise<void> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setErrorText(null);
    try {
      const result = await headObject({
        bucket,
        key: entry.key,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setMetadata(result);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setErrorText(toFriendlyS3Error(caught).message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [bucket, entry.key]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- object metadata fetch
    void load();
    return () => {
      // Invalidate the request if the modal closes while it is in flight.
      abortRef.current?.abort();
    };
  }, [load]);

  const userMetadata = Object.entries(metadata?.metadata ?? {});

  return (
    <Modal
      visible
      onDismiss={onDismiss}
      header="Object metadata"
      size="large"
      closeAriaLabel="Close object metadata"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss}>
              Close
            </Button>
            <Button variant="primary" disabled={metadata === null} onClick={onDownload}>
              Download
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="l">
        {errorText === null ? null : (
          <Alert
            type="error"
            header="Could not read object metadata"
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
            {errorText}
          </Alert>
        )}

        {loading ? (
          <Box textAlign="center" padding="l">
            <Spinner size="large" />
          </Box>
        ) : null}

        {metadata === null ? null : (
          <>
            <KeyValuePairs
              columns={2}
              items={[
                {
                  label: 'Key',
                  value: (
                    <SpaceBetween direction="horizontal" size="xxs">
                      <Box variant="code">{metadata.key}</Box>
                      <CopyToClipboard
                        variant="icon"
                        textToCopy={metadata.key}
                        copyButtonAriaLabel="Copy key"
                        copySuccessText="Key copied"
                        copyErrorText="Could not copy the key"
                      />
                    </SpaceBetween>
                  ),
                },
                { label: 'Bucket', value: <Box variant="code">{metadata.bucket}</Box> },
                { label: 'Size', value: formatBytes(metadata.size ?? 0) },
                { label: 'Last modified', value: formatDateTime(metadata.lastModified) },
                { label: 'ETag', value: <Box variant="code">{metadata.etag ?? '—'}</Box> },
                { label: 'Content type', value: metadata.contentType ?? '—' },
                { label: 'Content encoding', value: metadata.contentEncoding ?? '—' },
                { label: 'Content disposition', value: metadata.contentDisposition ?? '—' },
                { label: 'Cache control', value: metadata.cacheControl ?? '—' },
                { label: 'Storage class', value: metadata.storageClass ?? 'STANDARD' },
                { label: 'Version ID', value: metadata.versionId ?? '—' },
              ]}
            />

            <KeyValuePairs
              columns={1}
              items={[
                {
                  label: 'User metadata (x-amz-meta-*)',
                  value:
                    userMetadata.length === 0 ? (
                      <Box color="text-body-secondary">No user metadata</Box>
                    ) : (
                      <SpaceBetween size="xxs">
                        {userMetadata.map(([name, value]) => (
                          <Box key={name} variant="code">
                            {name} = {value}
                          </Box>
                        ))}
                      </SpaceBetween>
                    ),
                },
              ]}
            />

            <JsonEditor
              label="HeadObject response"
              value={stringifyJson(metadata.raw)}
              rows={12}
              ariaLabel="HeadObject response"
            />
          </>
        )}
      </SpaceBetween>
    </Modal>
  );
}

export default ObjectMetadataModal;
