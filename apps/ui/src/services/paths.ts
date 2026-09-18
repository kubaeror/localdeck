/**
 * Route table for the console. Every service console lives under
 * `/console/<serviceId>/…` so breadcrumbs, the sidebar and future deep links
 * cannot disagree about where a service lives.
 */
export const CONSOLE_HOME_PATH = '/console/home';
export const SERVICE_HEALTH_PATH = '/console/health';
export const ALL_SERVICES_PATH = '/console/services';

export function serviceConsolePath(serviceId: string): string {
  return `/console/${serviceId}`;
}

/** LocalStack's per-service API coverage index. */
export const LOCALSTACK_SERVICES_DOCS_URL = 'https://docs.localstack.cloud/aws/services/';
