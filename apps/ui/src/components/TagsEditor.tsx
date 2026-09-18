import type { AwsTag } from '@localdeck/shared';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Table from '@cloudscape-design/components/table';
import type { TableProps } from '@cloudscape-design/components/table';
import { useMemo, type ReactElement, type ReactNode } from 'react';

/** AWS accepts at most 50 tags per resource. */
export const MAX_TAGS = 50;

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
}

/** Duplicate keys are rejected by AWS; surface them before the save call. */
function duplicateKeys(tags: readonly AwsTag[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const tag of tags) {
    if (seen.has(tag.Key)) duplicates.add(tag.Key);
    seen.add(tag.Key);
  }
  return [...duplicates];
}

/** Table row: the tag plus its position, so cells can edit by index. */
interface TagRow extends AwsTag {
  rowId: number;
}

/**
 * The console's tag editor: a table of Key/Value rows with per-row removal and
 * an "Add new tag" button, used by create wizards and detail pages. Validation
 * follows the service limits (50 keys, unique keys) before the save call.
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
}: TagsEditorProps): ReactElement {
  const duplicates = useMemo(() => duplicateKeys(tags), [tags]);
  const rows: readonly TagRow[] = useMemo(
    () => tags.map((tag, index) => ({ ...tag, rowId: index })),
    [tags],
  );

  const setTag = (index: number, next: AwsTag): void => {
    onChange(tags.map((tag, position) => (position === index ? next : tag)));
  };

  const removeTag = (index: number): void => {
    onChange(tags.filter((_tag, position) => position !== index));
  };

  const columns: TableProps.ColumnDefinition<TagRow>[] = [
    {
      id: 'key',
      header: 'Key',
      isRowHeader: true,
      cell: (row) =>
        readOnly ? (
          <Box variant="code">{row.Key}</Box>
        ) : (
          <Input
            value={row.Key}
            ariaLabel={`Tag key ${row.rowId + 1}`}
            placeholder="Key"
            onChange={({ detail }) => {
              setTag(row.rowId, { Key: detail.value, Value: row.Value });
            }}
          />
        ),
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
            ariaLabel={`Tag value ${row.rowId + 1}`}
            placeholder="Value"
            onChange={({ detail }) => {
              setTag(row.rowId, { Key: row.Key, Value: detail.value });
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
            removeTag(row.rowId);
          }}
        >
          Remove
        </Button>
      ),
    });
  }

  const problems: string[] = [];
  if (duplicates.length > 0) {
    problems.push(`Duplicate tag key: ${duplicates.join(', ')}.`);
  }
  if (tags.length > MAX_TAGS) {
    problems.push(`A resource can have at most ${MAX_TAGS} tags.`);
  }
  const fieldError = problems.length > 0 ? problems.join(' ') : errorText;

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
