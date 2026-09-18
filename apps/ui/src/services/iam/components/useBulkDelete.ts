import { useCallback, useState } from 'react';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { toFriendlyIamError } from '../errors';

export interface BulkDeleteState<T> {
  /** Selected rows while the confirmation modal is open. */
  targets: readonly T[] | null;
  deleting: boolean;
  /** Per-row failures; the modal stays open while this is non-empty. */
  failures: readonly string[];
  requestDelete: (items: readonly T[]) => void;
  dismiss: () => void;
  confirm: () => Promise<void>;
}

export interface BulkDeleteOptions<T> {
  /** Singular resource noun used in the flashbar wording, e.g. "user". */
  noun: string;
  /** Row label for notifications and failure messages. */
  label: (item: T) => string;
  remove: (item: T) => Promise<void>;
  /** Called after the batch finishes so the list can reload. */
  onCompleted: () => void;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
}

/**
 * The bulk-delete state machine shared by the IAM users, roles and groups
 * lists: selection → confirmation modal → sequential deletes → success
 * flashbar, or a per-row failure summary that keeps the modal open for a
 * retry. Previously each list re-implemented this and closed the modal even
 * when every delete failed.
 */
export function useBulkDelete<T>(options: BulkDeleteOptions<T>): BulkDeleteState<T> {
  const { notify } = useFlashbar();
  const [targets, setTargets] = useState<readonly T[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [failures, setFailures] = useState<readonly string[]>([]);

  const requestDelete = useCallback((items: readonly T[]) => {
    if (items.length === 0) return;
    setFailures([]);
    setTargets(items);
  }, []);

  const dismiss = useCallback(() => {
    setTargets(null);
    setFailures([]);
  }, []);

  const confirm = useCallback(async (): Promise<void> => {
    const items = targets ?? [];
    if (items.length === 0) return;

    setDeleting(true);
    setFailures([]);
    const deleted: string[] = [];
    const failed: string[] = [];
    const remaining: T[] = [];
    for (const item of items) {
      try {
        await options.remove(item);
        deleted.push(options.label(item));
      } catch (caught) {
        failed.push(`${options.label(item)}: ${toFriendlyIamError(caught).message}`);
        remaining.push(item);
      }
    }
    setDeleting(false);
    options.onCompleted();

    if (failed.length > 0) {
      // Keep the modal open with the failure summary so the user can retry the
      // rows that failed; the successfully deleted rows are gone.
      setTargets(remaining);
      setFailures(failed);
      return;
    }

    const noun = options.noun;
    notify({
      type: 'success',
      header: deleted.length === 1 ? `${capitalize(noun)} deleted` : `${capitalize(noun)}s deleted`,
      content: deleted.join(', '),
    });
    setTargets(null);
  }, [notify, options, targets]);

  return { targets, deleting, failures, requestDelete, dismiss, confirm };
}
