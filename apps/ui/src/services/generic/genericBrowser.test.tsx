// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { dispatchedOperationCalls, jsonResponse, stubApiFetch } from '../../test/fixtures';

/**
 * The generated resource browser, exercised through the SNS registry binding:
 * a registry service with no dedicated folder must list its live topics, open
 * a structured detail view with tags, delete through the confirmation modal
 * and explain create as a CLI stub.
 */

const TOPIC_ARN = 'arn:aws:sns:us-east-1:000000000000:localdeck-generic-test';

function stubSns(): void {
  stubApiFetch({
    operations: {
      'sns/ListTopics': {
        service: 'sns',
        operation: 'ListTopics',
        result: { Topics: [{ TopicArn: TOPIC_ARN }] },
      },
      'sns/GetTopicAttributes': {
        service: 'sns',
        operation: 'GetTopicAttributes',
        result: {
          Attributes: {
            TopicArn: TOPIC_ARN,
            DisplayName: 'LocalDeck generic browser',
            SubscriptionsConfirmed: '0',
          },
        },
      },
      'sns/ListTagsForResource': {
        service: 'sns',
        operation: 'ListTagsForResource',
        result: { Tags: [{ Key: 'env', Value: 'localdeck-test' }] },
      },
      'sns/DeleteTopic': { service: 'sns', operation: 'DeleteTopic', result: {} },
    },
  });
}

function renderApp(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('generic resource browser (SNS)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lists topics through the registry listOp, not a placeholder', async () => {
    stubSns();
    renderApp('/console/sns');

    expect(await screen.findByRole('heading', { level: 1, name: 'SNS resources' })).toBeDefined();
    expect(screen.queryByText('The SNS console is not implemented yet')).toBeNull();
    // The ARN is both the name and the identifier column of the generated row.
    expect((await screen.findAllByText(TOPIC_ARN)).length).toBeGreaterThan(0);
    // The list column headers come from the generated table.
    expect(await screen.findByRole('columnheader', { name: 'Identifier' })).toBeDefined();
    expect(dispatchedOperationCalls('sns', 'ListTopics')).toBeGreaterThan(0);
  });

  it('opens the detail with structured properties, tags and raw JSON', async () => {
    stubSns();
    renderApp('/console/sns');

    fireEvent.click(await screen.findByRole('link', { name: TOPIC_ARN }));

    expect(await screen.findByRole('heading', { level: 1, name: TOPIC_ARN })).toBeDefined();
    // Structured properties from GetTopicAttributes, flattened with dotted paths.
    expect(await screen.findByText('Attributes.DisplayName')).toBeDefined();
    expect(screen.getByText('LocalDeck generic browser')).toBeDefined();

    fireEvent.click(screen.getByRole('tab', { name: 'Tags' }));
    expect(await screen.findByText('env')).toBeDefined();
    expect(screen.getByText('localdeck-test')).toBeDefined();

    fireEvent.click(screen.getByRole('tab', { name: 'Raw JSON' }));
    expect(await screen.findByText('Describe response')).toBeDefined();

    expect(dispatchedOperationCalls('sns', 'GetTopicAttributes')).toBeGreaterThan(0);
    expect(dispatchedOperationCalls('sns', 'ListTagsForResource')).toBeGreaterThan(0);
  });

  it('deletes a topic behind the typed confirmation', async () => {
    stubSns();
    renderApp('/console/sns');

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    const dialogs = await screen.findAllByRole('dialog');
    const modal = dialogs.find(
      (dialog) => within(dialog).queryAllByText('Delete SNS resource').length > 0,
    );
    if (modal === undefined) throw new Error('the delete confirmation modal is missing');

    const submit = within(modal).getByRole('button', { name: 'Delete' });
    expect(submit.hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByLabelText(`Confirm deletion of ${TOPIC_ARN}`), {
      target: { value: 'delete' },
    });
    expect(submit.hasAttribute('disabled')).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => {
      expect(dispatchedOperationCalls('sns', 'DeleteTopic')).toBe(1);
    });
  });

  it('falls back to the list operation when a service has no describe binding', async () => {
    stubApiFetch({
      operations: {
        'logs/DescribeLogGroups': {
          service: 'logs',
          operation: 'DescribeLogGroups',
          result: {
            logGroups: [{ logGroupName: '/aws/lambda/localdeck-generic', storedBytes: 1024 }],
          },
        },
      },
    });
    // CloudWatch Logs groups are `/`-separated names; the route carries one.
    renderApp('/console/logs/resources/%2Faws%2Flambda%2Flocaldeck-generic');

    expect(
      await screen.findByRole('heading', { level: 1, name: '/aws/lambda/localdeck-generic' }),
    ).toBeDefined();
    expect(await screen.findByText('logGroupName')).toBeDefined();
    expect(dispatchedOperationCalls('logs', 'DescribeLogGroups')).toBeGreaterThan(0);
  });

  it('explains create as an AWS CLI stub generated from the registry', async () => {
    stubSns();
    renderApp('/console/sns/create');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Create SNS resource' }),
    ).toBeDefined();
    expect(screen.getByText('Create via AWS CLI')).toBeDefined();
    // The stub names the whitelisted CreateTopic operation in CLI spelling.
    expect((await screen.findAllByText(/create-topic/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/--endpoint-url http:\/\/localhost:4566/)).toBeDefined();
  });

  it('shows the tag failure message and retries the tags operation', async () => {
    stubSns();
    const base = globalThis.fetch;
    let tagsCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/sns/ListTagsForResource')) {
          tagsCalls += 1;
          if (tagsCalls === 1) {
            return jsonResponse(
              { error: { code: 'AccessDenied', message: 'tag access denied', statusCode: 403 } },
              403,
            );
          }
        }
        return base(input, init);
      }),
    );
    renderApp('/console/sns');

    fireEvent.click(await screen.findByRole('link', { name: TOPIC_ARN }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Tags' }));

    expect(await screen.findByText('Could not load the tags')).toBeDefined();
    expect(screen.getByText('tag access denied')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('env')).toBeDefined();
    expect(screen.queryByText('Could not load the tags')).toBeNull();
  });

  it('does not decode a route parameter a second time', async () => {
    stubApiFetch({
      operations: {
        'logs/DescribeLogGroups': {
          service: 'logs',
          operation: 'DescribeLogGroups',
          result: { logGroups: [{ logGroupName: 'a%20b', storedBytes: 1 }] },
        },
      },
    });
    // encodeURIComponent('a%20b') = 'a%2520b': the router decodes it once.
    renderApp('/console/logs/resources/a%2520b');

    expect(await screen.findByRole('heading', { level: 1, name: 'a%20b' })).toBeDefined();
    expect(screen.queryByRole('heading', { level: 1, name: 'a b' })).toBeNull();
  });
});
