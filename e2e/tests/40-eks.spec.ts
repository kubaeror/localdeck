import { expect, test } from '@playwright/test';
import {
  E2E_RESOURCE_PREFIX,
  deleteClusterIfExists,
  fetchAccountId,
  fetchConfig,
  fetchHealth,
  isEmulated,
  trackResource,
  uniqueName,
} from './helpers';

/**
 * P7 smoke: start EKS cluster creation through the console wizard.
 *
 * LocalStack's EKS provider starts a real k3d cluster in Docker and requires an
 * entitlement that includes EKS (the Ultimate plan). The test therefore runs
 * the full wizard whenever the emulator reports EKS (a licensed LocalStack,
 * e.g. the one a developer runs locally), and otherwise asserts the console's
 * honest "not enabled" page — the suite never pretends the emulator supports
 * something it does not.
 */
test.describe('eks cluster creation', () => {
  // Mutating spec: a retry could start a second k3d cluster.
  test.describe.configure({ retries: 0 });

  test('starts cluster creation through the wizard (or reports it is not enabled)', async ({
    page,
    request,
  }) => {
    test.skip(
      process.env.LOCALDECK_E2E_SKIP_EKS === '1',
      'EKS creation is skipped in this matrix leg (LOCALDECK_E2E_SKIP_EKS=1).',
    );
    test.setTimeout(600_000);
    const health = await fetchHealth(request);

    await page.goto('/console/eks');

    if (!isEmulated(health, 'eks')) {
      test.info().annotations.push({
        type: 'localstack-eks',
        description:
          'This emulator does not report EKS (an entitlement that includes EKS is required); the honest not-enabled page was asserted instead of a fake creation flow.',
      });
      const health = await fetchHealth(request);
      await expect(
        page.getByText(`EKS is not enabled in this ${health.provider.providerLabel} instance`),
      ).toBeVisible();
      return;
    }

    // Fixtures follow the running api instead of hardcoding us-east-1 and the
    // LocalStack account id.
    const config = await fetchConfig(request);
    const region = config.emulator.region;
    const accountId = await fetchAccountId(request);
    const cluster = uniqueName(`${E2E_RESOURCE_PREFIX}-cluster`);
    let submitted = false;

    try {
      await page.getByRole('button', { name: 'Create cluster' }).first().click();
      await expect(page.getByRole('heading', { level: 1, name: 'Create cluster' })).toBeVisible();

      // The wizard fetches the supported Kubernetes versions and preselects the
      // default; wait for that before validating the step.
      await expect(page.getByRole('button', { name: 'Kubernetes version' })).toContainText('1.', {
        timeout: 30_000,
      });

      await page.getByRole('textbox', { name: 'Name' }).fill(cluster);

      // The role picker lists the stack's IAM roles and always offers manual
      // ARN entry; LocalStack does not validate the role, only stores it.
      const manualArn = page.getByRole('textbox', { name: 'Cluster IAM role ARN' });
      if (!(await manualArn.isVisible().catch(() => false))) {
        await page.getByRole('button', { name: 'Cluster IAM role' }).click();
        await page.getByRole('option', { name: 'Enter an ARN manually' }).click();
      }
      await manualArn.fill(`arn:aws:iam::${accountId}:role/${cluster}-role`);

      // Networking: the wizard fetches the VPC and preselects the first two
      // subnets (EKS wants at least two AZs). Wait for that selection before
      // moving on, then accept the endpoint defaults.
      await page.getByRole('button', { name: 'Next' }).click();
      await expect(
        page.getByRole('heading', { level: 2, name: 'Networking' }).first(),
      ).toBeVisible();
      // Cloudscape renders the selected subnet tokens below the trigger, so
      // wait for the first preselected token to appear before moving on.
      await expect(
        page.getByText(new RegExp(`subnet-[0-9a-f]+ · ${escapeRegExp(region)}`)).first(),
      ).toBeVisible({
        timeout: 30_000,
      });
      await page.getByRole('button', { name: 'Next' }).click();
      await expect(
        page.getByRole('heading', { level: 2, name: 'Endpoint access' }).first(),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Next' }).click();
      await expect(page.getByRole('heading', { level: 2, name: 'Tags' }).first()).toBeVisible();
      await page.getByRole('button', { name: 'Next' }).click();
      await expect(page.getByRole('heading', { level: 2, name: 'Review' }).first()).toBeVisible();

      await page.getByRole('button', { name: 'Create cluster' }).first().click();
      submitted = true;
      trackResource('eks-cluster', cluster);

      // CreateCluster is genuinely long-running: LocalStack starts a k3d
      // control plane before answering. The console navigates to the detail
      // page, which polls DescribeCluster until the status settles.
      await expect(page).toHaveURL(new RegExp(`/console/eks/clusters/${cluster}$`), {
        timeout: 120_000,
      });
      await expect(page.getByRole('heading', { level: 1, name: cluster })).toBeVisible();
      await expect(page.getByText(/creating|updating|active|failed/i).first()).toBeVisible();
    } finally {
      if (submitted) {
        await deleteClusterIfExists(request, cluster);
      }
    }
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
