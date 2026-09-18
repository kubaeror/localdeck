import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState, type ReactElement } from 'react';
import { createFolder } from '../api';
import { toFriendlyS3Error } from '../errors';
import { normalizePrefix, validateObjectKey } from '../naming';

export interface CreateFolderModalProps {
  visible: boolean;
  bucket: string;
  /** Folder the new folder is created in; `''` means the bucket root. */
  prefix: string;
  onDismiss: () => void;
  /** Called with the new folder key after it was created. */
  onCreated: (key: string) => void;
}

/**
 * "Create folder" is a zero-byte object whose key ends with `/` — the same
 * thing the AWS console does, and what makes the folder show up in S3 APIs.
 */
export function CreateFolderModal({
  visible,
  bucket,
  prefix,
  onDismiss,
  onCreated,
}: CreateFolderModalProps): ReactElement {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const dismiss = (): void => {
    if (creating) return;
    setName('');
    setErrorText(null);
    onDismiss();
  };

  const folderName = name.trim().replace(/^\/+|\/+$/g, '');
  const key = `${prefix}${folderName}/`;
  const problem = folderName.length === 0 ? 'Enter a folder name.' : validateObjectKey(key);
  // No trailing slash at the bucket root, one separator inside a folder.
  const location =
    prefix.length === 0 ? `s3://${bucket}` : `s3://${bucket}/${normalizePrefix(prefix)}`;

  const submit = async (): Promise<void> => {
    setCreating(true);
    setErrorText(null);
    try {
      await createFolder({ bucket, prefix: normalizePrefix(prefix), name: folderName });
      setName('');
      onCreated(key);
      onDismiss();
    } catch (caught) {
      setErrorText(toFriendlyS3Error(caught).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      visible={visible}
      onDismiss={dismiss}
      header="Create folder"
      closeAriaLabel="Close create folder"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={creating} onClick={dismiss}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={creating}
              disabled={problem !== null}
              onClick={() => {
                void submit();
              }}
            >
              Create folder
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Form>
        <SpaceBetween size="m">
          <FormField
            label="Folder name"
            description={`Created at ${location}`}
            errorText={name.length > 0 && problem !== null ? problem : (errorText ?? undefined)}
          >
            <Input
              value={name}
              autoFocus
              disabled={creating}
              placeholder="folder-name"
              onChange={({ detail }) => {
                setName(detail.value);
                setErrorText(null);
              }}
            />
          </FormField>
        </SpaceBetween>
      </Form>
    </Modal>
  );
}

export default CreateFolderModal;
