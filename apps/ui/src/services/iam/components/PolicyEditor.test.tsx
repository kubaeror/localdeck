// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AceJsonBundle } from '../../../lib/aceJsonBundle';
import { buildIdentityPolicyText } from '../policy';
import { PolicyEditor } from './PolicyEditor';

/** The Ace bundle is never loaded in tests: the editor falls back to a textarea. */
const failingAce = (): Promise<AceJsonBundle> =>
  Promise.reject(new Error('ace is not available in tests'));

const VALID_POLICY = buildIdentityPolicyText({
  effect: 'Allow',
  actions: ['s3:GetObject'],
  resources: ['arn:aws:s3:::my-bucket/*'],
});

const MISSING_VERSION = '{"Statement":[{"Effect":"Allow","Action":"s3:GetObject","Resource":"*"}]}';

/** Holds the document in state, exactly like the create wizard does. */
function Harness({ initial }: { initial: string }): ReactElement {
  const [value, setValue] = useState(initial);
  return <PolicyEditor value={value} onChange={setValue} loadAce={failingAce} />;
}

async function openJsonTab(): Promise<HTMLTextAreaElement> {
  fireEvent.click(screen.getByRole('radio', { name: /JSON/ }));
  // Cloudscape names the textarea through its FormField label, which takes
  // precedence over the editor's ariaLabel.
  return screen.findByRole('textbox', { name: 'Policy document' });
}

describe('PolicyEditor', () => {
  afterEach(() => {
    cleanup();
  });

  it('starts in the visual editor for a single-statement document', () => {
    render(<Harness initial={VALID_POLICY} />);

    expect(screen.getByText('Visual editor')).toBeDefined();
    expect(screen.getByText('Policy preview')).toBeDefined();
    expect(screen.getByText('Valid IAM policy structure')).toBeDefined();
  });

  it('reports malformed JSON in the JSON tab with the parse error', async () => {
    render(<Harness initial={VALID_POLICY} />);

    const textarea = await openJsonTab();
    fireEvent.change(textarea, { target: { value: '{"Version":' } });

    expect(await screen.findByText(/Invalid JSON/)).toBeDefined();
  });

  it('reports a structurally invalid document (missing Version)', async () => {
    render(<Harness initial={MISSING_VERSION} />);

    // A document the visual editor cannot represent opens in the JSON tab.
    expect(await screen.findByRole('textbox', { name: 'Policy document' })).toBeDefined();
    expect(screen.getByText(/missing "Version"/)).toBeDefined();
  });

  it('blocks the visual editor with an explanation for unrepresentable documents', async () => {
    const multiStatement = JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        { Effect: 'Allow', Action: 's3:GetObject', Resource: '*' },
        { Effect: 'Deny', Action: 's3:DeleteObject', Resource: '*' },
      ],
    });
    render(<Harness initial={multiStatement} />);

    await openJsonTab();
    fireEvent.click(screen.getByRole('radio', { name: /Visual editor/ }));

    expect(screen.getByText(/visual editor cannot represent/i)).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Policy document' })).toBeDefined();
  });

  it('renders the step-based fields for a representable document', () => {
    render(
      <PolicyEditor
        value={buildIdentityPolicyText({ effect: 'Allow', actions: [], resources: ['*'] })}
        onChange={() => undefined}
        loadAce={failingAce}
      />,
    );

    expect(screen.getByText('Effect')).toBeDefined();
    expect(screen.getByText('Actions')).toBeDefined();
    expect(screen.getByText('Resources')).toBeDefined();
    expect(screen.getByText('Select at least one action.')).toBeDefined();
  });
});
