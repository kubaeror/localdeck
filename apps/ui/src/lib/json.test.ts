import { describe, expect, it } from 'vitest';
import { formatJson, parseJson, stringifyJson, validateJson } from './json';

describe('parseJson', () => {
  it('parses valid documents', () => {
    const result = parseJson('{ "a": [1, 2] }');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ a: [1, 2] });
  });

  it('reports an empty document', () => {
    expect(parseJson('   ')).toEqual({ ok: false, error: 'Enter a JSON document.' });
  });

  it('reports the position of a syntax error', () => {
    const result = parseJson('{\n  "a": 1,\n  "b" 2\n}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
      expect(result.error).not.toMatch(/^JSON\.parse:/);
      expect(result.line).toBeGreaterThan(0);
      expect(result.column).toBeGreaterThan(0);
    }
  });
});

describe('validateJson', () => {
  it('returns null for valid JSON and a message otherwise', () => {
    expect(validateJson('{"tags": [{"Key": "Env", "Value": "local"}]}')).toBeNull();
    expect(validateJson('{"tags": [')).not.toBeNull();
  });
});

describe('formatJson', () => {
  it('pretty-prints valid JSON with the requested indentation', () => {
    expect(formatJson('{"a":1}', 2)).toBe('{\n  "a": 1\n}');
    expect(formatJson('{"a":1}', 4)).toBe('{\n    "a": 1\n}');
  });

  it('returns null for invalid JSON', () => {
    expect(formatJson('{oops}')).toBeNull();
  });
});

describe('stringifyJson', () => {
  it('pretty-prints values and copes with cycles', () => {
    expect(stringifyJson({ a: 1 })).toBe('{\n  "a": 1\n}');
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(typeof stringifyJson(cyclic)).toBe('string');
  });
});
