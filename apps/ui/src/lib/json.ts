/**
 * JSON parsing helpers shared by the console's JSON editor, the detail pages
 * and the create wizards. Validation never throws: the caller decides how to
 * surface the message.
 */

export interface JsonParseSuccess {
  ok: true;
  value: unknown;
}

export interface JsonParseFailure {
  ok: false;
  /** Position-aware message from `JSON.parse`, cleaned up for display. */
  error: string;
  /** 1-based line the error was found on, when it can be derived. */
  line?: number;
  column?: number;
}

export type JsonParseResult = JsonParseSuccess | JsonParseFailure;

/** Strips the engine-specific prefix from a `JSON.parse` error message. */
function cleanMessage(message: string): string {
  return message.replace(/^JSON\.parse:\s*/i, '').trim();
}

/** Reads `line X column Y` out of a JSON.parse error message, when present. */
function readPosition(message: string): { line?: number; column?: number } {
  const match = /line (\d+) column (\d+)/i.exec(message);
  if (match === undefined || match === null) return {};
  return { line: Number(match[1]), column: Number(match[2]) };
}

export function parseJson(text: string): JsonParseResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'Enter a JSON document.' };
  }

  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const message = cleanMessage(raw);
    return { ok: false, error: message, ...readPosition(message) };
  }
}

/** Validates JSON text: `null` means valid, otherwise the error to display. */
export function validateJson(text: string): string | null {
  const result = parseJson(text);
  return result.ok ? null : result.error;
}

/** Pretty-prints JSON. Returns `null` when the text is not valid JSON. */
export function formatJson(text: string, indentation = 2): string | null {
  const result = parseJson(text);
  if (!result.ok) return null;
  return JSON.stringify(result.value, null, indentation);
}

/** Pretty-printed JSON for a value that is already parsed. */
export function stringifyJson(value: unknown, indentation = 2): string {
  try {
    return JSON.stringify(value, null, indentation) ?? 'null';
  } catch {
    // Cyclic values can only come from hand-written module code.
    return String(value);
  }
}

export interface JsonLines {
  ok: boolean;
  /** One entry per line, so the viewer can add line numbers. */
  lines: readonly string[];
}

/** Splits JSON text into lines; invalid JSON is still shown, as typed. */
export function toJsonLines(text: string): JsonLines {
  const pretty = formatJson(text);
  return { ok: pretty !== null, lines: (pretty ?? text).split('\n') };
}
