import type { AwsTag } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState, type ReactElement, type ReactNode } from 'react';
import { TagsEditor, validateTags } from '../../../components/TagsEditor';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { normalizeTags, tagResource, untagResource, type EksCluster } from '../api';
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
 * edit. Saving is blocked while the tag set violates the AWS rules, and a
 * partial failure reports exactly which keys were applied.
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
  const problems = validateTags(edited);
  const changed = draft !== null && JSON.stringify(edited) !== JSON.stringify(tags);
  const arn = cluster.arn;

  const save = async (): Promise<void> => {
    // EKS exposes no request token for tagging: a second save while the first
    // is in flight would replay the same diff and race the first response.
    if (saving) return;
    if (arn === undefined) {
      setSaveError(
        'LocalStack did not report an ARN for this cluster, so LocalDeck cannot tag it.',
      );
      return;
    }
    if (problems.length > 0) return;

    setSaving(true);
    setSaveError(null);

    const current = normalizeTags(tags);
    const next = normalizeTags(edited);
    const loadedByKey = new Map(current.map((tag) => [tag.Key, tag.Value]));
    const editedByKey = new Map(next.map((tag) => [tag.Key, tag.Value]));
    const upserts = next.filter((tag) => loadedByKey.get(tag.Key) !== tag.Value);
    const removedKeys = current.filter((tag) => !editedByKey.has(tag.Key)).map((tag) => tag.Key);

    const applied: string[] = [];
    const failures: string[] = [];

    if (upserts.length > 0) {
      try {
        await tagResource(arn, upserts);
        applied.push(...upserts.map((tag) => tag.Key));
      } catch (caught) {
        failures.push(toFriendlyEksError(caught).message);
      }
    }
    if (removedKeys.length > 0) {
      try {
        await untagResource(arn, removedKeys);
        applied.push(...removedKeys.map((key) => `removed ${key}`));
      } catch (caught) {
        failures.push(toFriendlyEksError(caught).message);
      }
    }

    if (failures.length > 0) {
      setSaveError(
        `${failures.join(' ')}${applied.length === 0 ? '' : ` Already applied: ${applied.join(', ')}.`}`,
      );
      setSaving(false);
      return;
    }

    setDraft(null);
    flashbar.notify({ type: 'success', header: 'Tags saved', content: arn });
    onSaved?.();
    setSaving(false);
  };

  return (
    <Container header={<Header variant="h2">Tags</Header>}>
      <Form
        actions={
          <Button
            variant="primary"
            loading={saving}
            disabled={saving || !changed || problems.length > 0 || arn === undefined}
            onClick={() => {
              void save();
            }}
          >
            Save changes
          </Button>
        }
      >
        <SpaceBetween size="m">
          {arn === undefined ? (
            <Alert type="warning" header="Cluster ARN not reported">
              DescribeCluster did not return an ARN for this cluster, so TagResource and
              UntagResource cannot be called for it. Refresh the page; if LocalStack still omits the
              ARN, manage tags outside LocalDeck.
            </Alert>
          ) : null}
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
