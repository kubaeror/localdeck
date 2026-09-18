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
import SpaceBetween from '@cloudscape-design/components/space-between';
import Toggle from '@cloudscape-design/components/toggle';
import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreateWizard } from '../../../components/CreateWizard';
import { TagsEditor } from '../../../components/TagsEditor';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import { createAccessKey, createUser, type CreatedAccessKey } from '../api';
import { toFriendlyIamError } from '../errors';
import { IAM_USER_NAME_RULES, validateUserName } from '../naming';
import { AccessKeySecret } from '../components/AccessKeySecret';

/** Drops tag rows the user added but never filled in. */
function meaningfulTags(tags: readonly AwsTag[]): readonly AwsTag[] {
  return tags.filter((tag) => tag.Key.trim().length > 0 || tag.Value.trim().length > 0);
}

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
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [nameError, setNameError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [credentials, setCredentials] = useState<CreatedAccessKey | null>(null);
  const [createdUserName, setCreatedUserName] = useState('');

  const userPath = `${serviceConsolePath(descriptor.id)}/users/${encodeURIComponent(createdUserName)}`;

  const leave = (): void => {
    navigate(`${serviceConsolePath(descriptor.id)}/users`);
  };

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    setNameError(null);
    try {
      await createUser({ userName, tags: meaningfulTags(tags) });
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

    if (!programmaticAccess) {
      setSubmitting(false);
      navigate(`${serviceConsolePath(descriptor.id)}/users/${encodeURIComponent(userName)}`);
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
      navigate(`${serviceConsolePath(descriptor.id)}/users/${encodeURIComponent(userName)}`);
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
              label: 'Tags',
              value:
                meaningfulTags(tags).length === 0
                  ? 'No tags'
                  : meaningfulTags(tags)
                      .map((tag) => `${tag.Key}=${tag.Value}`)
                      .join(', '),
            },
          ]}
        />
        <Alert type="info" header="What happens next">
          LocalDeck creates the user
          {programmaticAccess ? ', then creates an access key pair and shows the secret once' : ''}
          {meaningfulTags(tags).length > 0 ? ', with the tags applied in the same call' : ''}.
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
            id: 'tags',
            title: 'Tags',
            isOptional: true,
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
          { label: 'Tags', value: `${meaningfulTags(tags).length}` },
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
            navigate(userPath);
          }}
          header="Access key created"
          size="medium"
          closeAriaLabel="Close access key"
          footer={
            <Box float="right">
              <Button
                variant="primary"
                onClick={() => {
                  navigate(userPath);
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
