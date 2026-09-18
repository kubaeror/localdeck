import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FileUpload from '@cloudscape-design/components/file-upload';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Modal from '@cloudscape-design/components/modal';
import ProgressBar from '@cloudscape-design/components/progress-bar';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState, type ReactElement } from 'react';
import { uploadObject } from '../api';
import { toFriendlyS3Error } from '../errors';

export interface UploadModalProps {
  visible: boolean;
  bucket: string;
  /** Folder the upload lands in; `''` means the bucket root. */
  prefix: string;
  onDismiss: () => void;
  /** Called once every file was stored; the caller refreshes the browser. */
  onUploaded: (keys: readonly string[]) => void;
}

/**
 * The console's upload dialog. Each file is POSTed to the api's multipart
 * proxy, which streams it into S3 (using the S3 multipart upload API for large
 * objects); the browser never buffers more than the selected file.
 */
export function UploadModal({
  visible,
  bucket,
  prefix,
  onDismiss,
  onUploaded,
}: UploadModalProps): ReactElement {
  const [files, setFiles] = useState<readonly File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const reset = (): void => {
    setFiles([]);
    setErrorText(null);
    setProgress(null);
  };

  const dismiss = (): void => {
    if (uploading) return;
    reset();
    onDismiss();
  };

  const upload = async (): Promise<void> => {
    setUploading(true);
    setErrorText(null);
    const uploaded: string[] = [];
    const failures: string[] = [];

    for (const file of files) {
      setProgress({ done: uploaded.length + failures.length + 1, total: files.length });
      try {
        const result = await uploadObject({ bucket, key: `${prefix}${file.name}`, file });
        uploaded.push(result.key);
      } catch (caught) {
        failures.push(`${file.name}: ${toFriendlyS3Error(caught).message}`);
      }
    }

    setUploading(false);
    setProgress(null);
    if (failures.length > 0) {
      setErrorText(failures.join('\n'));
    }
    if (uploaded.length > 0) {
      onUploaded(uploaded);
    }
    if (failures.length === 0) {
      reset();
      onDismiss();
    }
  };

  return (
    <Modal
      visible={visible}
      onDismiss={dismiss}
      header="Upload objects"
      size="large"
      closeAriaLabel="Close upload objects"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={uploading} onClick={dismiss}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={uploading}
              disabled={files.length === 0}
              onClick={() => {
                void upload();
              }}
            >
              Upload
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Form>
        <SpaceBetween size="m">
          {errorText === null ? null : (
            <Alert type="error" header="Some files were not uploaded">
              {errorText}
            </Alert>
          )}

          <FormField
            label="Files"
            description={`Uploaded to s3://${bucket}/${prefix} — large files are stored with the S3 multipart upload API.`}
          >
            <FileUpload
              value={[...files]}
              multiple
              showFileSize
              onChange={({ detail }) => {
                setFiles(detail.value);
                setErrorText(null);
              }}
              i18nStrings={{
                uploadButtonText: (multiple) => (multiple ? 'Choose files' : 'Choose file'),
                dropzoneText: (multiple) =>
                  multiple ? 'Drop files to upload' : 'Drop file to upload',
                removeFileAriaLabel: (fileIndex) => `Remove file ${fileIndex + 1}`,
                limitShowFewer: 'Show fewer files',
                limitShowMore: 'Show more files',
                errorIconAriaLabel: 'Error',
              }}
            />
          </FormField>

          {progress === null ? null : (
            <ProgressBar
              value={Math.round(((progress.done - 1) / progress.total) * 100)}
              status="in-progress"
              description={`Uploading file ${progress.done} of ${progress.total}`}
            />
          )}
        </SpaceBetween>
      </Form>
    </Modal>
  );
}

export default UploadModal;
