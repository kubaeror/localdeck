/**
 * Shared console copy. The same situation must always read the same way in
 * every surface, so repeated strings live here instead of drifting between
 * pages.
 *
 * Provider-aware helpers take the active emulator's display name ("LocalStack",
 * "MiniStack", "Floci") so the console never blames the wrong tool.
 */

/** Fallback when the active provider is not known yet. */
export const UNKNOWN_PROVIDER_LABEL = 'the emulator';

/** Wording for a service the active provider does not report at all. */
export function notReportedLabel(providerLabel: string): string {
  return `Not reported by ${providerLabel}`;
}

/** Short variant used inside table cells and navigation badges. */
export function notReportedShortLabel(): string {
  return 'not reported';
}

export function notReportedTooltip(providerLabel: string): string {
  return (
    `${providerLabel} does not report this service, so the console greys it out. ` +
    `LocalDeck never starts or reconfigures ${providerLabel}.`
  );
}

/** Wording for a service the provider knows but has disabled (Floci). */
export function disabledLabel(providerLabel: string): string {
  return `Disabled in ${providerLabel}`;
}

export function disabledShortLabel(): string {
  return 'disabled';
}

export function disabledTooltip(providerLabel: string): string {
  return (
    `This service is known to ${providerLabel} but disabled in its configuration. ` +
    'Enable it there to use this console.'
  );
}

/**
 * Services the running api cannot proxy because its AWS SDK package is not
 * installed (`available: false` from `GET /api/services`). They stay visible so
 * the registry mirrors the catalogue, but the badge explains the 501.
 */
export const NOT_INSTALLED_LABEL = 'Not available on this api';
export const NOT_INSTALLED_SHORT_LABEL = 'not installed';
export const NOT_INSTALLED_TOOLTIP =
  'The LocalDeck api does not have this service’s AWS SDK package installed, so its operations answer 501. Install the package in apps/api and rebuild to browse it.';

/** Alert headers shared by the health page and the Console Home widget. */
export function unreachableTitle(providerLabel: string): string {
  const label = providerLabel.charAt(0).toUpperCase() + providerLabel.slice(1);
  return `${label} is not reachable`;
}
export const LOCALDECK_API_ERROR_TITLE = 'The LocalDeck api returned an error';
export const STATUS_UNAVAILABLE_COPY = 'The status could not be loaded.';

/** Copy for a service inventory the provider cannot report (generic mode). */
export const UNVERIFIED_SERVICE_LABEL = 'Not verified';
export const UNVERIFIED_SERVICE_TOOLTIP =
  'This endpoint exposes no service inventory, so LocalDeck cannot tell whether it implements this service. Actions are attempted and disabled if the endpoint rejects them.';
