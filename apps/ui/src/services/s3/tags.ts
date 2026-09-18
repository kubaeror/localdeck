import type { AwsTag } from '@localdeck/shared';

/**
 * Rows with a real key. A tag row that is still completely blank is dropped
 * before a save; the shared TagsEditor's `validateTags` blocks rows whose key
 * is empty while a value was entered.
 */
export function meaningfulTags(tags: readonly AwsTag[]): readonly AwsTag[] {
  return tags.filter((tag) => tag.Key.trim().length > 0);
}
