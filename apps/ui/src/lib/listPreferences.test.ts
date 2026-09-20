import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearListPreferences, readListPreferences, writeListPreferences } from './listPreferences';

describe('listPreferences', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('round-trips page size and visible content', () => {
    writeListPreferences('buckets', { pageSize: 25, visibleContent: ['name', 'size'] });

    expect(readListPreferences('buckets')).toEqual({
      pageSize: 25,
      visibleContent: ['name', 'size'],
    });
  });

  it('round-trips an explicitly empty visible content selection', () => {
    writeListPreferences('buckets', { visibleContent: [] });

    expect(readListPreferences('buckets')).toEqual({ visibleContent: [] });
  });

  it('ignores malformed values instead of breaking the list page', () => {
    window.localStorage.setItem(
      'localdeck.list-preferences.buckets',
      JSON.stringify({ pageSize: -3, visibleContent: ['name', 42, '', 'size'] }),
    );

    expect(readListPreferences('buckets')).toEqual({ visibleContent: ['name', 'size'] });
  });

  it('falls back to no preferences for unparsable storage', () => {
    window.localStorage.setItem('localdeck.list-preferences.buckets', '{not json');
    expect(readListPreferences('buckets')).toEqual({});
  });

  it('clears stored preferences', () => {
    writeListPreferences('buckets', { pageSize: 25 });
    clearListPreferences('buckets');
    expect(readListPreferences('buckets')).toEqual({});
  });
});
