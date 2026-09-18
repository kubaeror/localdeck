import { expect, test } from '@playwright/test';
import { fetchHealth, isEmulated } from './helpers';

/**
 * Breadth smoke for the console shell and the shared primitives the dedicated
 * modules (P5 IAM, P6 EC2) and the generated browser (P4) are built from.
 * Each case skips itself with a reason when the running LocalStack does not
 * report the service, so the suite stays meaningful on any emulator edition.
 */
test.describe('console breadth', () => {
  test('lists IAM users through the dedicated module', async ({ page, request }) => {
    const health = await fetchHealth(request);
    test.skip(!isEmulated(health, 'iam'), 'This LocalStack does not report IAM');

    await page.goto('/console/iam/users');
    await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
  });

  test('opens the EC2 launch wizard', async ({ page, request }) => {
    const health = await fetchHealth(request);
    test.skip(!isEmulated(health, 'ec2'), 'This LocalStack does not report EC2');

    await page.goto('/console/ec2/instances');
    await expect(page.getByRole('heading', { level: 1, name: 'Instances' })).toBeVisible();

    await page.getByRole('button', { name: 'Launch instance' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Launch instance' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Name and tags' })).toBeVisible();

    // The form is live: the summary column picks the name up as it is typed.
    await page.getByRole('textbox', { name: 'Name' }).fill('localdeck-e2e-instance');
    await expect(page.getByText('localdeck-e2e-instance').first()).toBeVisible();
  });

  test('renders the generated resource browser for a registry service', async ({
    page,
    request,
  }) => {
    const health = await fetchHealth(request);
    test.skip(!isEmulated(health, 'sns'), 'This LocalStack does not report SNS');

    await page.goto('/console/sns');
    await expect(page.getByRole('heading', { level: 1, name: 'SNS resources' })).toBeVisible();
  });

  test('surfaces the unreachable-LocalStack contract on the health page', async ({ page }) => {
    // The health page always renders whatever /api/health returns, including
    // the 503 contract when the emulator is down; here the emulator is up, so
    // this checks the page's live shape without mutating anything.
    await page.goto('/console/health');
    await expect(page.getByRole('heading', { level: 1, name: 'Service health' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'LocalStack connection' })).toBeVisible();
  });
});
