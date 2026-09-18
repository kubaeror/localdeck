import { SERVICE_CATALOG } from '@localdeck/shared';
import { describe, expect, it } from 'vitest';
import { searchServices } from './serviceSearch';

function idsFor(query: string): readonly string[] {
  return searchServices(query, SERVICE_CATALOG).map((match) => match.service.id);
}

describe('searchServices', () => {
  it('returns nothing for an empty query', () => {
    expect(searchServices('', SERVICE_CATALOG)).toHaveLength(0);
    expect(searchServices('   ', SERVICE_CATALOG)).toHaveLength(0);
  });

  it('ranks an exact id or name match first', () => {
    expect(idsFor('s3')[0]).toBe('s3');
    expect(idsFor('dynamodb')[0]).toBe('dynamodb');
    expect(idsFor('secrets manager')[0]).toBe('secretsmanager');
  });

  it('matches service summaries, categories and operations', () => {
    expect(idsFor('bucket')).toContain('s3');
    expect(idsFor('ListFunctions')[0]).toBe('lambda');
    expect(idsFor('containers').length).toBeGreaterThan(0);
    expect(idsFor('kubernetes')).toContain('eks');
  });

  it('finds services with a scattered query', () => {
    expect(idsFor('clwatch')).toContain('cloudwatch');
    expect(idsFor('stfn')).toContain('stepfunctions');
  });

  it('respects the limit', () => {
    const matches = searchServices('e', SERVICE_CATALOG, 3);
    expect(matches).toHaveLength(3);
    const scores = matches.map((match) => match.score);
    expect([...scores].sort((left, right) => right - left)).toEqual(scores);
  });

  it('is case-insensitive', () => {
    expect(idsFor('LAMBDA')[0]).toBe('lambda');
  });
});
