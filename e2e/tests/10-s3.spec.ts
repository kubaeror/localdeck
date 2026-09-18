import { expect, test } from '@playwright/test';
import { callServiceOperation, uniqueName } from './helpers';

/**
 * P3 smoke: create a bucket through the S3 console wizard — the reference
 * module's critical path — and open the detail page of the bucket it created.
 * The bucket is deleted through the dispatcher afterwards, so the suite leaves
 * the emulator the way it found it.
 */
test.describe('s3 bucket creation', () => {
  test('creates a bucket through the wizard and opens its detail page', async ({
    page,
    request,
  }) => {
    const bucket = uniqueName('localdeck-e2e');
    let created = false;

    try {
      await page.goto('/console/s3');
      await expect(page.getByRole('heading', { level: 1, name: 'Buckets' })).toBeVisible();

      await page.getByRole('button', { name: 'Create bucket' }).first().click();
      await expect(page.getByRole('heading', { level: 1, name: 'Create bucket' })).toBeVisible();

      await page.getByRole('textbox', { name: 'Bucket name' }).fill(bucket);

      // The versioning, tags and public-access steps are optional; Next walks
      // them in order and the review step carries the submit button.
      await page.getByRole('button', { name: 'Next' }).click();
      await expect(
        page.getByRole('heading', { level: 2, name: 'Versioning' }).first(),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Next' }).click();
      await expect(page.getByRole('heading', { level: 2, name: 'Tags' }).first()).toBeVisible();
      await page.getByRole('button', { name: 'Next' }).click();
      await expect(
        page.getByRole('heading', { level: 2, name: 'Block Public Access' }).first(),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Next' }).click();
      await expect(page.getByRole('heading', { level: 2, name: 'Review' }).first()).toBeVisible();

      await page.getByRole('button', { name: 'Create bucket' }).first().click();
      created = true;

      await expect(page).toHaveURL(new RegExp(`/console/s3/buckets/${bucket}$`));
      await expect(page.getByRole('heading', { level: 1, name: bucket })).toBeVisible();
      await expect(page.getByText('Bucket created')).toBeVisible();

      // The bucket list now contains the new bucket.
      await page.goto('/console/s3');
      await expect(page.getByRole('link', { name: bucket })).toBeVisible();
    } finally {
      if (created) {
        await callServiceOperation(request, 's3', 'DeleteBucket', { Bucket: bucket });
      }
    }
  });

  test('rejects an invalid bucket name before calling LocalStack', async ({ page }) => {
    await page.goto('/console/s3/create');
    await expect(page.getByRole('heading', { level: 1, name: 'Create bucket' })).toBeVisible();

    await page.getByRole('textbox', { name: 'Bucket name' }).fill('Not_A_Valid_Bucket_Name');
    await page.getByRole('button', { name: 'Next' }).click();

    await expect(
      page.getByText(/Bucket name can only contain lowercase letters/).first(),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Versioning' })).not.toBeVisible();
  });
});
