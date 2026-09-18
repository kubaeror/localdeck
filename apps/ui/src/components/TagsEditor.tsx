import type { AwsTag } from '@localdeck/shared';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import type { TableProps } from '@cloudscape-design/components/table';
import { useEffect, useMemo, useRef, type ReactElement, type ReactNode } from 'react';

/** AWS accepts at most 50 tags per resource. */
export const MAX_TAGS = 50;

/** What is wrong with a tag set, in a form the save button can consume. */
export type TagProblemCode = 'duplicate-key' | 'empty-key' | 'too-many-tags';

export interface TagProblem {
  code: TagProblemCode;
  /** Row position the problem points at, when it points at a single row. */
  index?: number;
  /** Duplicate keys, so the editor can mark the affected inputs. */
  keys?: readonly string[];
  message: string;
}

/**
 * Validates a tag set against the AWS limits. `[]` means the set can be saved;
 * anything else is what the caller must block the save on. Exported so create
 * wizards and detail pages use exactly the same rules the editor shows.
 */
export function validateTags(tags: readonly AwsTag[]): readonly TagProblem[] {
  const problems: TagProblem[] = [];
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  tags.forEach((tag, index) => {
    const key = tag.Key.trim();
    if (key.length === 0) {
      problems.push({
        code: 'empty-key',
        index,
        message: 'Tag keys cannot be empty or whitespace.',
      });
      return;
    }
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  });

  if (duplicates.size > 0) {
    const keys = [...duplicates];
    problems.push({
      code: 'duplicate-key',
      keys,
      message: `Duplicate tag key: ${keys.join(', ')}.`,
    });
  }
  if (tags.length > MAX_TAGS) {
    problems.push({
      code: 'too-many-tags',
      message: `A resource can have at most ${MAX_TAGS} tags.`,
    });
  }

  return problems;
}

/** Table row: the tag, a stable identity and its 1-based display position. */
interface TagRow extends AwsTag {
  rowId: number;
  position: number;
}

interface TagRowState {
  entries: readonly { tag: AwsTag; rowId: number }[];
  nextId: number;
}

/**
 * Assigns stable, monotonic row ids. Unchanged tag objects keep their id, an
 * edited tag keeps the id of the position it replaced, and only genuinely new
 * rows get a new id — so removing a middle row never re-keys the rows after it
 * and editing a row never remounts its input (which would drop focus).
 */
function reconcileRows(tags: readonly AwsTag[], previous: TagRowState): TagRowState {
  const slots = previous.entries.map((entry) => ({ entry, used: false }));
  const rowIds = new Array<number | undefined>(tags.length).fill(undefined);

  // Pass 1: rows that were not edited keep their identity.
  tags.forEach((tag, index) => {
    const identity = slots.find((slot) => !slot.used && slot.entry.tag === tag);
    if (identity !== undefined) {
      identity.used = true;
      rowIds[index] = identity.entry.rowId;
    }
  });

  // Pass 2: an edited row is a new object at the position it replaced.
  tags.forEach((_tag, index) => {
    if (rowIds[index] !== undefined) return;
    const positional = slots[index];
    if (positional !== undefined && !positional.used) {
      positional.used = true;
      rowIds[index] = positional.entry.rowId;
    }
  });

  // Pass 3: added rows get the next id.
  let nextId = previous.nextId;
  tags.forEach((_tag, index) => {
    if (rowIds[index] !== undefined) return;
    rowIds[index] = nextId;
    nextId += 1;
  });

  return {
    entries: tags.map((tag, index) => ({ tag, rowId: rowIds[index] ?? index })),
    nextId,
  };
}

export interface TagsEditorProps {
  tags: readonly AwsTag[];
  onChange: (tags: readonly AwsTag[]) => void;
  readOnly?: boolean;
  label?: string;
  description?: ReactNode;
  /** Failure from the save call, rendered by the field. */
  errorText?: ReactNode;
  addButtonLabel?: string;
  emptyTitle?: string;
  /**
   * Called whenever the tag set's validity changes. Save buttons should be
   * disabled while `problems.length > 0` (or when the prop is absent, call
   * `validateTags(tags)` directly before submitting).
   */
  onValidityChange?: (problems: readonly TagProblem[]) => void;
}

/**
 * The console's tag editor: a table of Key/Value rows with per-row removal and
 * an "Add new tag" button, used by create wizards and detail pages. Validation
 * follows the service limits (50 keys, unique non-empty keys) and is surfaced
 * both on the field and per row.
 */
export function TagsEditor({
  tags,
  onChange,
  readOnly = false,
  label = 'Tags',
  description,
  errorText,
  addButtonLabel = 'Add new tag',
  emptyTitle = 'No tags',
  onValidityChange,
}: TagsEditorProps): ReactElement {
  const rowStateRef = useRef<TagRowState>({ entries: [], nextId: 1 });
  const rows: readonly TagRow[] = useMemo(() => {
    /* eslint-disable react-hooks/refs -- The row-id cache is derived state, not
       a render input: `reconcileRows` is deterministic for the same `tags`
       array, so StrictMode double renders produce identical ids. Keeping DOM
       identity stable across row removals is not possible without it. */
    const next = reconcileRows(tags, rowStateRef.current);
    rowStateRef.current = next;
    /* eslint-enable react-hooks/refs */
    return next.entries.map((entry, index) => ({
      ...entry.tag,
      rowId: entry.rowId,
      position: index + 1,
    }));
  }, [tags]);

  const problems = useMemo(() => validateTags(tags), [tags]);
  const duplicateKeys = useMemo(
    () => new Set(problems.flatMap((problem) => problem.keys ?? [])),
    [problems],
  );
  const emptyRows = useMemo(
    () =>
      new Set(problems.flatMap((problem) => (problem.code === 'empty-key' ? [problem.index] : []))),
    [problems],
  );

  // The callback is held in a ref so an inline handler from the parent cannot
  // restart the effect on every render.
  const onValidityChangeRef = useRef(onValidityChange);
  useEffect(() => {
    onValidityChangeRef.current = onValidityChange;
  });
  useEffect(() => {
    onValidityChangeRef.current?.(problems);
  }, [problems]);

  const setTag = (index: number, next: AwsTag): void => {
    onChange(tags.map((tag, position) => (position === index ? next : tag)));
  };

  const removeTag = (index: number): void => {
    onChange(tags.filter((_tag, position) => position !== index));
  };

  const keyCell = (row: TagRow): ReactNode => {
    if (readOnly) return <Box variant="code">{row.Key}</Box>;
    const key = row.Key.trim();
    const isDuplicate = duplicateKeys.has(key);
    const isEmpty = emptyRows.has(row.position - 1);
    const rowProblems = [
      ...(isEmpty ? ['Tag keys cannot be empty or whitespace.'] : []),
      ...(isDuplicate ? [`“${key}” is used by more than one tag.`] : []),
    ];
    return (
      <SpaceBetween size="xxs">
        <Input
          value={row.Key}
          ariaLabel={`Tag key ${row.position}`}
          placeholder="Key"
          invalid={isEmpty || isDuplicate}
          onChange={({ detail }) => {
            setTag(row.position - 1, { Key: detail.value, Value: row.Value });
          }}
        />
        {rowProblems.length === 0 ? null : (
          <Box variant="small" color="text-status-error">
            {rowProblems.join(' ')}
          </Box>
        )}
      </SpaceBetween>
    );
  };

  const columns: TableProps.ColumnDefinition<TagRow>[] = [
    {
      id: 'key',
      header: 'Key',
      isRowHeader: true,
      cell: keyCell,
    },
    {
      id: 'value',
      header: 'Value',
      cell: (row) =>
        readOnly ? (
          row.Value.length === 0 ? (
            <Box color="text-body-secondary">(empty)</Box>
          ) : (
            <Box>{row.Value}</Box>
          )
        ) : (
          <Input
            value={row.Value}
            ariaLabel={`Tag value ${row.position}`}
            placeholder="Value"
            onChange={({ detail }) => {
              setTag(row.position - 1, { Key: row.Key, Value: detail.value });
            }}
          />
        ),
    },
  ];

  if (!readOnly) {
    columns.push({
      id: 'remove',
      header: '',
      width: 90,
      cell: (row) => (
        <Button
          variant="inline-link"
          ariaLabel={`Remove tag ${row.Key}`}
          onClick={() => {
            removeTag(row.position - 1);
          }}
        >
          Remove
        </Button>
      ),
    });
  }

  const fieldError =
    problems.length > 0 ? problems.map((problem) => problem.message).join(' ') : errorText;

  return (
    <FormField
      label={label}
      description={description}
      errorText={fieldError}
      constraintText={readOnly ? undefined : `${tags.length} of ${MAX_TAGS} tag keys used.`}
    >
      <Table<TagRow>
        variant="embedded"
        items={[...rows]}
        columnDefinitions={columns}
        trackBy={(row) => String(row.rowId)}
        ariaLabels={{ tableLabel: label, selectionGroupLabel: `${label} selection` }}
        empty={
          <Box textAlign="center" color="text-body-secondary">
            {emptyTitle}. {readOnly ? 'No tags are attached to this resource.' : 'Add a tag below.'}
          </Box>
        }
        header={
          readOnly ? undefined : (
            <Button
              iconName="add-plus"
              disabled={tags.length >= MAX_TAGS}
              onClick={() => {
                onChange([...tags, { Key: '', Value: '' }]);
              }}
            >
              {addButtonLabel}
            </Button>
          )
        }
      />
    </FormField>
  );
}
