import { expect, test } from '@playwright/test';
import { deleteClusterIfExists, fetchHealth, isEmulated, uniqueName } from './helpers';

/**
 * P7 smoke: start EKS cluster creation through the console wizard.
 *
 * LocalStack's EKS provider starts a real k3d cluster in Docker and is an
 * Ultimate-plan feature. The test therefore runs the full wizard whenever the
 * emulator reports EKS (a licensed LocalStack, e.g. the one a developer runs
 * locally), and otherwise asserts the console's honest "not enabled" page —
 * the suite never pretends the emulator supports something it does not.
 */
test.describe('eks cluster creation', () => {
  test('starts cluster creation through the wizard (or reports it is not enabled)', async ({
    page,
    request,
  }) => {
    test.setTimeout(600_000);
    const health = await fetchHealth(request);

    await page.goto('/console/eks');

    if (!isEmulated(health, 'eks')) {
      test.info().annotations.push({
        type: 'localstack-eks',
        description:
          'This LocalStack does not report EKS (Ultimate-plan feature); the honest not-enabled page was asserted instead of a fake creation flow.',
      });
      await expect(page.getByText('EKS is not enabled in this LocalStack instance')).toBeVisible();
      return;
    }

    const cluster = uniqueName('localdeck-e2e');
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
      await manualArn.fill(`arn:aws:iam::000000000000:role/${cluster}-role`);

      // Networking: the wizard fetches the VPC and preselects the first two
      // subnets (EKS wants at least two AZs). Wait for that selection before
      // moving on, then accept the endpoint defaults.
      await page.getByRole('button', { name: 'Next' }).click();
      await expect(
        page.getByRole('heading', { level: 2, name: 'Networking' }).first(),
      ).toBeVisible();
      // Cloudscape renders the selected subnet tokens below the trigger, so
      // wait for the first preselected token to appear before moving on.
      await expect(page.getByText(/subnet-[0-9a-f]+ · us-east-1/).first()).toBeVisible({
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
