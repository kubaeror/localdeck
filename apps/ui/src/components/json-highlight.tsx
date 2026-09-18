import Box from '@cloudscape-design/components/box';
import type { ReactElement } from 'react';

/** Strings, keys, numbers and literals, in one pass per line. */
const TOKEN_PATTERN =
  /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)/g;

export type JsonTokenKind = 'key' | 'string' | 'number' | 'literal';

/** Cloudscape colour tokens double as syntax colours for the JSON viewer. */
const TOKEN_COLORS: Readonly<
  Record<
    JsonTokenKind,
    'text-label' | 'text-status-info' | 'text-status-inactive' | 'text-status-success'
  >
> = {
  key: 'text-label',
  string: 'text-status-success',
  number: 'text-status-info',
  literal: 'text-status-inactive',
};

function tokenNode(token: string, kind: JsonTokenKind, key: string): ReactElement {
  return (
    <span key={key} data-json-token={kind}>
      <Box variant="span" color={TOKEN_COLORS[kind]}>
        {token}
      </Box>
    </span>
  );
}

/** Splits one JSON line into coloured tokens; punctuation keeps its colour. */
export function highlightJsonLine(line: string, lineIndex = 0): ReactElement[] {
  const nodes: ReactElement[] = [];
  let cursor = 0;

  for (const [matchIndex, match] of Array.from(line.matchAll(TOKEN_PATTERN)).entries()) {
    const start = match.index ?? 0;
    if (start > cursor) {
      nodes.push(<span key={`plain-${lineIndex}-${matchIndex}`}>{line.slice(cursor, start)}</span>);
    }

    const [full, text, colon, number, literal] = match;
    if (text !== undefined) {
      nodes.push(
        tokenNode(text, colon === undefined ? 'string' : 'key', `key-${lineIndex}-${matchIndex}`),
      );
      if (colon !== undefined) {
        nodes.push(<span key={`colon-${lineIndex}-${matchIndex}`}>{colon}</span>);
      }
    } else if (number !== undefined) {
      nodes.push(tokenNode(number, 'number', `number-${lineIndex}-${matchIndex}`));
    } else if (literal !== undefined) {
      nodes.push(tokenNode(literal, 'literal', `literal-${lineIndex}-${matchIndex}`));
    } else {
      nodes.push(<span key={`raw-${lineIndex}-${matchIndex}`}>{full}</span>);
    }

    cursor = start + full.length;
  }

  if (cursor < line.length) {
    nodes.push(<span key={`tail-${lineIndex}`}>{line.slice(cursor)}</span>);
  }
  return nodes;
}

/** CodeView's contract: one element whose children are the rendered lines. */
export function highlightJson(code: string): ReactElement {
  const lines = code.split('\n');
  return (
    <span>
      {lines.map((line, index) => (
        <span key={index}>
          {highlightJsonLine(line, index)}
          {index < lines.length - 1 ? '\n' : ''}
        </span>
      ))}
    </span>
  );
}
