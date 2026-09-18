/**
 * The pagination envelope every LocalDeck list fetch returns. Services map
 * their SDK response onto it (`NextToken`, `ContinuationToken`, `Marker`, …)
 * so the console can render one list component for every service.
 */
export interface Paginated<T> {
  items: readonly T[];
  /** Pass back to the fetcher to load the next page, when the api returned one. */
  nextToken?: string;
  /** Total number of resources when the service reports it. */
  total?: number;
}
