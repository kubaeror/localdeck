import type { ApiError, AwsTag } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Multiselect from '@cloudscape-design/components/multiselect';
import RadioGroup from '@cloudscape-design/components/radio-group';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreateWizard } from '../../../components/CreateWizard';
import { JsonEditor } from '../../../components/JsonEditor';
import { TagsEditor } from '../../../components/TagsEditor';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import { attachPolicy, createRole } from '../api';
import { PolicyPicker } from '../components/PolicyPicker';
import { toFriendlyIamError } from '../errors';
import { IAM_ROLE_NAME_RULES, validateRoleName } from '../naming';
import {
  buildTrustPolicyForAccount,
  buildTrustPolicyForService,
  summarizeTrustedEntities,
  TRUSTED_SERVICE_PRINCIPALS,
  validateTrustPolicy,
} from '../policy';

type TrustedEntityType = 'service' | 'account' | 'custom';

/** Drops tag rows the user added but never filled in. */
function meaningfulTags(tags: readonly AwsTag[]): readonly AwsTag[] {
  return tags.filter((tag) => tag.Key.trim().length > 0 || tag.Value.trim().length > 0);
}

/**
 * The console's create-role wizard: trusted entity (AWS service, another AWS
 * account, or a custom trust policy), permissions, name and tags, review. The
 * trust policy is generated from the selection for the first two modes, so the
 * user never has to write JSON unless they choose to.
 */
export function RoleCreatePage({ descriptor }: ServicePageProps): ReactElement {
  const navigate = useNavigate();
  const flashbar = useFlashbar();
  const [entityType, setEntityType] = useState<TrustedEntityType>('service');
  const [services, setServices] = useState<readonly string[]>([]);
  const [accountId, setAccountId] = useState('');
  const [customTrustPolicy, setCustomTrustPolicy] = useState(() =>
    buildTrustPolicyForService(['lambda.amazonaws.com']),
  );
  const [roleName, setRoleName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<readonly AwsTag[]>([]);
  const [policyArns, setPolicyArns] = useState<readonly string[]>([]);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [nameError, setNameError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const trustPolicy =
    entityType === 'service'
      ? buildTrustPolicyForService(services)
      : entityType === 'account'
        ? buildTrustPolicyForAccount(accountId.trim())
        : customTrustPolicy;

  const leave = (): void => {
    navigate(`${serviceConsolePath(descriptor.id)}/roles`);
  };

  const trustProblem = (): string | null => {
    if (entityType === 'service') {
      return services.length === 0 ? 'Select at least one AWS service.' : null;
    }
    if (entityType === 'account') {
      return /^\d{12}$/.test(accountId.trim())
        ? null
        : 'Enter the 12-digit AWS account ID that should be able to assume the role.';
    }
    const validation = validateTrustPolicy(customTrustPolicy);
    if (validation.jsonError !== null) {
      return `The trust policy is not valid JSON: ${validation.jsonError}`;
    }
    if (validation.structureErrors.length > 0) return validation.structureErrors.join(' ');
    return null;
  };

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    setNameError(null);
    try {
      await createRole({
        roleName,
        trustPolicy,
        ...(description.trim().length === 0 ? {} : { description: description.trim() }),
        tags: meaningfulTags(tags),
      });
    } catch (caught) {
      const friendly = toFriendlyIamError(caught, 'roleName');
      if (friendly.field === 'roleName') {
        setNameError(friendly.message);
        setActiveStepIndex(2);
      } else {
        setError({ ...friendly.apiError, message: friendly.message });
      }
      setSubmitting(false);
      return;
    }

    const failures: string[] = [];
    for (const policyArn of policyArns) {
      try {
        await attachPolicy('role', roleName, policyArn);
      } catch (caught) {
        failures.push(`${policyArn}: ${toFriendlyIamError(caught).message}`);
      }
    }

    flashbar.notify({
      type: 'success',
      header: 'Role created',
      content:
        policyArns.length === 0
          ? roleName
          : `${roleName} with ${policyArns.length - failures.length} attached ${
              policyArns.length - failures.length === 1 ? 'policy' : 'policies'
            }.`,
    });
    for (const failure of failures) {
      flashbar.notify({ type: 'error', header: 'Could not attach a policy', content: failure });
    }

    setSubmitting(false);
    navigate(`${serviceConsolePath(descriptor.id)}/roles/${encodeURIComponent(roleName)}`);
  };

  const entityStep = (
    <Container header={<Header variant="h2">Trusted entity type</Header>}>
      <SpaceBetween size="m">
        <RadioGroup
          value={entityType}
          onChange={({ detail }) => {
            setEntityType(
              detail.value === 'account' || detail.value === 'custom' ? detail.value : 'service',
            );
          }}
          items={[
            {
              value: 'service',
              label: 'AWS service',
              description: 'Allow a service such as Lambda or EC2 to assume this role.',
            },
            {
              value: 'account',
              label: 'AWS account',
              description: 'Allow another AWS account to assume this role.',
            },
            {
              value: 'custom',
              label: 'Custom trust policy',
              description: 'Write the trust policy document yourself.',
            },
          ]}
        />

        {entityType === 'service' ? (
          <FormField label="Use case" description="Select every service that may assume the role.">
            <Multiselect
              selectedOptions={[...services].map((service) => ({
                value: service,
                label:
                  TRUSTED_SERVICE_PRINCIPALS.find((entry) => entry.value === service)?.label ??
                  service,
              }))}
              options={TRUSTED_SERVICE_PRINCIPALS.map((entry) => ({
                value: entry.value,
                label: entry.label,
                description: entry.value,
              }))}
              filteringType="auto"
              filteringPlaceholder="Find services"
              placeholder="Choose services"
              tokenLimit={6}
              onChange={({ detail }) => {
                setServices(
                  detail.selectedOptions
                    .map((option) => option.value ?? '')
                    .filter((entry) => entry.length > 0),
                );
              }}
            />
          </FormField>
        ) : null}

        {entityType === 'account' ? (
          <FormField
            label="AWS account ID"
            description="The account whose root user can assume the role. LocalStack uses account 000000000000."
          >
            <Input
              value={accountId}
              placeholder="123456789012"
              inputMode="numeric"
              onChange={({ detail }) => {
                setAccountId(detail.value.replace(/[^0-9]/g, '').slice(0, 12));
              }}
            />
          </FormField>
        ) : null}

        {entityType === 'custom' ? (
          <JsonEditor
            value={customTrustPolicy}
            onChange={setCustomTrustPolicy}
            label="Trust policy"
            ariaLabel="Trust policy JSON"
            rows={14}
            description="Validated as JSON, then as a trust policy document (Version, Statement, Effect, Principal, Action)."
          />
        ) : (
          <JsonEditor
            value={trustPolicy}
            readOnly
            label="Trust policy preview"
            ariaLabel="Generated trust policy JSON"
            description="The document LocalDeck sends with CreateRole."
          />
        )}
      </SpaceBetween>
    </Container>
  );

  const policiesStep = (
    <Container header={<Header variant="h2">Add permissions</Header>}>
      <SpaceBetween size="m">
        <Alert type="info">
          Attach managed policies that grant the role its permissions. You can attach more later
          from the role&apos;s Permissions tab.
        </Alert>
        <PolicyPicker selectedArns={policyArns} onChange={setPolicyArns} disabled={submitting} />
      </SpaceBetween>
    </Container>
  );

  const detailsStep = (
    <Container header={<Header variant="h2">Role details</Header>}>
      <Form>
        <SpaceBetween size="l">
          <FormField
            label="Role name"
            errorText={nameError ?? undefined}
            constraintText={<Box variant="small">{IAM_ROLE_NAME_RULES.join(' · ')}</Box>}
          >
            <Input
              value={roleName}
              autoFocus
              disabled={submitting}
              placeholder="lambda-execution-role"
              onChange={({ detail }) => {
                setRoleName(detail.value);
                setNameError(null);
              }}
            />
          </FormField>

          <FormField label="Description" description="Optional. Explain what the role is for.">
            <Textarea
              value={description}
              disabled={submitting}
              rows={2}
              placeholder="Allows Lambda functions to write logs."
              onChange={({ detail }) => {
                setDescription(detail.value);
              }}
            />
          </FormField>
        </SpaceBetween>
      </Form>
    </Container>
  );

  const tagsStep = (
    <Container header={<Header variant="h2">Tags</Header>}>
      <TagsEditor
        tags={tags}
        onChange={setTags}
        description="Tags are key-value pairs applied to the role, useful for cost allocation and search."
      />
    </Container>
  );

  const reviewStep = (
    <Container header={<Header variant="h2">Review</Header>}>
      <SpaceBetween size="m">
        <KeyValuePairs
          columns={1}
          items={[
            { label: 'Role name', value: <Box variant="code">{roleName}</Box> },
            { label: 'Description', value: description.trim().length === 0 ? '—' : description },
            {
              label: 'Trusted entities',
              value: summarizeTrustedEntities(trustPolicy),
            },
            {
              label: 'Policies to attach',
              value: policyArns.length === 0 ? 'None' : `${policyArns.length} selected`,
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
        <JsonEditor
          value={trustPolicy}
          readOnly
          label="Trust policy"
          ariaLabel="Trust policy review"
        />
        <Alert type="info" header="What happens next">
          LocalDeck creates the role with the trust policy, then attaches the selected policies one
          by one. A failed attach names the policy instead of hiding the role.
        </Alert>
      </SpaceBetween>
    </Container>
  );

  return (
    <CreateWizard
      title="Create role"
      description={descriptor.summary}
      breadcrumbs={[
        { text: descriptor.displayName, href: serviceConsolePath(descriptor.id) },
        { text: 'Roles', href: `${serviceConsolePath(descriptor.id)}/roles` },
        { text: 'Create role' },
      ]}
      activeStepIndex={activeStepIndex}
      steps={[
        {
          id: 'trusted-entity',
          title: 'Trusted entity type',
          description: 'Choose who can assume the role.',
          validate: trustProblem,
          content: entityStep,
        },
        {
          id: 'permissions',
          title: 'Add permissions',
          description: 'Optional. Grant the role its permissions.',
          isOptional: true,
          content: policiesStep,
        },
        {
          id: 'details',
          title: 'Role details',
          description: 'Name the role and describe its purpose.',
          validate: () => validateRoleName(roleName),
          content: detailsStep,
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
        { label: 'Role name', value: roleName.length === 0 ? '—' : roleName },
        { label: 'Trusted entity', value: summarizeTrustedEntities(trustPolicy) },
        { label: 'Policies', value: `${policyArns.length}` },
        { label: 'Tags', value: `${meaningfulTags(tags).length}` },
      ]}
      summaryTitle="Role summary"
      submitLabel="Create role"
      submitting={submitting}
      error={error}
      onSubmit={submit}
      onCancel={leave}
      onStepChange={setActiveStepIndex}
    />
  );
}

export default RoleCreatePage;
