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
import { tagResource, untagResource, type EksCluster } from '../api';
import { toFriendlyEksError } from '../errors';

export interface ClusterTagsTabProps {
  cluster: EksCluster;
  description?: ReactNode;
  /** Called after a successful save so the parent can reload the cluster. */
  onSaved?: () => void;
}

/**
 * The cluster's Tags tab. EKS exposes key-level tagging (TagResource /
 * UntagResource), so saving applies the difference between the loaded set and
 * the edited one — the cluster itself is never recreated.
 *
 * The editor keeps a draft only while the user is editing (`null` means "show
 * the cluster's tags"), so a background refresh never overwrites an unsaved
 * edit.
 */
export function ClusterTagsTab({
  cluster,
  description,
  onSaved,
}: ClusterTagsTabProps): ReactElement {
  const flashbar = useFlashbar();
  const [draft, setDraft] = useState<readonly AwsTag[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const tags = cluster.tags;
  const edited = draft ?? tags;
  const changed = draft !== null && JSON.stringify(edited) !== JSON.stringify(tags);

  const save = async (): Promise<void> => {
    setSaving(true);
    setSaveError(null);
    try {
      const loadedByKey = new Map(tags.map((tag) => [tag.Key, tag.Value]));
      const editedByKey = new Map(edited.map((tag) => [tag.Key, tag.Value]));
      const upserts = edited.filter((tag) => loadedByKey.get(tag.Key) !== tag.Value);
      const removedKeys = tags.filter((tag) => !editedByKey.has(tag.Key)).map((tag) => tag.Key);

      if (upserts.length > 0) await tagResource(cluster.arn, upserts);
      if (removedKeys.length > 0) await untagResource(cluster.arn, removedKeys);

      setDraft(null);
      flashbar.notify({ type: 'success', header: 'Tags saved', content: cluster.arn });
      onSaved?.();
    } catch (caught) {
      setSaveError(toFriendlyEksError(caught).message);
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
          <TagsEditor
            tags={[...edited]}
            onChange={setDraft}
            description={
              description ??
              'Tags applied to the cluster ARN. Saving applies only the changed keys through TagResource and UntagResource; the cluster keeps running.'
            }
          />
        </SpaceBetween>
      </Form>
    </Container>
  );
}

export default ClusterTagsTab;
