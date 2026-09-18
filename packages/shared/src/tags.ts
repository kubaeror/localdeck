/**
 * A resource tag in the shape AWS APIs use (`[{ Key, Value }]`), so SDK inputs
 * and responses can be passed through without conversion.
 */
export interface AwsTag {
  Key: string;
  Value: string;
}

/** Tag lookup helper used by detail pages and tag editors. */
export function findTagValue(tags: readonly AwsTag[] | undefined, key: string): string | undefined {
  return tags?.find((tag) => tag.Key === key)?.Value;
}

/** Sorts tags by key for stable rendering. */
export function sortTags(tags: readonly AwsTag[]): readonly AwsTag[] {
  return [...tags].sort((left, right) => left.Key.localeCompare(right.Key, 'en'));
}
