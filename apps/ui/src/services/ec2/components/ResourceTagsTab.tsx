import type { AwsTag } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState, type ReactElement, type ReactNode } from 'react';
import { TagsEditor } from '../../../components/TagsEditor';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { createTags, deleteTags } from '../api';
import { toFriendlyEc2Error } from '../errors';

export interface ResourceTagsTabProps {
  /** EC2 resource id (`i-…`, `vol-…`, `sg-…`). */
  resourceId: string;
  /** Tags the parent page loaded; the editor starts from these. */
  tags: readonly AwsTag[];
  description?: ReactNode;
  /** Called after a successful save so the parent can reload its resource. */
  onSaved?: () => void;
}

/**
 * The Tags tab for EC2 resources. EC2 has no "replace all tags" call, so saving
 * applies the difference between the loaded set and the edited one through
 * `CreateTags`/`DeleteTags` — the same approach the IAM module uses for its
 * per-key tag APIs.
 *
 * The editor keeps a draft only while the user is editing (`null` means "show
 * the parent's tags"), so a background refresh never overwrites an unsaved edit
 * and no effect has to synchronize the two states.
 */
export function ResourceTagsTab({
  resourceId,
  tags,
  description = 'Tags are key-value pairs applied to this resource, useful for cost allocation and search. Saving applies only the changed keys.',
  onSaved,
}: ResourceTagsTabProps): ReactElement {
  const flashbar = useFlashbar();
  const [draft, setDraft] = useState<readonly AwsTag[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const edited = draft ?? tags;
  const changed = draft !== null && JSON.stringify(edited) !== JSON.stringify(tags);

  const save = async (): Promise<void> => {
    setSaving(true);
    setSaveError(null);
    try {
      const savedByKey = new Map(tags.map((tag) => [tag.Key, tag.Value]));
      const editedByKey = new Map(edited.map((tag) => [tag.Key, tag.Value]));
      const upserts = edited.filter((tag) => savedByKey.get(tag.Key) !== tag.Value);
      const removedKeys = tags.filter((tag) => !editedByKey.has(tag.Key)).map((tag) => tag.Key);

      if (upserts.length > 0) await createTags([resourceId], upserts);
      if (removedKeys.length > 0) await deleteTags([resourceId], removedKeys);

      setDraft(null);
      flashbar.notify({ type: 'success', header: 'Tags saved', content: resourceId });
      onSaved?.();
    } catch (caught) {
      setSaveError(toFriendlyEc2Error(caught).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Container header={<Header variant="h2">Tags</Header>}>
      <Form
        actions={
          <Button
            variant="primary"
            loading={saving}
            disabled={!changed}
            onClick={() => {
              void save();
            }}
          >
            Save changes
          </Button>
        }
      >
        <SpaceBetween size="m">
          {saveError === null ? null : <Alert type="error">{saveError}</Alert>}
          <TagsEditor tags={[...edited]} onChange={setDraft} description={description} />
        </SpaceBetween>
      </Form>
    </Container>
  );
}

export default ResourceTagsTab;
