import type { ApiError, AwsTag } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { TagsEditor } from '../../../components/TagsEditor';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { toApiError } from '../../../lib/apiClient';
import { listRoleTags, listUserTags, putRoleTags, putUserTags } from '../api';
import { toFriendlyIamError } from '../errors';

export interface TagsTabProps {
  /** Which resource's tag API to use; both services behave identically. */
  entity: 'user' | 'role';
  name: string;
}

/**
 * The Tags tab for users and roles: IAM stores tags per key (`Tag*`/`Untag*`),
 * so saving applies the difference between the loaded set and the edited one.
 */
export function TagsTab({ entity, name }: TagsTabProps): ReactElement {
  const flashbar = useFlashbar();
  const [tags, setTags] = useState<readonly AwsTag[]>([]);
  const [savedTags, setSavedTags] = useState<readonly AwsTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const id = requestId.current + 1;
    requestId.current = id;
    setLoading(true);
    try {
      const result = entity === 'user' ? await listUserTags(name) : await listRoleTags(name);
      if (requestId.current !== id) return;
      setTags(result);
      setSavedTags(result);
      setLoadError(null);
    } catch (caught) {
      if (requestId.current !== id) return;
      setLoadError(toApiError(caught));
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [entity, name]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tag list fetch
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  const changed = JSON.stringify(tags) !== JSON.stringify(savedTags);

  const save = async (): Promise<void> => {
    setSaving(true);
    setSaveError(null);
    try {
      if (entity === 'user') await putUserTags({ userName: name, tags });
      else await putRoleTags({ roleName: name, tags });
      setSavedTags(tags);
      flashbar.notify({ type: 'success', header: 'Tags saved', content: name });
    } catch (caught) {
      setSaveError(toFriendlyIamError(caught).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box textAlign="center" padding="l">
        <Spinner size="large" />
      </Box>
    );
  }

  if (loadError !== null) {
    return (
      <Alert
        type="error"
        header="Could not load the tags"
        action={
          <Button
            onClick={() => {
              void load();
            }}
          >
            Retry
          </Button>
        }
      >
        {loadError.message}
      </Alert>
    );
  }

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
            tags={tags}
            onChange={setTags}
            description="Tags are key-value pairs used for cost allocation, access control and search. Saving applies only the changed keys."
          />
        </SpaceBetween>
      </Form>
    </Container>
  );
}

export default TagsTab;
