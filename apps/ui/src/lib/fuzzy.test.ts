import { describe, expect, it } from 'vitest';
import { fuzzyScore } from './fuzzy';

describe('fuzzyScore', () => {
  it('treats an empty query or a non-match as no match', () => {
    expect(fuzzyScore('', 'S3')).toBe(0);
    expect(fuzzyScore('   ', 'S3')).toBe(0);
    expect(fuzzyScore('xyz', 'S3')).toBe(0);
    expect(fuzzyScore('a longer query than the text', 's3')).toBe(0);
  });

  it('matches case-insensitively and ignores diacritics', () => {
    expect(fuzzyScore('LAMBDA', 'Lambda')).toBeGreaterThan(0);
    expect(fuzzyScore('cafe', 'Café')).toBeGreaterThan(0);
  });

  it('requires the query characters in order', () => {
    expect(fuzzyScore('clfr', 'CloudFront')).toBeGreaterThan(0);
    expect(fuzzyScore('rflc', 'CloudFront')).toBe(0);
  });

  it('scores a prefix match above a scattered subsequence', () => {
    const prefix = fuzzyScore('clou', 'CloudFront');
    const scattered = fuzzyScore('clou', 'Elasticache Network Object Utility');
    expect(prefix).toBeGreaterThan(scattered);
  });

  it('scores a word-boundary match above a mid-word match', () => {
    const wordStart = fuzzyScore('front', 'CloudFront');
    const midWord = fuzzyScore('front', 'Confrontation');
    expect(wordStart).toBeGreaterThan(midWord);
  });

  it('scores shorter targets above longer ones for equal matches', () => {
    expect(fuzzyScore('rds', 'RDS')).toBeGreaterThan(
      fuzzyScore('rds', 'Relational Database Service'),
    );
  });
});
