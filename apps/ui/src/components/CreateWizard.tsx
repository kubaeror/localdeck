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
  const [stepError, setStepError] = useState<{ stepId: string; message: string } | null>(null);
  const selectedStepIndex = activeStepIndex ?? internalStepIndex;

  const wizardSteps = useMemo<readonly WizardProps.Step[]>(
    () =>
      steps.map((step) => ({
        title: step.title,
        ...(step.description === undefined ? {} : { description: step.description }),
        content: step.content,
        ...(step.isOptional === true ? { isOptional: true } : {}),
        ...(stepError?.stepId === step.id ? { errorText: stepError.message } : {}),
      })),
    [stepError, steps],
  );

  /**
   * Validates every step up to `upToIndex` (inclusive) and returns the first
   * failure. Validating the whole range, not just the step the user is on,
   * closes the "Skip to Review" bypass where a required step was never shown
   * its validator.
   */
  const firstInvalidStep = (upToIndex: number): { index: number; message: string } | null => {
    const lastIndex = Math.min(upToIndex, steps.length - 1);
    for (let index = 0; index <= lastIndex; index += 1) {
      const step = steps[index];
      if (step === undefined) break;
      const message = step.validate?.() ?? null;
      if (message !== null) return { index, message };
    }
    return null;
  };

  const goToStep = (index: number): void => {
    if (activeStepIndex === undefined) setInternalStepIndex(index);
    onStepChange?.(index);
  };

  /** Shows the message on its own step and moves the user there. */
  const reportStepError = (failure: { index: number; message: string }): void => {
    const step = steps[failure.index];
    if (step === undefined) return;
    setStepError({ stepId: step.id, message: failure.message });
    goToStep(failure.index);
  };

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
              // Going back is always allowed. Every other navigation validates
              // all steps up to the requested one, so skipping over a required
              // step can no longer bypass its validator.
              if (detail.reason === 'previous') {
                setStepError(null);
                goToStep(detail.requestedStepIndex);
                return;
              }

              const failure = firstInvalidStep(detail.requestedStepIndex);
              if (failure !== null) {
                reportStepError(failure);
                return;
              }

              setStepError(null);
              goToStep(detail.requestedStepIndex);
            }}
            onSubmit={() => {
              // Submitting validates the whole flow, not only the visible step.
              const failure = firstInvalidStep(steps.length - 1);
              if (failure !== null) {
                reportStepError(failure);
                return;
              }
              setStepError(null);
              void Promise.resolve()
                .then(() => onSubmit())
                .catch((caught: unknown) => {
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
