// @vitest-environment jsdom
import Input from '@cloudscape-design/components/input';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreateWizard } from './CreateWizard';

interface HarnessProps {
  onSubmit?: () => void;
  onCancel?: () => void;
  submitting?: boolean;
  error?: { code: string; statusCode: number; message: string } | null;
}

/** A two-step wizard whose first step validates a name. */
function Harness({ onSubmit, onCancel, submitting, error }: HarnessProps): ReactElement {
  const [name, setName] = useState('');
  const [size, setSize] = useState('');

  return (
    <MemoryRouter>
      <CreateWizard
        title="Create bucket"
        description="Buckets hold objects."
        breadcrumbs={[{ text: 'S3', href: '/console/s3' }, { text: 'Create' }]}
        steps={[
          {
            id: 'details',
            title: 'Details',
            description: 'Name the bucket.',
            validate: () => (name.trim().length === 0 ? 'Enter a bucket name.' : null),
            content: (
              <Input
                value={name}
                ariaLabel="Bucket name"
                onChange={({ detail }) => {
                  setName(detail.value);
                }}
              />
            ),
          },
          {
            id: 'options',
            title: 'Options',
            isOptional: true,
            content: (
              <Input
                value={size}
                ariaLabel="Max size"
                onChange={({ detail }) => {
                  setSize(detail.value);
                }}
              />
            ),
          },
          {
            id: 'review',
            title: 'Review',
            content: <div>Ready to create</div>,
          },
        ]}
        summary={[
          { label: 'Service', value: 'S3' },
          { label: 'Name', value: name.length === 0 ? '—' : name },
        ]}
        {...(submitting === undefined ? {} : { submitting })}
        {...(error === undefined ? {} : { error })}
        onSubmit={onSubmit ?? (() => undefined)}
        onCancel={onCancel ?? (() => undefined)}
      />
    </MemoryRouter>
  );
}

describe('CreateWizard', () => {
  afterEach(() => {
    cleanup();
  });
  it('renders the first step with the right-hand summary column', () => {
    render(<Harness />);

    expect(screen.getByRole('heading', { level: 1, name: 'Create bucket' })).toBeDefined();
    expect(screen.getByText('Step 1 of 3')).toBeDefined();
    expect(screen.getByText('Summary')).toBeDefined();
    expect(screen.getByText('Service')).toBeDefined();
    // "S3" shows up in the breadcrumbs and in the summary column.
    expect(screen.getAllByText('S3').length).toBeGreaterThan(1);
  });

  it('blocks navigation while the current step is invalid', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('Enter a bucket name.')).toBeDefined();
    expect(screen.getByText('Step 1 of 3')).toBeDefined();
  });

  it('advances once the step validates and keeps the summary in sync', () => {
    render(<Harness />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Bucket name' }), {
      target: { value: 'my-bucket' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('Step 2 of 3')).toBeDefined();
    // The summary updates as the form changes.
    expect(screen.getByText('my-bucket')).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Max size' })).toBeDefined();
  });

  it('submits from the last step', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Bucket name' }), {
      target: { value: 'my-bucket' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Ready to create')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
  });

  it('reports a submission error above the wizard', () => {
    render(
      <Harness
        error={{ code: 'BUCKET_ALREADY_EXISTS', statusCode: 409, message: 'The bucket exists.' }}
      />,
    );

    expect(screen.getByText('Could not create the resource')).toBeDefined();
    expect(screen.getByText('The bucket exists.')).toBeDefined();
  });

  it('shows the submit button in a loading state while submitting', () => {
    const { rerender } = render(<Harness />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Bucket name' }), {
      target: { value: 'my-bucket' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Ready to create')).toBeDefined();

    rerender(<Harness submitting />);

    // The wizard's primary button is blocked while the request runs.
    const submit = screen.getByRole('button', { name: 'Create' });
    expect(submit.getAttribute('aria-disabled')).toBe('true');
  });

  it('cancels the flow', () => {
    const onCancel = vi.fn();
    render(<Harness onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalled();
  });

  it('validates optional steps that a Skip to navigation passes over', () => {
    render(<SkipHarness />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Bucket name' }), {
      target: { value: 'my-bucket' },
    });
    // "Skip to Review" jumps over the optional step; its validator must still
    // run (previously only the current step was validated).
    fireEvent.click(screen.getByRole('button', { name: 'Skip to Review' }));

    expect(screen.getByText('Choose a size.')).toBeDefined();
    expect(screen.queryByText('Ready to create')).toBeNull();
  });

  it('validates every step at submit, even when the controlled step skipped ahead', () => {
    const onSubmit = vi.fn();
    render(<ControlledHarness onSubmit={onSubmit} />);

    expect(screen.getByText('Step 2 of 2')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(screen.getByText('Enter a bucket name.')).toBeDefined();
    expect(onSubmit).not.toHaveBeenCalled();
    // The wizard sent the user back to the failing step.
    expect(screen.getByText('Step 1 of 2')).toBeDefined();
  });
});

/** Three steps where the optional one also has a validator. */
function SkipHarness(): ReactElement {
  const [name, setName] = useState('');
  const [size, setSize] = useState('');

  return (
    <MemoryRouter>
      <CreateWizard
        title="Create bucket"
        breadcrumbs={[{ text: 'S3', href: '/console/s3' }, { text: 'Create' }]}
        steps={[
          {
            id: 'details',
            title: 'Details',
            validate: () => (name.trim().length === 0 ? 'Enter a bucket name.' : null),
            content: (
              <Input
                value={name}
                ariaLabel="Bucket name"
                onChange={({ detail }) => {
                  setName(detail.value);
                }}
              />
            ),
          },
          {
            id: 'options',
            title: 'Options',
            isOptional: true,
            validate: () => (size.trim().length === 0 ? 'Choose a size.' : null),
            content: (
              <Input
                value={size}
                ariaLabel="Max size"
                onChange={({ detail }) => {
                  setSize(detail.value);
                }}
              />
            ),
          },
          { id: 'review', title: 'Review', content: <div>Ready to create</div> },
        ]}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />
    </MemoryRouter>
  );
}

/** A wizard whose active step is controlled by the parent. */
function ControlledHarness({ onSubmit }: { onSubmit: () => void }): ReactElement {
  const [name, setName] = useState('');
  const [stepIndex, setStepIndex] = useState(1);

  return (
    <MemoryRouter>
      <CreateWizard
        title="Create bucket"
        breadcrumbs={[{ text: 'S3', href: '/console/s3' }, { text: 'Create' }]}
        activeStepIndex={stepIndex}
        onStepChange={setStepIndex}
        steps={[
          {
            id: 'details',
            title: 'Details',
            validate: () => (name.trim().length === 0 ? 'Enter a bucket name.' : null),
            content: (
              <Input
                value={name}
                ariaLabel="Bucket name"
                onChange={({ detail }) => {
                  setName(detail.value);
                }}
              />
            ),
          },
          { id: 'review', title: 'Review', content: <div>Ready to create</div> },
        ]}
        onSubmit={onSubmit}
        onCancel={() => undefined}
      />
    </MemoryRouter>
  );
}
