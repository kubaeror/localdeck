import type { ApiConfigResponse } from '@localdeck/shared';
import {
  API_ORIGIN,
  IS_CI,
  LOCALSTACK_ENDPOINT,
  UI_ORIGIN,
  clearTrackedResources,
} from './support';

/**
 * Logs what the suite is really talking to. `reuseExistingServer` is enabled
 * outside CI, so a stale `pnpm dev` could otherwise silently serve another
 * build against another emulator; this prints the effective origins and the
 * endpoint the running api reports, and warns when they disagree.
 */
export default async function globalSetup(): Promise<void> {
  clearTrackedResources();

  console.log(
    `[e2e] emulator endpoint under test: ${LOCALSTACK_ENDPOINT}` +
      (IS_CI
        ? ' (Playwright starts the api and ui)'
        : ' (Playwright reuses already-running api/ui when present)'),
  );
  console.log(`[e2e] api origin: ${API_ORIGIN}`);
  console.log(`[e2e] ui origin:  ${UI_ORIGIN}`);

  let reported: ApiConfigResponse | undefined;
  try {
    const response = await fetch(`${API_ORIGIN}/api/config`);
    if (response.ok) {
      reported = (await response.json()) as ApiConfigResponse;
    }
  } catch {
    // The webServer plugin only starts processes; this probe is advisory.
  }

  if (reported === undefined) {
    console.warn(`[e2e] ${API_ORIGIN}/api/config did not answer; continuing.`);
    return;
  }

  console.log(
    `[e2e] api ${reported.application.name} ${reported.application.version} ` +
      `(${reported.application.environment}) reports ${reported.emulator.providerLabel} at ` +
      `${reported.emulator.endpoint} (region ${reported.emulator.region}); ` +
      `ui poll interval ${reported.ui.statusPollIntervalMs}ms`,
  );

  if (reported.emulator.endpoint !== LOCALSTACK_ENDPOINT) {
    console.warn(
      `[e2e] WARNING: the api is bound to ${reported.emulator.endpoint}, but this ` +
        `suite expects ${LOCALSTACK_ENDPOINT}. Stop the reused server or unset ` +
        'reuseExistingServer (E2E_API_PORT/E2E_UI_PORT) before trusting the results.',
    );
  }
}
