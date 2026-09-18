// @vitest-environment jsdom
import type { AwsTag } from '@localdeck/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { TagsEditor } from './TagsEditor';

function Harness({ initial = [] as readonly AwsTag[] }): ReactElement {
  const [tags, setTags] = useState<readonly AwsTag[]>(initial);
  return <TagsEditor tags={tags} onChange={setTags} />;
}

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
