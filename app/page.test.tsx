import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Page from './page';

function ndjson(events: object[], { keepOpen = false } = {}) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`));
      if (!keepOpen) controller.close();
    },
  });
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
});

it('renders the streamed answer with the model and timing', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          ndjson([
            { type: 'meta', model: 'mistral-small-latest', fallbackFrom: 'mistral-medium-latest' },
            { type: 'delta', text: 'Bonjour' },
            { type: 'delta', text: ' !' },
            { type: 'done', ms: 1200, usage: { promptTokens: 4, completionTokens: 3 } },
          ]),
          { status: 200 },
        ),
    ),
  );
  render(<Page />);
  await userEvent.type(screen.getByLabelText('Message'), 'Salut{Enter}');

  expect(await screen.findByText('Bonjour !')).toBeInTheDocument();
  expect(
    await screen.findByText('mistral-small · fell back from mistral-medium · 1.2 s · 3 tokens'),
  ).toBeInTheDocument();
});

it('shows the server message when the request is refused', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { code: 'rate_limited', message: 'Too many messages. Try again in 30 s.' } }),
          { status: 429 },
        ),
    ),
  );
  render(<Page />);
  await userEvent.type(screen.getByLabelText('Message'), 'hi{Enter}');
  expect(await screen.findByText('Too many messages. Try again in 30 s.')).toBeInTheDocument();
});

it('stops a running answer and lets the user send again', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const enc = new TextEncoder();
      let ctrl!: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          ctrl = c;
          c.enqueue(enc.encode(`${JSON.stringify({ type: 'meta', model: 'mistral-small-latest' })}\n`));
          c.enqueue(enc.encode(`${JSON.stringify({ type: 'delta', text: 'partial' })}\n`));
        },
      });
      init.signal?.addEventListener('abort', () =>
        ctrl.error(new DOMException('The operation was aborted.', 'AbortError')),
      );
      return new Response(stream, { status: 200 });
    }),
  );
  render(<Page />);
  await userEvent.type(screen.getByLabelText('Message'), 'hi{Enter}');
  await userEvent.click(await screen.findByRole('button', { name: 'Stop' }));

  expect(await screen.findByText('Stopped.')).toBeInTheDocument();
  expect(screen.getByText('partial')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
});
