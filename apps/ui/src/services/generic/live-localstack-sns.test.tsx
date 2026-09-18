// @vitest-environment jsdom
/**
 * Live generic-browser test against a *running* LocalDeck api and the external
 * LocalStack instance it is bound to.
 *
 * It is skipped unless `VITE_LIVEDECK_LIVE_API` points at the api:
 *
 *   pnpm dev                                                       # api + ui
 *   VITE_LIVEDECK_LIVE_API=http://localhost:3001 pnpm verify:console
 *
 * The test creates one timestamped SNS topic with one tag, renders the real
 * console at /console/sns (a registry service with no dedicated module), and
 * verifies the generated list, detail, tags and delete paths end to end. The
 * topic is deleted in `afterAll` no matter what the assertions did.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { callServiceOperation } from '../../lib/serviceOperations';

const API_BASE = import.meta.env.VITE_LIVEDECK_LIVE_API;
const liveDescribe = describe.skipIf(API_BASE === undefined);

const LIVE_TIMEOUT = { timeout: 20_000 };
const stamp = Date.now().toString(36);
const topicName = `localdeck-ui-live-${stamp}`;
let topicArn = '';

function installLiveFetch(): void {
  const base = API_BASE ?? '';
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      realFetch(typeof input === 'string' ? `${base}${input}` : input, init),
    ),
  );
}

function renderApp(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

liveDescribe('generic browser against the external LocalStack (SNS)', () => {
  beforeAll(async () => {
    installLiveFetch();
    const created = await callServiceOperation<{ TopicArn?: string }>('sns', 'CreateTopic', {
      Name: topicName,
    });
    topicArn = created.TopicArn ?? '';
    if (topicArn.length === 0) throw new Error('LocalStack returned no topic ARN');
    await callServiceOperation('sns', 'TagResource', {
      ResourceArn: topicArn,
      Tags: [{ Key: 'env', Value: 'ui-live' }],
    });
  }, 60_000);

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    try {
      if (topicArn.length > 0) {
        await callServiceOperation('sns', 'DeleteTopic', { TopicArn: topicArn });
      }
    } catch {
      // Best effort: the flow itself deleted the topic when it got that far.
    }
    vi.unstubAllGlobals();
  }, 60_000);

  it('lists the live topic through the registry listOp', async () => {
    renderApp('/console/sns');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'SNS resources' }, LIVE_TIMEOUT),
    ).toBeDefined();
    const filter = await screen.findByRole('searchbox', { name: 'Filter sns resources' });
    fireEvent.change(filter, { target: { value: topicArn } });
    expect((await screen.findAllByText(topicArn, {}, LIVE_TIMEOUT)).length).toBeGreaterThan(0);
  }, 60_000);

  it('opens the topic detail with structured attributes and live tags', async () => {
    renderApp('/console/sns');

    fireEvent.click(await screen.findByRole('link', { name: topicArn }, LIVE_TIMEOUT));
    expect(
      await screen.findByRole('heading', { level: 1, name: topicArn }, LIVE_TIMEOUT),
    ).toBeDefined();
    // The structured view flattens GetTopicAttributes into dotted paths.
    expect(await screen.findByText('Attributes.TopicArn', {}, LIVE_TIMEOUT)).toBeDefined();

    fireEvent.click(screen.getByRole('tab', { name: 'Tags' }));
    const tables = await screen.findAllByRole('table');
    const tagsTable = tables.find((table) => within(table).queryAllByText('env').length > 0);
    if (tagsTable === undefined) throw new Error('the live tag was not rendered');
    expect(within(tagsTable).getByText('ui-live')).toBeDefined();
  }, 60_000);

  it('deletes the topic through the generated confirmation', async () => {
    renderApp('/console/sns');

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }, LIVE_TIMEOUT));
    const dialogs = await screen.findAllByRole('dialog');
    const modal = dialogs.find(
      (dialog) => within(dialog).queryAllByText('Delete SNS resource').length > 0,
    );
    if (modal === undefined) throw new Error('the delete confirmation modal is missing');

    fireEvent.change(screen.getByLabelText(`Confirm deletion of ${topicArn}`), {
      target: { value: 'delete' },
    });
    fireEvent.click(within(modal).getByRole('button', { name: 'Delete' }));

    // The list reloads after the delete; the topic is gone from ListTopics.
    await expect(
      (async () => {
        const topics = await callServiceOperation<{ Topics?: { TopicArn?: string }[] }>(
          'sns',
          'ListTopics',
          {},
        );
        return (topics.Topics ?? []).some((topic) => topic.TopicArn === topicArn);
      })(),
    ).resolves.toBe(false);
    topicArn = '';
  }, 60_000);
});
