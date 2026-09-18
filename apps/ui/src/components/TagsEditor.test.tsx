// @vitest-environment jsdom
import type { AwsTag } from '@localdeck/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TagsEditor, validateTags, type TagProblem } from './TagsEditor';

function Harness({ initial = [] as readonly AwsTag[] }): ReactElement {
  const [tags, setTags] = useState<readonly AwsTag[]>(initial);
  return <TagsEditor tags={tags} onChange={setTags} />;
}

/** A save button that only unlocks when the editor reports a valid tag set. */
function SaveHarness({ initial }: { initial: readonly AwsTag[] }): ReactElement {
  const [tags, setTags] = useState<readonly AwsTag[]>(initial);
  const [problems, setProblems] = useState<readonly TagProblem[]>([]);
  return (
    <div>
      <TagsEditor tags={tags} onChange={setTags} onValidityChange={setProblems} />
      <button disabled={problems.length > 0}>Save tags</button>
    </div>
  );
}

describe('validateTags', () => {
  it('accepts empty and unique keys', () => {
    expect(validateTags([])).toEqual([]);
    expect(validateTags([{ Key: 'env', Value: 'local' }])).toEqual([]);
  });

  it('flags duplicate, empty and over-limit keys', () => {
    expect(
      validateTags([
        { Key: 'env', Value: 'a' },
        { Key: 'env', Value: 'b' },
      ]),
    ).toEqual([expect.objectContaining({ code: 'duplicate-key', keys: ['env'] })]);
    expect(validateTags([{ Key: '  ', Value: '' }])).toEqual([
      expect.objectContaining({ code: 'empty-key', index: 0 }),
    ]);
    const tooMany = Array.from({ length: 51 }, (_value, index) => ({
      Key: `key-${index}`,
      Value: '',
    }));
    expect(validateTags(tooMany)).toEqual([expect.objectContaining({ code: 'too-many-tags' })]);
  });
});

describe('TagsEditor', () => {
  afterEach(() => {
    cleanup();
  });

  it('adds, edits and removes tags', () => {
    render(<Harness initial={[{ Key: 'env', Value: 'local' }]} />);

    expect(screen.getByRole('textbox', { name: 'Tag key 1' })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Add new tag' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Tag key 2' }), {
      target: { value: 'team' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Tag value 2' }), {
      target: { value: 'platform' },
    });
    expect((screen.getByRole('textbox', { name: 'Tag key 2' }) as HTMLInputElement).value).toBe(
      'team',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove tag env' }));
    expect(screen.queryByRole('textbox', { name: 'Tag key 2' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Tag key 1' })).toBeDefined();
  });

  it('rejects duplicate keys before any save call', () => {
    render(
      <Harness
        initial={[
          { Key: 'env', Value: 'local' },
          { Key: 'env', Value: 'prod' },
        ]}
      />,
    );

    expect(screen.getByText(/Duplicate tag key: env/)).toBeDefined();
  });

  it('reports empty keys and blocks the save until they are fixed', async () => {
    render(
      <SaveHarness
        initial={[
          { Key: 'env', Value: 'local' },
          { Key: '   ', Value: 'oops' },
        ]}
      />,
    );

    expect(screen.getAllByText(/Tag keys cannot be empty or whitespace/).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(
        (screen.getByRole('button', { name: 'Save tags' }) as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    fireEvent.change(screen.getByRole('textbox', { name: 'Tag key 2' }), {
      target: { value: 'team' },
    });

    await waitFor(() => {
      expect(
        (screen.getByRole('button', { name: 'Save tags' }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });
  });

  it('locks the save button while duplicate keys exist', async () => {
    render(
      <SaveHarness
        initial={[
          { Key: 'env', Value: 'local' },
          { Key: 'env', Value: 'prod' },
        ]}
      />,
    );

    expect((screen.getByRole('button', { name: 'Save tags' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Tag key 2' }), {
      target: { value: 'team' },
    });

    await waitFor(() => {
      expect(
        (screen.getByRole('button', { name: 'Save tags' }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });
  });

  it('calls onValidityChange with the current problems', () => {
    const onValidityChange = vi.fn();
    render(
      <TagsEditor
        tags={[{ Key: 'env', Value: '' }]}
        onChange={() => undefined}
        onValidityChange={onValidityChange}
      />,
    );

    expect(onValidityChange).toHaveBeenLastCalledWith([]);
  });

  it('keeps focus while editing a row (stable row identity)', () => {
    render(
      <Harness
        initial={[
          { Key: 'env', Value: 'local' },
          { Key: 'team', Value: 'platform' },
        ]}
      />,
    );

    const input = screen.getByRole('textbox', { name: 'Tag value 2' }) as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: 'core' } });

    const after = screen.getByRole('textbox', { name: 'Tag value 2' });
    expect(document.activeElement).toBe(after);
    expect((after as HTMLInputElement).value).toBe('core');
  });

  it('keeps focus on the following row when a previous row is removed', () => {
    render(
      <Harness
        initial={[
          { Key: 'env', Value: 'local' },
          { Key: 'team', Value: 'platform' },
        ]}
      />,
    );

    const input = screen.getByRole('textbox', { name: 'Tag value 2' }) as HTMLInputElement;
    input.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag env' }));

    const after = screen.getByRole('textbox', { name: 'Tag value 1' });
    expect(document.activeElement).toBe(after);
  });

  it('renders read-only tags without inputs', () => {
    render(
      <TagsEditor tags={[{ Key: 'env', Value: 'local' }]} onChange={() => undefined} readOnly />,
    );

    expect(screen.getByText('env')).toBeDefined();
    expect(screen.getByText('local')).toBeDefined();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add new tag' })).toBeNull();
  });
});
