import type { ApiError } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreateWizard } from '../../../components/CreateWizard';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import { attachPolicy, createGroup } from '../api';
import { PolicyPicker } from '../components/PolicyPicker';
import { toFriendlyIamError } from '../errors';
import { IAM_GROUP_NAME_RULES, validateGroupName } from '../naming';

/**
 * The console's create-group wizard: name the group, optionally attach managed
 * policies, review. The group is created first; every policy attach that
 * follows reports its own failure instead of hiding a partial result.
 */
export function GroupCreatePage({ descriptor }: ServicePageProps): ReactElement {
  const navigate = useNavigate();
  const flashbar = useFlashbar();
  const [groupName, setGroupName] = useState('');
  const [policyArns, setPolicyArns] = useState<readonly string[]>([]);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [nameError, setNameError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const leave = (): void => {
    navigate(`${serviceConsolePath(descriptor.id)}/groups`);
  };

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    setNameError(null);
    try {
      await createGroup(groupName);
    } catch (caught) {
      const friendly = toFriendlyIamError(caught, 'groupName');
      if (friendly.field === 'groupName') {
        setNameError(friendly.message);
        setActiveStepIndex(0);
      } else {
        setError({ ...friendly.apiError, message: friendly.message });
      }
      setSubmitting(false);
      return;
    }

    const failures: string[] = [];
    for (const policyArn of policyArns) {
      try {
        await attachPolicy('group', groupName, policyArn);
      } catch (caught) {
        failures.push(`${policyArn}: ${toFriendlyIamError(caught).message}`);
      }
    }

    flashbar.notify({
      type: 'success',
      header: 'Group created',
      content:
        policyArns.length === 0
          ? groupName
          : `${groupName} with ${policyArns.length - failures.length} attached ${
              policyArns.length - failures.length === 1 ? 'policy' : 'policies'
            }.`,
    });
    for (const failure of failures) {
      flashbar.notify({ type: 'error', header: 'Could not attach a policy', content: failure });
    }

    setSubmitting(false);
    navigate(`${serviceConsolePath(descriptor.id)}/groups/${encodeURIComponent(groupName)}`);
  };

  const detailsStep = (
    <Container header={<Header variant="h2">Group details</Header>}>
      <Form>
        <FormField
          label="Group name"
          description="Groups are collections of users that share permissions."
          errorText={nameError ?? undefined}
          constraintText={<Box variant="small">{IAM_GROUP_NAME_RULES.join(' · ')}</Box>}
        >
          <Input
            value={groupName}
            autoFocus
            disabled={submitting}
            placeholder="developers"
            onChange={({ detail }) => {
              setGroupName(detail.value);
              setNameError(null);
            }}
          />
        </FormField>
      </Form>
    </Container>
  );

  const policiesStep = (
    <Container header={<Header variant="h2">Attach policies</Header>}>
      <SpaceBetween size="m">
        <Alert type="info">
          Attached policies grant every member of the group their permissions. You can also attach
          policies later from the group&apos;s Permissions tab.
        </Alert>
        <PolicyPicker selectedArns={policyArns} onChange={setPolicyArns} disabled={submitting} />
      </SpaceBetween>
    </Container>
  );

  const reviewStep = (
    <Container header={<Header variant="h2">Review</Header>}>
      <SpaceBetween size="m">
        <KeyValuePairs
          columns={1}
          items={[
            { label: 'Group name', value: <Box variant="code">{groupName}</Box> },
            {
              label: 'Policies to attach',
              value:
                policyArns.length === 0
                  ? 'None'
                  : `${policyArns.length} selected (attached after the group is created)`,
            },
          ]}
        />
        <Alert type="info" header="What happens next">
          LocalDeck creates the group, then attaches the selected policies one by one. A failed
          attach names the policy instead of hiding the group.
        </Alert>
      </SpaceBetween>
    </Container>
  );

  return (
    <CreateWizard
      title="Create user group"
      description={descriptor.summary}
      breadcrumbs={[
        { text: descriptor.displayName, href: serviceConsolePath(descriptor.id) },
        { text: 'User groups', href: `${serviceConsolePath(descriptor.id)}/groups` },
        { text: 'Create user group' },
      ]}
      activeStepIndex={activeStepIndex}
      steps={[
        {
          id: 'details',
          title: 'Group details',
          description: 'Name the group.',
          validate: () => validateGroupName(groupName),
          content: detailsStep,
        },
        {
          id: 'policies',
          title: 'Attach policies',
          description: 'Optional. Grant the group permissions.',
          isOptional: true,
          content: policiesStep,
        },
        {
          id: 'review',
          title: 'Review and create',
          content: reviewStep,
        },
      ]}
      summary={[
        { label: 'Service', value: descriptor.displayName },
        { label: 'Group name', value: groupName.length === 0 ? '—' : groupName },
        { label: 'Policies', value: `${policyArns.length}` },
      ]}
      summaryTitle="Group summary"
      submitLabel="Create user group"
      submitting={submitting}
      error={error}
      onSubmit={submit}
      onCancel={leave}
      onStepChange={setActiveStepIndex}
    />
  );
}

export default GroupCreatePage;
