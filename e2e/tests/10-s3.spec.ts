import { expect, test } from '@playwright/test';
import { E2E_RESOURCE_PREFIX, deleteBucketIfExists, trackResource, uniqueName } from './helpers';

/**
 * P3 smoke: create a bucket through the S3 console wizard — the reference
 * module's critical path — and open the detail page of the bucket it created.
 * The bucket is deleted through the dispatcher afterwards, so the suite leaves
 * the emulator the way it found it.
 */
test.describe('s3 bucket creation', () => {
  // Mutating spec: a retry would leave a second bucket behind.
  test.describe.configure({ retries: 0 });

  test('creates a bucket through the wizard and opens its detail page', async ({
    page,
    request,
  }) => {
    const bucket = uniqueName(`${E2E_RESOURCE_PREFIX}-wizard`);
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
      trackResource('s3-bucket', bucket);

      await expect(page).toHaveURL(new RegExp(`/console/s3/buckets/${bucket}$`));
      await expect(page.getByRole('heading', { level: 1, name: bucket })).toBeVisible();
      await expect(page.getByText('Bucket created')).toBeVisible();

      // The bucket list now contains the new bucket.
      await page.goto('/console/s3');
      await expect(page.getByRole('link', { name: bucket })).toBeVisible();
    } finally {
      if (created) {
        await deleteBucketIfExists(request, bucket);
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
