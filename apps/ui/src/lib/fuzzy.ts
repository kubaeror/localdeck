/**
 * Tiny dependency-free fuzzy matcher used by the console search and the
 * sidebar filter. It scores subsequence matches with bonuses for exact
 * prefixes, word boundaries and contiguous runs, so "clwatch" finds
 * "CloudWatch" while "clou" ranks "CloudFront" above a scattered match.
 */

/** Characters that separate words in ids, names and descriptions. */
const WORD_SEPARATOR = /[\s\-_/.,:;()[\]{}|]+/;

const COMBINING_MARKS = /\p{Diacritic}/gu;

/** Splits camelCase so "CloudFront" has a word boundary before "Front". */
const CAMEL_CASE_BOUNDARY = /([a-z0-9])([A-Z])/g;

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(CAMEL_CASE_BOUNDARY, '$1 $2')
    .toLowerCase();
}

/**
 * Score for `query` inside `text`. `0` means "no match"; any positive value is
 * a match, and larger is better.
 */
export function fuzzyScore(query: string, text: string): number {
  const needle = normalize(query).trim();
  if (needle.length === 0) return 0;

  const haystack = normalize(text);
  if (needle.length > haystack.length) return 0;

  let score = 0;
  let searchFrom = 0;
  let lastMatch = -1;
  let contiguousRun = 0;
  let gapCharacters = 0;

  for (const character of needle) {
    const index = haystack.indexOf(character, searchFrom);
    if (index === -1) return 0;

    score += 1;
    if (index === 0) {
      score += 6;
    } else if (WORD_SEPARATOR.test(haystack.charAt(index - 1))) {
      score += 4;
    }

    if (index === lastMatch + 1) {
      contiguousRun += 1;
      score += 2 + contiguousRun;
    } else {
      contiguousRun = 0;
      if (lastMatch >= 0) gapCharacters += index - lastMatch - 1;
    }

    lastMatch = index;
    searchFrom = index + 1;
  }

  if (haystack === needle) score += 12;
  else if (haystack.startsWith(needle)) score += 8;

  score -= gapCharacters * 0.5;
  score -= haystack.length * 0.02;

  // Still a match, even when every penalty applies.
  return Math.max(score, 0.01);
}
