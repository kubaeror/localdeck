/**
 * Shared console copy. The same situation must always read the same way in
 * every surface, so repeated strings live here instead of drifting between
 * pages (the audit found "not emulated" and "Not emulated locally" used for
 * the same state).
 */

/** Exact wording required for services the emulator does not report. */
export const NOT_EMULATED_LABEL = 'Not emulated locally';

/** Short variant used inside table cells and navigation badges. */
export const NOT_EMULATED_SHORT_LABEL = 'not emulated';

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
export const LOCALSTACK_UNREACHABLE_TITLE = 'LocalStack is not reachable';
export const LOCALDECK_API_ERROR_TITLE = 'The LocalDeck api returned an error';
export const STATUS_UNAVAILABLE_COPY = 'The status could not be loaded.';
