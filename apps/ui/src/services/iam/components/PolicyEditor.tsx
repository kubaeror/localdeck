import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Multiselect from '@cloudscape-design/components/multiselect';
import type { MultiselectProps } from '@cloudscape-design/components/multiselect';
import RadioGroup from '@cloudscape-design/components/radio-group';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { JsonEditor } from '../../../components/JsonEditor';
import type { AceJsonBundle } from '../../../lib/aceJsonBundle';
import {
  buildIdentityPolicyText,
  IAM_ACTION_CATALOG,
  policyWarnings,
  readPolicyStatement,
  validateIdentityPolicy,
  type PolicyStatementDraft,
} from '../policy';

export interface PolicyEditorProps {
  value: string;
  onChange: (value: string) => void;
  errorText?: ReactNode;
  label?: string;
  description?: ReactNode;
  /** Test seam forwarded to the JSON editor. */
  loadAce?: () => Promise<AceJsonBundle>;
}

type EditorMode = 'visual' | 'json';

const EFFECT_OPTIONS = [
  { value: 'Allow', label: 'Allow' },
  { value: 'Deny', label: 'Deny' },
];

/** The grouped action options the visual editor's Multiselect shows. */
const ACTION_OPTIONS: readonly MultiselectProps.Option[] = IAM_ACTION_CATALOG.map((service) => ({
  label: service.label,
  options: service.actions.map((action) => ({ value: action.value, label: action.label })),
}));

const ALL_ACTIONS = new Map(
  IAM_ACTION_CATALOG.flatMap((service) =>
    service.actions.map((action) => [action.value, action] as const),
  ),
);

const DEFAULT_DRAFT: PolicyStatementDraft = {
  effect: 'Allow',
  actions: [],
  resources: ['*'],
};

/**
 * The console's policy editor: a step-based visual editor (effect, service
 * actions, resources) and a raw JSON tab. The visual editor owns a single
 * statement; switching to it from a document it cannot represent keeps the user
 * in the JSON tab with an explanation instead of silently changing the policy.
 *
 * The component never stores the JSON itself — every edit is written back
 * through `onChange`, so the wizard's review step and validation always see the
 * current document.
 */
export function PolicyEditor({
  value,
  onChange,
  errorText,
  label = 'Policy editor',
  description,
  loadAce,
}: PolicyEditorProps): ReactElement {
  const [mode, setMode] = useState<EditorMode>(() =>
    value.trim().length === 0 || readPolicyStatement(value) !== null ? 'visual' : 'json',
  );
  const [draft, setDraft] = useState<PolicyStatementDraft>(
    () => readPolicyStatement(value) ?? DEFAULT_DRAFT,
  );
  const [visualNotice, setVisualNotice] = useState<string | null>(null);

  const validation = validateIdentityPolicy(value);
  const warnings = policyWarnings(value);
  const structureErrors =
    validation.jsonError === null && validation.structureErrors.length > 0
      ? validation.structureErrors
      : null;

  const selectedActions = useMemo(
    () =>
      draft.actions.map((action) => ALL_ACTIONS.get(action) ?? { value: action, label: action }),
    [draft.actions],
  );

  const updateDraft = (next: PolicyStatementDraft): void => {
    setDraft(next);
    onChange(buildIdentityPolicyText(next));
  };

  const switchMode = (next: EditorMode): void => {
    if (next === mode) return;
    if (next === 'json') {
      setVisualNotice(null);
      setMode('json');
      return;
    }

    const parsed = readPolicyStatement(value);
    if (parsed === null) {
      setVisualNotice(
        'This policy contains elements the visual editor cannot represent (several statements, a notification condition, NotAction/NotResource or a Sid). Keep editing the JSON, or replace the document to switch back.',
      );
      return;
    }
    setVisualNotice(null);
    setDraft(parsed);
    setMode('visual');
  };

  const visualEditor = (
    <SpaceBetween size="m">
      <FormField label="Effect" description="Allow grants the actions; Deny blocks them.">
        <Select
          selectedOption={EFFECT_OPTIONS.find((option) => option.value === draft.effect) ?? null}
          options={[...EFFECT_OPTIONS]}
          onChange={({ detail }) => {
            const effect = detail.selectedOption.value === 'Deny' ? 'Deny' : 'Allow';
            updateDraft({ ...draft, effect });
          }}
        />
      </FormField>

      <FormField
        label="Actions"
        description="Pick the API actions the statement allows or denies."
        errorText={draft.actions.length === 0 ? 'Select at least one action.' : undefined}
      >
        <Multiselect
          selectedOptions={selectedActions}
          options={[...ACTION_OPTIONS]}
          filteringType="auto"
          filteringPlaceholder="Find actions"
          placeholder="Choose actions"
          tokenLimit={6}
          onChange={({ detail }) => {
            updateDraft({
              ...draft,
              actions: detail.selectedOptions
                .map((option) => option.value ?? '')
                .filter((entry) => entry.length > 0),
            });
          }}
        />
      </FormField>

      <FormField
        label="Resources"
        description="The ARNs the actions apply to. Use * for every resource, or restrict to a bucket prefix, queue or function."
      >
        <SpaceBetween size="xs">
          {draft.resources.map((resource, index) => (
            <SpaceBetween key={index} direction="horizontal" size="xs" alignItems="center">
              <Input
                value={resource}
                ariaLabel={`Resource ${index + 1}`}
                placeholder="arn:aws:s3:::my-bucket/*"
                onChange={({ detail }) => {
                  updateDraft({
                    ...draft,
                    resources: draft.resources.map((entry, position) =>
                      position === index ? detail.value : entry,
                    ),
                  });
                }}
              />
              <Button
                variant="inline-link"
                ariaLabel={`Remove resource ${index + 1}`}
                disabled={draft.resources.length <= 1}
                onClick={() => {
                  updateDraft({
                    ...draft,
                    resources: draft.resources.filter((_entry, position) => position !== index),
                  });
                }}
              >
                Remove
              </Button>
            </SpaceBetween>
          ))}
          <Box>
            <Button
              iconName="add-plus"
              onClick={() => {
                updateDraft({ ...draft, resources: [...draft.resources, ''] });
              }}
            >
              Add resource
            </Button>
          </Box>
        </SpaceBetween>
      </FormField>

      <JsonEditor
        value={value}
        readOnly
        label="Policy preview"
        ariaLabel="Policy preview JSON"
        description="The document the visual editor builds. Switch to the JSON tab to fine-tune it."
      />
    </SpaceBetween>
  );

  return (
    <SpaceBetween size="m">
      <FormField label={label} description={description}>
        <RadioGroup
          value={mode}
          onChange={({ detail }) => {
            switchMode(detail.value === 'json' ? 'json' : 'visual');
          }}
          items={[
            {
              value: 'visual',
              label: 'Visual editor',
              description: 'Build a statement by choosing a service, its actions and resources.',
            },
            {
              value: 'json',
              label: 'JSON',
              description: 'Write the policy document directly; structure checks run as you type.',
            },
          ]}
        />
      </FormField>

      {visualNotice === null ? null : <Alert type="warning">{visualNotice}</Alert>}

      {mode === 'visual' ? visualEditor : null}

      {mode === 'json' ? (
        <JsonEditor
          value={value}
          onChange={(next) => {
            setDraft(readPolicyStatement(next) ?? draft);
            onChange(next);
          }}
          label="Policy document"
          ariaLabel="Policy document JSON"
          rows={20}
          {...(loadAce === undefined ? {} : { loadAce })}
          errorText={structureErrors === null ? errorText : structureErrors.join(' ')}
          description="Validated as JSON, then as an identity policy document (Version, Statement, Effect, Action, Resource)."
        />
      ) : null}

      {mode === 'visual' && structureErrors !== null ? (
        <Alert type="error" header="The policy is not structurally valid yet">
          {structureErrors.join(' ')}
        </Alert>
      ) : null}

      {mode === 'visual' && errorText !== undefined ? (
        <Alert type="error">{errorText}</Alert>
      ) : null}

      {validation.valid && warnings.length > 0 ? (
        <Alert type="warning" header="Full administrative access">
          {warnings.join(' ')} Creating or saving this policy asks for confirmation.
        </Alert>
      ) : null}

      {validation.valid ? (
        <Box>
          <StatusIndicator type="success">Valid IAM policy structure</StatusIndicator>
        </Box>
      ) : null}
    </SpaceBetween>
  );
}

export default PolicyEditor;
