import { serviceSearchText, type ServiceDescriptor } from '@localdeck/shared';
import { fuzzyScore } from './fuzzy';

export interface ServiceMatch {
  service: ServiceDescriptor;
  score: number;
}

/** Alphabetical base order, so equal fuzzy scores keep a stable order. */
function alphabetically(services: readonly ServiceDescriptor[]): readonly ServiceDescriptor[] {
  return [...services].sort((left, right) =>
    left.displayName.localeCompare(right.displayName, 'en'),
  );
}

/**
 * Fuzzy-matches the service registry. Display name and id matches outrank
 * matches found in the category, summary or operation whitelist.
 */
export function searchServices(
  query: string,
  services: readonly ServiceDescriptor[],
  limit = 8,
): readonly ServiceMatch[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const matches: ServiceMatch[] = [];
  for (const service of alphabetically(services)) {
    const nameScore = fuzzyScore(trimmed, service.displayName);
    const idScore = fuzzyScore(trimmed, service.id);
    const detailScore = fuzzyScore(trimmed, serviceSearchText(service));
    const score = Math.max(nameScore * 1.6, idScore * 1.4, detailScore);
    if (score > 0) matches.push({ service, score });
  }

  return matches.sort((left, right) => right.score - left.score).slice(0, limit);
}
