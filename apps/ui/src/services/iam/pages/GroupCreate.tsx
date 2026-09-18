import type { ApiError } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Multiselect from '@cloudscape-design/components/multiselect';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreateWizard } from '../../../components/CreateWizard';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { toApiError } from '../../../lib/apiClient';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import { addUserToGroup, attachPolicy, createGroup, listAllUsers } from '../api';
import { PolicyPicker } from '../components/PolicyPicker';
import { toFriendlyIamError } from '../errors';
import { IAM_GROUP_NAME_RULES, validateGroupName } from '../naming';

/**
 * The console's create-group wizard: name the group, optionally add members and
 * attach managed policies, then review. The group is created first; every
 * membership and policy attach that follows reports its own failure instead of
 * hiding a partial result.
 */
export function GroupCreatePage({ descriptor }: ServicePageProps): ReactElement {
  const navigate = useNavigate();
  const flashbar = useFlashbar();
  const [groupName, setGroupName] = useState('');
  const [policyArns, setPolicyArns] = useState<readonly string[]>([]);
  const [members, setMembers] = useState<readonly string[]>([]);
  const [userNames, setUserNames] = useState<readonly string[]>([]);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [nameError, setNameError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAllUsers()
      .then((result) => {
        if (cancelled) return;
        setUserNames(result.map((user) => user.userName));
        setMembersError(null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setMembersError(toApiError(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    let membersAdded = 0;
    let policiesAttached = 0;
    for (const userName of members) {
      try {
        await addUserToGroup({ userName, groupName });
        membersAdded += 1;
      } catch (caught) {
        failures.push(`${userName}: ${toFriendlyIamError(caught).message}`);
      }
    }
    for (const policyArn of policyArns) {
      try {
        await attachPolicy('group', groupName, policyArn);
        policiesAttached += 1;
      } catch (caught) {
        failures.push(`${policyArn}: ${toFriendlyIamError(caught).message}`);
      }
    }

    flashbar.notify({
      type: 'success',
      header: 'Group created',
      content:
        members.length === 0 && policyArns.length === 0
          ? groupName
          : `${groupName} with ${membersAdded} member(s) and ${policiesAttached} attached ${policiesAttached === 1 ? 'policy' : 'policies'}.`,
    });
    for (const failure of failures) {
      flashbar.notify({ type: 'error', header: 'Could not finish a group step', content: failure });
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

  const membersStep = (
    <Container header={<Header variant="h2">Add users</Header>}>
      <SpaceBetween size="m">
        <Alert type="info">
          Optional. Members inherit the permissions attached to this group. You can change the
          membership later from the group&apos;s Users tab.
        </Alert>
        {membersError === null ? null : <Alert type="warning">{membersError}</Alert>}
        <Multiselect
          selectedOptions={members.map((userName) => ({ label: userName, value: userName }))}
          options={userNames.map((userName) => ({ label: userName, value: userName }))}
          filteringType="auto"
          filteringPlaceholder="Find users"
          placeholder={userNames.length === 0 ? 'No users exist yet' : 'Choose users'}
          tokenLimit={8}
          disabled={submitting}
          ariaLabel="Members"
          onChange={({ detail }) => {
            setMembers(
              detail.selectedOptions
                .map((option) => option.value ?? '')
                .filter((value) => value.length > 0),
            );
          }}
        />
      </SpaceBetween>
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
              label: 'Members to add',
              value:
                members.length === 0
                  ? 'None'
                  : `${members.length} selected (added after the group is created)`,
            },
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
          LocalDeck creates the group, then adds the selected users and attaches the selected
          policies one by one. A failed step names the user or policy instead of hiding the group.
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
          id: 'members',
          title: 'Add users',
          description: 'Optional. Add the first members.',
          isOptional: true,
          content: membersStep,
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
        { label: 'Members', value: `${members.length}` },
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
