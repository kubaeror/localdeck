import type { ApiError } from '@localdeck/shared';
import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreateWizard } from '../../../components/CreateWizard';
import { JsonEditor } from '../../../components/JsonEditor';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import { createPolicy } from '../api';
import { FullAdminConfirmModal } from '../components/FullAdminConfirmModal';
import { PolicyEditor } from '../components/PolicyEditor';
import { toFriendlyIamError } from '../errors';
import { IAM_POLICY_NAME_RULES, validatePolicyName } from '../naming';
import {
  buildIdentityPolicyText,
  isFullAdminPolicy,
  policyWarnings,
  validateIdentityPolicy,
} from '../policy';

/**
 * The console's create-policy wizard: the step-based editor (or the raw JSON
 * tab) for the document, then the name, description and review. The document is
 * validated as JSON and as an identity policy structure before LocalStack sees
 * it, including when the wizard advances between steps.
 */
export function PolicyCreatePage({ descriptor }: ServicePageProps): ReactElement {
  const navigate = useNavigate();
  const flashbar = useFlashbar();
  const [documentText, setDocumentText] = useState(() =>
    buildIdentityPolicyText({ effect: 'Allow', actions: [], resources: ['*'] }),
  );
  const [policyName, setPolicyName] = useState('');
  const [description, setDescription] = useState('');
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [nameError, setNameError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [confirmFullAdmin, setConfirmFullAdmin] = useState(false);

  const leave = (): void => {
    navigate(`${serviceConsolePath(descriptor.id)}/policies`);
  };

  const documentProblem = (): string | null => {
    const validation = validateIdentityPolicy(documentText);
    if (validation.jsonError !== null) {
      return `The policy document is not valid JSON: ${validation.jsonError}`;
    }
    if (validation.structureErrors.length > 0) return validation.structureErrors.join(' ');
    return null;
  };

  const performCreate = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    setNameError(null);
    try {
      const policy = await createPolicy({
        policyName,
        policyDocument: documentText,
        ...(description.trim().length === 0 ? {} : { description: description.trim() }),
      });
      flashbar.notify({ type: 'success', header: 'Policy created', content: policyName });
      setSubmitting(false);
      setConfirmFullAdmin(false);
      navigate(`${serviceConsolePath(descriptor.id)}/policies/${encodeURIComponent(policy.arn)}`);
    } catch (caught) {
      const friendly = toFriendlyIamError(caught, 'policyName');
      if (friendly.field === 'policyName') {
        setNameError(friendly.message);
        setActiveStepIndex(1);
      } else if (friendly.field === 'policyDocument') {
        setError({ ...friendly.apiError, message: friendly.message });
        setActiveStepIndex(0);
      } else {
        setError({ ...friendly.apiError, message: friendly.message });
      }
      setSubmitting(false);
    }
  };

  const submit = (): void => {
    if (isFullAdminPolicy(documentText)) {
      setConfirmFullAdmin(true);
      return;
    }
    void performCreate();
  };

  const permissionsStep = (
    <Container header={<Header variant="h2">Specify permissions</Header>}>
      <PolicyEditor
        value={documentText}
        onChange={setDocumentText}
        label="Policy editor"
        description="Build the policy in the visual editor, or write the JSON document directly. Both modes validate the IAM policy structure."
      />
    </Container>
  );

  const reviewStep = (
    <Container header={<Header variant="h2">Review and create</Header>}>
      <Form>
        <SpaceBetween size="l">
          <FormField
            label="Policy name"
            description="The name identifies the policy in this account; it appears in ARNs."
            errorText={nameError ?? undefined}
            constraintText={<Box variant="small">{IAM_POLICY_NAME_RULES.join(' · ')}</Box>}
          >
            <Input
              value={policyName}
              autoFocus
              disabled={submitting}
              placeholder="s3-read-only"
              onChange={({ detail }) => {
                setPolicyName(detail.value);
                setNameError(null);
              }}
            />
          </FormField>

          <FormField label="Description" description="Optional. Explain what the policy grants.">
            <Textarea
              value={description}
              disabled={submitting}
              rows={2}
              placeholder="Read-only access to the reports bucket."
              onChange={({ detail }) => {
                setDescription(detail.value);
              }}
            />
          </FormField>

          <KeyValuePairs
            columns={1}
            items={[
              { label: 'Policy name', value: <Box variant="code">{policyName}</Box> },
              {
                label: 'Validation',
                value:
                  'Valid JSON · Version and Statement present · every statement has Effect, Action and Resource',
              },
            ]}
          />

          <JsonEditor
            value={documentText}
            readOnly
            label="Policy document"
            ariaLabel="Policy document review"
            description="The exact document CreatePolicy receives."
          />
        </SpaceBetween>
      </Form>
    </Container>
  );

  return (
    <>
      <CreateWizard
        title="Create policy"
        description={descriptor.summary}
        breadcrumbs={[
          { text: descriptor.displayName, href: serviceConsolePath(descriptor.id) },
          { text: 'Policies', href: `${serviceConsolePath(descriptor.id)}/policies` },
          { text: 'Create policy' },
        ]}
        activeStepIndex={activeStepIndex}
        steps={[
          {
            id: 'permissions',
            title: 'Specify permissions',
            description: 'Build or paste the policy document.',
            validate: documentProblem,
            content: permissionsStep,
          },
          {
            id: 'review',
            title: 'Review and create',
            description: 'Name the policy and confirm the document.',
            validate: () => validatePolicyName(policyName),
            content: reviewStep,
          },
        ]}
        summary={[
          { label: 'Service', value: descriptor.displayName },
          { label: 'Policy name', value: policyName.length === 0 ? '—' : policyName },
          {
            label: 'Document',
            value: validateIdentityPolicy(documentText).valid ? 'Valid' : 'Needs attention',
          },
        ]}
        summaryTitle="Policy summary"
        submitLabel="Create policy"
        submitting={submitting}
        error={error}
        onSubmit={submit}
        onCancel={leave}
        onStepChange={setActiveStepIndex}
      />

      <FullAdminConfirmModal
        visible={confirmFullAdmin}
        subject="policy"
        warnings={policyWarnings(documentText)}
        busy={submitting}
        onDismiss={() => {
          setConfirmFullAdmin(false);
        }}
        onConfirm={() => {
          void performCreate();
        }}
      />
    </>
  );
}

export default PolicyCreatePage;
