import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FileUpload from '@cloudscape-design/components/file-upload';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Modal from '@cloudscape-design/components/modal';
import ProgressBar from '@cloudscape-design/components/progress-bar';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useEffect, useRef, useState, type ReactElement } from 'react';
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

/** S3 stores a single PUT object up to 5 GiB; the proxy mirrors that limit. */
const MAX_UPLOAD_BYTES = 5 * 1024 ** 3;

type UploadStatus = 'uploaded' | 'failed' | 'cancelled';

interface FileOutcome {
  name: string;
  status: UploadStatus;
}

const STATUS_LABEL: Readonly<Record<UploadStatus, string>> = {
  uploaded: 'Uploaded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const STATUS_INDICATOR: Readonly<Record<UploadStatus, 'success' | 'error' | 'stopped'>> = {
  uploaded: 'success',
  failed: 'error',
  cancelled: 'stopped',
};

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
  const [outcomes, setOutcomes] = useState<readonly FileOutcome[]>([]);
  const [errorText, setErrorText] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Leaving the page (or closing the dialog from the parent) must stop the
  // uploads; the per-file loop reports the aborted files as Cancelled.
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const reset = (): void => {
    setFiles([]);
    setErrorText(null);
    setProgress(null);
    setOutcomes([]);
  };

  const dismiss = (): void => {
    if (uploading) return;
    reset();
    onDismiss();
  };

  const oversized = files.filter((file) => file.size > MAX_UPLOAD_BYTES);
  const sizeProblem =
    oversized.length === 0
      ? null
      : `${oversized
          .map((file) => `"${file.name}"`)
          .join(', ')} exceed${oversized.length === 1 ? 's' : ''} the 5 GiB single-object limit.`;

  const upload = async (): Promise<void> => {
    if (sizeProblem !== null) return;
    setUploading(true);
    setErrorText(null);
    setOutcomes([]);

    const controller = new AbortController();
    abortRef.current = controller;
    const uploaded: string[] = [];
    const failures: string[] = [];
    const results: FileOutcome[] = [];
    setProgress({ done: 0, total: files.length });

    for (const file of files) {
      if (controller.signal.aborted) {
        results.push({ name: file.name, status: 'cancelled' });
        continue;
      }
      try {
        const result = await uploadObject({
          bucket,
          key: `${prefix}${file.name}`,
          file,
          signal: controller.signal,
        });
        uploaded.push(result.key);
        results.push({ name: file.name, status: 'uploaded' });
      } catch (caught) {
        if (controller.signal.aborted) {
          results.push({ name: file.name, status: 'cancelled' });
        } else {
          failures.push(`${file.name}: ${toFriendlyS3Error(caught).message}`);
          results.push({ name: file.name, status: 'failed' });
        }
      }
      setProgress({ done: results.length, total: files.length });
    }

    setUploading(false);
    setOutcomes(results);
    abortRef.current = null;

    if (controller.signal.aborted) {
      // The modal is gone (or going); nothing to report.
      setProgress(null);
      return;
    }
    if (failures.length > 0) {
      setErrorText(failures.join('\n'));
    }
    if (uploaded.length > 0) {
      onUploaded(uploaded);
    }
    if (failures.length === 0 && results.every((result) => result.status === 'uploaded')) {
      reset();
      onDismiss();
    }
  };

  const progressPercent =
    progress === null || progress.total === 0
      ? 100
      : Math.round((progress.done / progress.total) * 100);

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
              disabled={files.length === 0 || sizeProblem !== null}
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

          {outcomes.length === 0 ? null : (
            <SpaceBetween size="xxs">
              {outcomes.map((outcome) => (
                <StatusIndicator
                  key={outcome.name}
                  type={STATUS_INDICATOR[outcome.status]}
                >{`${outcome.name} — ${STATUS_LABEL[outcome.status]}`}</StatusIndicator>
              ))}
            </SpaceBetween>
          )}

          <FormField
            label="Files"
            description={`Uploaded to s3://${bucket}/${prefix} — large files are stored with the S3 multipart upload API.`}
            errorText={sizeProblem ?? undefined}
          >
            <FileUpload
              value={[...files]}
              multiple
              showFileSize
              onChange={({ detail }) => {
                setFiles(detail.value);
                setErrorText(null);
                setOutcomes([]);
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
              value={progressPercent}
              status="in-progress"
              description={`${progress.done} of ${progress.total} files processed`}
            />
          )}
        </SpaceBetween>
      </Form>
    </Modal>
  );
}

export default UploadModal;
