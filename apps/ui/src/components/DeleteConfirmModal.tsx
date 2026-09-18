import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState, type ReactElement, type ReactNode } from 'react';

export interface DeleteConfirmModalProps {
  visible: boolean;
  /** Modal title, e.g. "Delete bucket". */
  title: string;
  /** Human names of the resources being deleted. */
  subjects: readonly string[];
  /** Consequence text, in console wording. */
  description: ReactNode;
  /**
   * Text the user must type to unlock the destructive action. Defaults to the
   * single subject (the console's "type the bucket name" pattern); pass
   * something like `delete` when several resources are selected.
   */
  confirmationText?: string;
  submitLabel?: string;
  loading?: boolean;
  /** Failure from the delete call, rendered inside the modal. */
  errorText?: ReactNode;
  onDismiss: () => void;
  onConfirm: () => void;
}

/**
 * The console's destructive-action confirmation: a warning, the consequences,
 * the affected resources, and a typed confirmation before the button unlocks.
 * Modules compose it for single-row and bulk deletes alike.
 */
export function DeleteConfirmModal({
  visible,
  title,
  subjects,
  description,
  confirmationText,
  submitLabel = 'Delete',
  loading = false,
  errorText,
  onDismiss,
  onConfirm,
}: DeleteConfirmModalProps): ReactElement {
  const required = confirmationText ?? (subjects.length === 1 ? (subjects[0] ?? '') : 'delete');
  // Mount the modal per deletion (the caller renders it only while open), so
  // every opening starts from an empty confirmation field.
  const [typed, setTyped] = useState('');

  const confirmed = typed === required && required.length > 0;

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header={title}
      size="medium"
      closeAriaLabel={`Close ${title}`}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss}>
              Cancel
            </Button>
            <Button variant="primary" loading={loading} disabled={!confirmed} onClick={onConfirm}>
              {submitLabel}
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {errorText === undefined ? null : <Alert type="error">{errorText}</Alert>}

        <Alert type="warning">{description}</Alert>

        {subjects.length === 0 ? null : (
          <SpaceBetween size="xs">
            {subjects.length > 1 ? (
              <Box color="text-body-secondary">
                {subjects.length} resources are affected by this deletion.
              </Box>
            ) : null}
            <SpaceBetween size="xxs">
              {subjects.slice(0, 20).map((subject) => (
                <Box key={subject} variant="code">
                  {subject}
                </Box>
              ))}
            </SpaceBetween>
            {subjects.length > 20 ? (
              <Box color="text-body-secondary">…and {subjects.length - 20} more</Box>
            ) : null}
          </SpaceBetween>
        )}

        <FormField
          label={`To confirm deletion, type "${required}" in the field below.`}
          errorText={
            typed.length > 0 && !confirmed ? `Enter "${required}" to continue.` : undefined
          }
        >
          <Input
            value={typed}
            autoFocus
            disabled={loading}
            ariaLabel={`Confirm deletion of ${subjects.join(', ')}`}
            onChange={({ detail }) => {
              setTyped(detail.value);
            }}
          />
        </FormField>
      </SpaceBetween>
    </Modal>
  );
}
