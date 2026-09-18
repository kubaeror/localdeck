import type { ApiError } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Grid from '@cloudscape-design/components/grid';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Wizard from '@cloudscape-design/components/wizard';
import type { WizardProps } from '@cloudscape-design/components/wizard';
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { ConsoleBreadcrumbs, type ConsoleBreadcrumb } from './ConsoleBreadcrumbs';

export interface CreateWizardSummaryEntry {
  label: ReactNode;
  value: ReactNode;
}

export interface CreateWizardStep {
  id: string;
  title: string;
  description?: ReactNode;
  content: ReactNode;
  /**
   * Blocks moving forward when it returns an error message (`null` = valid).
   * The message is shown on the step the user is on.
   */
  validate?: () => string | null;
  isOptional?: boolean;
  /** Extra content for the summary column while this step is active. */
  summaryExtra?: ReactNode;
}

export interface CreateWizardProps {
  /** Page title (h1), e.g. "Create bucket". */
  title: string;
  description?: ReactNode;
  breadcrumbs: readonly ConsoleBreadcrumb[];
  steps: readonly CreateWizardStep[];
  /** Right-hand summary column, rendered next to every step. */
  summary?: readonly CreateWizardSummaryEntry[];
  summaryTitle?: string;
  submitLabel?: string;
  /** Disables the submit button and shows its loading state. */
  submitting?: boolean;
  /** Submission failure; rendered above the wizard. */
  error?: ApiError | null;
  onSubmit: () => void | Promise<void>;
  onCancel: () => void;
  onStepChange?: (stepIndex: number) => void;
  /**
   * Controlled active step. Modules use it to send the user back to the field
   * that failed server-side validation (a bucket name that already exists).
   */
  activeStepIndex?: number;
}

/**
 * The console's create flow: a Cloudscape Wizard with configurable steps and
 * the standard right-hand summary column (the console's "review" rail). Steps
 * validate themselves before the wizard advances.
 */
export function CreateWizard({
  title,
  description,
  breadcrumbs,
  steps,
  summary,
  summaryTitle = 'Summary',
  submitLabel = 'Create',
  submitting = false,
  error = null,
  onSubmit,
  onCancel,
  onStepChange,
  activeStepIndex,
}: CreateWizardProps): ReactElement {
  const [internalStepIndex, setInternalStepIndex] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);
  const selectedStepIndex = activeStepIndex ?? internalStepIndex;

  const wizardSteps = useMemo<readonly WizardProps.Step[]>(
    () =>
      steps.map((step) => ({
        title: step.title,
        ...(step.description === undefined ? {} : { description: step.description }),
        content: step.content,
        ...(step.isOptional === true ? { isOptional: true } : {}),
        ...(selectedStepIndex >= 0 && steps[selectedStepIndex]?.id === step.id && stepError !== null
          ? { errorText: stepError }
          : {}),
      })),
    [selectedStepIndex, stepError, steps],
  );

  // The summary is the console's right-hand column: it stays next to the wizard
  // on wide screens and stacks above it on small ones.
  const activeStep = steps[selectedStepIndex];
  const summaryColumn = (
    <SpaceBetween size="m">
      {summary === undefined || summary.length === 0 ? null : (
        <Container header={<Header variant="h2">{summaryTitle}</Header>}>
          <KeyValuePairs
            columns={1}
            items={summary.map((entry) => ({ label: entry.label, value: entry.value }))}
          />
        </Container>
      )}
      {activeStep?.summaryExtra}
    </SpaceBetween>
  );

  return (
    <ContentLayout
      breadcrumbs={<ConsoleBreadcrumbs items={breadcrumbs} />}
      header={
        <Header variant="h1" description={description}>
          {title}
        </Header>
      }
    >
      <SpaceBetween size="l">
        {error === null ? null : (
          <Alert type="error" header="Could not create the resource">
            {error.message}
          </Alert>
        )}

        <Grid
          gridDefinition={[{ colspan: { default: 12, m: 9 } }, { colspan: { default: 12, m: 3 } }]}
        >
          <Wizard
            steps={wizardSteps}
            activeStepIndex={selectedStepIndex}
            submitButtonText={submitLabel}
            isLoadingNextStep={submitting}
            i18nStrings={{
              stepNumberLabel: (stepNumber) => `Step ${stepNumber}`,
              collapsedStepsLabel: (stepNumber, stepsCount) =>
                `Step ${stepNumber} of ${stepsCount}`,
              skipToButtonLabel: (target) => `Skip to ${target.title}`,
              navigationAriaLabel: 'Steps',
              cancelButton: 'Cancel',
              previousButton: 'Previous',
              nextButton: 'Next',
              optional: 'optional',
            }}
            allowSkipTo={steps.some((step) => step.isOptional === true)}
            onCancel={onCancel}
            onNavigate={({ detail }) => {
              // Leaving the current step forward (or skipping over optional
              // steps): run its validator first. Going back is always allowed.
              if (detail.reason === 'next' || detail.reason === 'skip') {
                const message = steps[selectedStepIndex]?.validate?.() ?? null;
                if (message !== null) {
                  setStepError(message);
                  return;
                }
              }

              setStepError(null);
              if (activeStepIndex === undefined) setInternalStepIndex(detail.requestedStepIndex);
              onStepChange?.(detail.requestedStepIndex);
            }}
            onSubmit={() => {
              const message = steps[selectedStepIndex]?.validate?.() ?? null;
              if (message !== null) {
                setStepError(message);
                return;
              }
              setStepError(null);
              void Promise.resolve(onSubmit()).catch((caught: unknown) => {
                // The parent owns error reporting through the `error` prop.
                console.error('CreateWizard onSubmit failed', caught);
              });
            }}
          />
          {summaryColumn}
        </Grid>
      </SpaceBetween>
    </ContentLayout>
  );
}
