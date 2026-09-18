// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AceJsonBundle } from '../lib/aceJsonBundle';
import { JsonEditor } from './JsonEditor';

const VALID_JSON = '{"Bucket":"my-bucket","Tags":[{"Key":"Env","Value":"local"}]}';

/** The Ace bundle is never loaded in tests: the editor falls back to a textarea. */
const failingAce = () => Promise.reject(new Error('ace is not available in tests'));

describe('JsonEditor (read-only)', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders pretty-printed JSON through CodeView with syntax tokens', () => {
    const { container } = render(<JsonEditor value={VALID_JSON} label="Bucket policy" />);

    expect(screen.getByText('Bucket policy')).toBeDefined();
    // CodeView renders one table row per line of the pretty-printed document.
    expect(container.querySelectorAll('tr').length).toBeGreaterThan(4);
    expect(container.querySelectorAll('[data-json-token="key"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[data-json-token="string"]').length).toBeGreaterThan(0);
    expect(screen.getByText('Valid JSON')).toBeDefined();
  });

  it('numbers the lines', () => {
    const { container } = render(<JsonEditor value={VALID_JSON} />);
    const lineNumbers = Array.from(container.querySelectorAll('td')).filter(
      (cell) => cell.getAttribute('aria-hidden') === 'true',
    );
    expect(lineNumbers.length).toBeGreaterThan(4);
  });

  it('reports invalid JSON as an error and shows it as typed', () => {
    const { container } = render(<JsonEditor value={'{"Bucket":'} />);

    expect(screen.getByText(/Invalid JSON/)).toBeDefined();
    expect(container.textContent).toContain('{"Bucket":');
  });

  it('prefers an external error over the parse error', () => {
    render(<JsonEditor value={VALID_JSON} errorText="The api rejected this document" />);

    expect(screen.getByText('The api rejected this document')).toBeDefined();
  });
});

describe('JsonEditor (editable)', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows the Format control while the editor bundle is loading', () => {
    const pending = new Promise<AceJsonBundle>(() => undefined);

    render(
      <JsonEditor
        value={VALID_JSON}
        label="Attributes"
        onChange={() => undefined}
        loadAce={() => pending}
      />,
    );

    expect(screen.getByText('Format JSON')).toBeDefined();
    expect(screen.getByText('Valid JSON')).toBeDefined();
  });

  it('falls back to a textarea when the editor bundle cannot be loaded', async () => {
    const onChange = vi.fn();
    render(<JsonEditor value={'{}'} label="Attributes" onChange={onChange} loadAce={failingAce} />);

    const textarea = await screen.findByRole('textbox', { name: 'Attributes' });
    // The failure is surfaced instead of silently downgrading the editor.
    expect(await screen.findByText(/enhanced JSON editor could not be loaded/)).toBeDefined();
    fireEvent.change(textarea, { target: { value: '{"a":1}' } });
    expect(onChange).toHaveBeenCalledWith('{"a":1}');
  });

  it('pretty-prints the document when Format JSON is used', async () => {
    const onChange = vi.fn();
    render(
      <JsonEditor
        value={'{"a":1,"b":[2]}'}
        label="Attributes"
        onChange={onChange}
        loadAce={failingAce}
      />,
    );

    fireEvent.click(await screen.findByText('Format JSON'));

    expect(onChange).toHaveBeenCalledWith('{\n  "a": 1,\n  "b": [\n    2\n  ]\n}');
  });

  it('disables Format JSON while the document is invalid', async () => {
    render(
      <JsonEditor
        value={'{oops}'}
        label="Attributes"
        onChange={() => undefined}
        loadAce={failingAce}
      />,
    );

    const format = await screen.findByText('Format JSON');
    expect(format.closest('button')?.disabled).toBe(true);
    expect(screen.getByText(/Invalid JSON/)).toBeDefined();
  });
});
