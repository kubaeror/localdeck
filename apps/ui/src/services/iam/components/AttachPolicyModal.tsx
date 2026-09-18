import type { ApiError } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import { useEffect, useState, type ReactElement } from 'react';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { toApiError } from '../../../lib/apiClient';
import { attachPolicy, listAttachedPolicies, type AttachedEntityKind } from '../api';
import { toFriendlyIamError } from '../errors';
import { PolicyPicker } from './PolicyPicker';

export interface AttachPolicyModalProps {
  entity: AttachedEntityKind;
  name: string;
  onDismiss: () => void;
  /** Called after the attach call finished, so the caller can refresh. */
  onAttached: () => void;
}

const ENTITY_LABEL: Readonly<Record<AttachedEntityKind, string>> = {
  user: 'user',
  group: 'group',
  role: 'role',
};

/**
 * The console's "Add permissions" modal: pick one or more managed policies and
 * attach them to a user, group or role. Already-attached policies are hidden
 * from the candidates, and each attach is reported individually so a partial
 * failure is never silently swallowed.
 */
export function AttachPolicyModal({
  entity,
  name,
  onDismiss,
  onAttached,
}: AttachPolicyModalProps): ReactElement {
  const flashbar = useFlashbar();
  const [attachedArns, setAttachedArns] = useState<readonly string[] | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAttachedPolicies(entity, name)
      .then((policies) => {
        if (cancelled) return;
        setAttachedArns(policies.map((policy) => policy.policyArn));
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setLoadError(toApiError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [entity, name]);

  const attach = async (): Promise<void> => {
    setSubmitting(true);
    setSubmitError(null);
    const succeeded: string[] = [];
    const failures: { arn: string; message: string }[] = [];
    for (const policyArn of selected) {
      try {
        await attachPolicy(entity, name, policyArn);
        succeeded.push(policyArn);
      } catch (caught) {
        failures.push({ arn: policyArn, message: toFriendlyIamError(caught).message });
      }
    }
    setSubmitting(false);

    // The candidates and the selection reflect the partial result: attached
    // policies disappear from the picker, failed ones stay selected for retry.
    setAttachedArns((previous) => [...(previous ?? []), ...succeeded]);
    setSelected(failures.map((failure) => failure.arn));

    if (failures.length > 0) {
      setSubmitError(
        `Some policies could not be attached. ${failures
          .map((failure) => `${failure.arn}: ${failure.message}`)
          .join(' ')}`,
      );
      onAttached();
      return;
    }

    flashbar.notify({
      type: 'success',
      header: succeeded.length === 1 ? 'Policy attached' : 'Policies attached',
      content: `The ${ENTITY_LABEL[entity]} ${name} now has ${succeeded.length} more attached ${succeeded.length === 1 ? 'policy' : 'policies'}.`,
    });
    onAttached();
    onDismiss();
  };

  return (
    <Modal
      visible
      onDismiss={() => {
        if (!submitting) onDismiss();
      }}
      header={`Add permissions to ${name}`}
      size="large"
      closeAriaLabel="Close add permissions"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={submitting} onClick={onDismiss}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={submitting}
              disabled={selected.length === 0 || loadError !== null}
              onClick={() => {
                void attach();
              }}
            >
              Attach policies
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {submitError === null ? null : <Alert type="error">{submitError}</Alert>}

        {loadError === null ? null : (
          <Alert type="error" header="Could not load the attached policies">
            {loadError.message}
          </Alert>
        )}

        {attachedArns === null && loadError === null ? (
          <Box textAlign="center" padding="l">
            <Spinner size="large" />
          </Box>
        ) : (
          <PolicyPicker
            excludeArns={attachedArns ?? []}
            selectedArns={selected}
            onChange={setSelected}
            disabled={submitting}
          />
        )}
      </SpaceBetween>
    </Modal>
  );
}

export default AttachPolicyModal;
