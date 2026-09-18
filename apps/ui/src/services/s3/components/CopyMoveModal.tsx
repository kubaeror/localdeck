import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState, type ReactElement } from 'react';
import { copyObject, moveObject, type S3Bucket, type S3ObjectEntry } from '../api';
import { toFriendlyS3Error } from '../errors';
import { normalizePrefix } from '../naming';

export interface CopyMoveModalProps {
  mode: 'copy' | 'move';
  sourceBucket: string;
  source: S3ObjectEntry;
  buckets: readonly S3Bucket[];
  /** Destination prefix the dialog starts from; usually the current folder. */
  defaultPrefix?: string;
  onDismiss: () => void;
  /** Called after the object was copied or moved. */
  onDone: (message: string) => void;
}

/**
 * Copy/move one object to another bucket or folder, like the console. The
 * caller mounts this only while it is open, so every use starts fresh.
 */
export function CopyMoveModal({
  mode,
  sourceBucket,
  source,
  buckets,
  defaultPrefix = '',
  onDismiss,
  onDone,
}: CopyMoveModalProps): ReactElement {
  const [destinationBucket, setDestinationBucket] = useState(sourceBucket);
  const [destinationPrefix, setDestinationPrefix] = useState(defaultPrefix);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const fileName = source.key.split('/').pop() ?? '';
  const destinationKey = `${normalizePrefix(destinationPrefix)}${fileName}`;
  const parentPrefix = source.key.slice(0, source.key.length - fileName.length);
  const sameLocation =
    destinationBucket === sourceBucket && normalizePrefix(destinationPrefix) === parentPrefix;
  const problem =
    fileName.length === 0
      ? 'The selected entry has no file name.'
      : sameLocation
        ? mode === 'move'
          ? 'The destination is the same as the source.'
          : 'The destination is the same as the source; choose another bucket or folder.'
        : null;

  const dismiss = (): void => {
    if (busy) return;
    onDismiss();
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setErrorText(null);
    try {
      const input = {
        sourceBucket,
        sourceKey: source.key,
        destinationBucket,
        destinationKey,
      };
      if (mode === 'copy') await copyObject(input);
      else await moveObject(input);
      onDone(
        mode === 'copy'
          ? `Copied ${source.key} to ${destinationBucket}/${destinationKey}.`
          : `Moved ${source.key} to ${destinationBucket}/${destinationKey}.`,
      );
    } catch (caught) {
      setErrorText(toFriendlyS3Error(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible
      onDismiss={dismiss}
      header={mode === 'copy' ? 'Copy object' : 'Move object'}
      closeAriaLabel={`Close ${mode} object`}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={busy} onClick={dismiss}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={problem !== null}
              onClick={() => {
                void submit();
              }}
            >
              {mode === 'copy' ? 'Copy' : 'Move'}
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Form>
        <SpaceBetween size="m">
          <FormField label="Source">
            <Box variant="code">
              s3://{sourceBucket}/{source.key}
            </Box>
          </FormField>

          <FormField label="Destination bucket">
            <Select
              selectedOption={{ value: destinationBucket, label: destinationBucket }}
              disabled={busy}
              options={buckets.map((bucket) => ({ value: bucket.name, label: bucket.name }))}
              onChange={({ detail }) => {
                setDestinationBucket(detail.selectedOption.value ?? destinationBucket);
              }}
            />
          </FormField>

          <FormField
            label="Destination folder"
            description="Leave empty to place the object at the bucket root."
            errorText={problem ?? errorText ?? undefined}
          >
            <Input
              value={destinationPrefix}
              disabled={busy}
              placeholder="path/to/folder/"
              onChange={({ detail }) => {
                setDestinationPrefix(detail.value);
              }}
            />
          </FormField>

          <FormField label="Destination">
            <Box variant="code">
              s3://{destinationBucket}/{destinationPrefix}
              {fileName}
            </Box>
          </FormField>
        </SpaceBetween>
      </Form>
    </Modal>
  );
}

export default CopyMoveModal;
