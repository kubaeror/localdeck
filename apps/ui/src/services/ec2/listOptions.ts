import type { CollectionPreferencesProps } from '@cloudscape-design/components/collection-preferences';

/**
 * Page-size choices shared by the EC2 list pages. The lists support the full
 * `CollectionPreferences` dialog (ResourceListPage owns it); this is the one
 * option every EC2 list exposes.
 */
export const EC2_PAGE_SIZE_OPTIONS: readonly CollectionPreferencesProps.PageSizeOption[] = [
  { value: 10, label: '10 resources' },
  { value: 25, label: '25 resources' },
  { value: 50, label: '50 resources' },
  { value: 100, label: '100 resources' },
];
