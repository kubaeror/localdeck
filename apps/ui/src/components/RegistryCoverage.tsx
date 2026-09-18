import type { RegistryCoverage as RegistryCoverageSummary } from '@localdeck/shared';
import Box from '@cloudscape-design/components/box';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import type { ReactElement } from 'react';
import type { ServiceCatalogSource } from '../contexts/service-catalog-context';

export interface RegistryCoverageProps {
  /** Result of `summarizeRegistryCoverage` for the current health document. */
  coverage: RegistryCoverageSummary;
  /** Where the rendered registry came from. */
  source: ServiceCatalogSource;
  /**
   * `details` renders the four-row KeyValuePairs block used on the health
   * page; `summary` renders one inline sentence for the Console Home widget.
   */
  variant?: 'details' | 'summary';
}

/**
 * How the LocalDeck registry lines up with the services LocalStack reports.
 * Shared by the service health page and the Console Home widget so both show
 * the same numbers with the same wording.
 */
export function RegistryCoverage({
  coverage,
  source,
  variant = 'details',
}: RegistryCoverageProps): ReactElement {
  if (variant === 'summary') {
    return (
      <Box>
        {coverage.emulated} of {coverage.registered} registered services
        {coverage.unregistered.length === 0
          ? ''
          : ` · ${coverage.unregistered.length} stack services without a console entry`}
      </Box>
    );
  }

  return (
    <KeyValuePairs
      columns={3}
      items={[
        {
          label: 'Registered services',
          value:
            source === 'api' ? (
              <Box>{coverage.registered} (served by GET /api/services)</Box>
            ) : (
              <Box>{coverage.registered} (bundled with the ui)</Box>
            ),
        },
        {
          label: 'Emulated locally',
          value: <Box>{coverage.emulated}</Box>,
        },
        {
          label: 'Not emulated locally',
          value: <Box>{coverage.notEmulated.length}</Box>,
        },
        {
          label: 'Stack services without a console entry',
          value: <Box>{coverage.unregistered.length}</Box>,
        },
      ]}
    />
  );
}
