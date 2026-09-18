import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { ReactElement } from 'react';

export interface FullAdminConfirmModalProps {
  visible: boolean;
  /** "policy" / "role" — used in the wording. */
  subject: string;
  /** The warnings from `policyWarnings()`; rendered verbatim. */
  warnings: readonly string[];
  busy?: boolean;
  onDismiss: () => void;
  onConfirm: () => void;
}

/**
 * Confirmation shown when a policy grants every action on every resource
 * (Action "*" + Resource "*" + Allow). The real console warns about full
 * administrative access; saving stays possible after an explicit confirmation.
 */
export function FullAdminConfirmModal({
  visible,
  subject,
  warnings,
  busy = false,
  onDismiss,
  onConfirm,
}: FullAdminConfirmModalProps): ReactElement {
  return (
    <Modal
      visible={visible}
      onDismiss={busy ? () => undefined : onDismiss}
      header="Save a policy with full administrative access?"
      size="medium"
      closeAriaLabel="Close full administrative access warning"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={busy} onClick={onDismiss}>
              Go back
            </Button>
            <Button variant="primary" loading={busy} onClick={onConfirm}>
              Save anyway
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <Alert type="warning" header="This grants full administrative access">
          The {subject} allows every action on every resource. Anyone it is attached to can do
          anything in this account.
        </Alert>
        {warnings.map((warning) => (
          <Box key={warning} variant="small">
            {warning}
          </Box>
        ))}
      </SpaceBetween>
    </Modal>
  );
}

export default FullAdminConfirmModal;
