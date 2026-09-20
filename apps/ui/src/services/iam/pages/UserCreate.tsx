import type { ApiError, AwsTag } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Modal from '@cloudscape-design/components/modal';
import Multiselect from '@cloudscape-design/components/multiselect';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Toggle from '@cloudscape-design/components/toggle';
import { useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreateWizard } from '../../../components/CreateWizard';
import { TagsEditor, validateTags } from '../../../components/TagsEditor';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { toApiError } from '../../../lib/apiClient';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import {
  addUserToGroup,
  createAccessKey,
  createUser,
  listAllGroups,
  normalizeTags,
  type CreatedAccessKey,
} from '../api';
import { toFriendlyIamError } from '../errors';
import { IAM_USER_NAME_RULES, validateUserName } from '../naming';
import { AccessKeySecret } from '../components/AccessKeySecret';

/**
 * The console's create-user wizard: name, programmatic access and tags. When
 * programmatic access is requested, the access key is created right after the
 * user and shown once in a modal before the wizard leaves the page.
 */
export function UserCreatePage({ descriptor }: ServicePageProps): ReactElement {
  const navigate = useNavigate();
  const flashbar = useFlashbar();
  const [userName, setUserName] = useState('');
  const [programmaticAccess, setProgrammaticAccess] = useState(true);
  const [tags, setTags] = useState<readonly AwsTag[]>([]);
  const [groups, setGroups] = useState<readonly string[]>([]);
  const [groupNames, setGroupNames] = useState<readonly string[]>([]);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [nameError, setNameError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [credentials, setCredentials] = useState<CreatedAccessKey | null>(null);
  const [createdUserName, setCreatedUserName] = useState('');

  const tagProblems = validateTags(tags);
  const tagsProblem =
    tagProblems.length === 0 ? null : tagProblems.map((problem) => problem.message).join(' ');
  const normalizedTags = normalizeTags(tags);

  useEffect(() => {
    let cancelled = false;
    listAllGroups()
      .then((result) => {
        if (cancelled) return;
        setGroupNames(result.map((group) => group.groupName));
        setGroupsError(null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setGroupsError(toApiError(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const userPath = `${serviceConsolePath(descriptor.id)}/users/${encodeURIComponent(createdUserName)}`;

  const leave = (): void => {
    void navigate(`${serviceConsolePath(descriptor.id)}/users`);
  };

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    setNameError(null);
    try {
      await createUser({ userName, tags: normalizedTags });
    } catch (caught) {
      const friendly = toFriendlyIamError(caught, 'userName');
      if (friendly.field === 'userName') {
        setNameError(friendly.message);
        setActiveStepIndex(0);
      } else {
        setError({ ...friendly.apiError, message: friendly.message });
      }
      setSubmitting(false);
      return;
    }

    flashbar.notify({ type: 'success', header: 'User created', content: userName });

    // Group memberships are best-effort after the user exists: a failed AddUserToGroup
    // names the group instead of hiding the created user.
    for (const groupName of groups) {
      try {
        await addUserToGroup({ userName, groupName });
      } catch (caught) {
        flashbar.notify({
          type: 'error',
          header: `User created, but could not join ${groupName}`,
          content: toFriendlyIamError(caught).message,
        });
      }
    }

    if (!programmaticAccess) {
      setSubmitting(false);
      void navigate(`${serviceConsolePath(descriptor.id)}/users/${encodeURIComponent(userName)}`);
      return;
    }

    try {
      const key = await createAccessKey(userName);
      setCreatedUserName(userName);
      setCredentials(key);
    } catch (caught) {
      flashbar.notify({
        type: 'error',
        header: 'User created, but the access key failed',
        content: toFriendlyIamError(caught).message,
      });
      void navigate(`${serviceConsolePath(descriptor.id)}/users/${encodeURIComponent(userName)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const detailsStep = (
    <Container header={<Header variant="h2">User details</Header>}>
      <Form>
        <FormField
          label="User name"
          description="The name identifies the user in this LocalStack account and its ARN."
          errorText={nameError ?? undefined}
          constraintText={<Box variant="small">{IAM_USER_NAME_RULES.join(' · ')}</Box>}
        >
          <Input
            value={userName}
            autoFocus
            disabled={submitting}
            placeholder="alice"
            onChange={({ detail }) => {
              setUserName(detail.value);
              setNameError(null);
            }}
          />
        </FormField>
      </Form>
    </Container>
  );

  const accessStep = (
    <Container header={<Header variant="h2">Access type</Header>}>
      <SpaceBetween size="m">
        <Toggle
          checked={programmaticAccess}
          onChange={({ detail }) => {
            setProgrammaticAccess(detail.checked);
          }}
        >
          Provide programmatic access
        </Toggle>

        {programmaticAccess ? (
          <Alert type="info" header="An access key pair will be created">
            The secret access key is shown only once, right after the user is created. Copy it
            before leaving the page; it cannot be retrieved again.
          </Alert>
        ) : (
          <Alert type="info">
            Without an access key this user cannot sign API requests. You can add one later from the
            user&apos;s Security credentials tab.
          </Alert>
        )}
      </SpaceBetween>
    </Container>
  );

  const groupsStep = (
    <Container header={<Header variant="h2">Groups</Header>}>
      <SpaceBetween size="m">
        <Alert type="info">
          Optional. Group memberships grant the policies attached to those groups. You can change
          them later from the user&apos;s Groups tab.
        </Alert>
        {groupsError === null ? null : <Alert type="warning">{groupsError}</Alert>}
        <Multiselect
          selectedOptions={groups.map((groupName) => ({ label: groupName, value: groupName }))}
          options={groupNames.map((groupName) => ({ label: groupName, value: groupName }))}
          filteringType="auto"
          filteringPlaceholder="Find groups"
          placeholder={groupNames.length === 0 ? 'No groups exist yet' : 'Choose groups'}
          tokenLimit={8}
          disabled={submitting}
          ariaLabel="Groups"
          onChange={({ detail }) => {
            setGroups(
              detail.selectedOptions
                .map((option) => option.value ?? '')
                .filter((value) => value.length > 0),
            );
          }}
        />
      </SpaceBetween>
    </Container>
  );

  const tagsStep = (
    <Container header={<Header variant="h2">Tags</Header>}>
      <TagsEditor
        tags={tags}
        onChange={setTags}
        description="Tags are key-value pairs applied to the user, useful for cost allocation and search."
      />
    </Container>
  );

  const reviewStep = (
    <Container header={<Header variant="h2">Review</Header>}>
      <SpaceBetween size="m">
        <KeyValuePairs
          columns={1}
          items={[
            { label: 'User name', value: <Box variant="code">{userName}</Box> },
            {
              label: 'Access type',
              value: programmaticAccess
                ? 'Programmatic access (access key)'
                : 'No programmatic access',
            },
            {
              label: 'Groups',
              value: groups.length === 0 ? 'None' : groups.join(', '),
            },
            {
              label: 'Tags',
              value:
                normalizedTags.length === 0
                  ? 'No tags'
                  : normalizedTags.map((tag) => `${tag.Key}=${tag.Value}`).join(', '),
            },
          ]}
        />
        <Alert type="info" header="What happens next">
          LocalDeck creates the user
          {groups.length > 0 ? `, adds them to ${groups.length} group(s)` : ''}
          {programmaticAccess ? ', creates an access key pair and shows the secret once' : ''}
          {normalizedTags.length > 0 ? ', with the tags applied in the same call' : ''}.
        </Alert>
      </SpaceBetween>
    </Container>
  );

  return (
    <>
      <CreateWizard
        title="Create user"
        description={descriptor.summary}
        breadcrumbs={[
          { text: descriptor.displayName, href: serviceConsolePath(descriptor.id) },
          { text: 'Users', href: `${serviceConsolePath(descriptor.id)}/users` },
          { text: 'Create user' },
        ]}
        activeStepIndex={activeStepIndex}
        steps={[
          {
            id: 'details',
            title: 'User details',
            description: 'Name the user.',
            validate: () => validateUserName(userName),
            content: detailsStep,
          },
          {
            id: 'access',
            title: 'Access type',
            description: 'Choose whether to create an access key.',
            content: accessStep,
          },
          {
            id: 'groups',
            title: 'Groups',
            description: 'Optional. Add the user to groups.',
            isOptional: true,
            content: groupsStep,
          },
          {
            id: 'tags',
            title: 'Tags',
            isOptional: true,
            validate: () => tagsProblem,
            content: tagsStep,
          },
          {
            id: 'review',
            title: 'Review and create',
            content: reviewStep,
          },
        ]}
        summary={[
          { label: 'Service', value: descriptor.displayName },
          { label: 'User name', value: userName.length === 0 ? '—' : userName },
          { label: 'Programmatic access', value: programmaticAccess ? 'Yes' : 'No' },
          { label: 'Groups', value: `${groups.length}` },
          { label: 'Tags', value: `${normalizedTags.length}` },
        ]}
        summaryTitle="User summary"
        submitLabel="Create user"
        submitting={submitting}
        error={error}
        onSubmit={submit}
        onCancel={leave}
        onStepChange={setActiveStepIndex}
      />

      {credentials === null ? null : (
        <Modal
          visible
          onDismiss={() => {
            void navigate(userPath);
          }}
          header="Access key created"
          size="medium"
          closeAriaLabel="Close access key"
          footer={
            <Box float="right">
              <Button
                variant="primary"
                onClick={() => {
                  void navigate(userPath);
                }}
              >
                Go to user
              </Button>
            </Box>
          }
        >
          <SpaceBetween size="m">
            <Alert type="warning" header="This is the only time the secret access key is shown">
              Store it now; LocalStack cannot return it again. If you lose it, delete the key and
              create a new one.
            </Alert>
            <AccessKeySecret accessKey={credentials} />
          </SpaceBetween>
        </Modal>
      )}
    </>
  );
}

export default UserCreatePage;
