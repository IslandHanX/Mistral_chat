import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Page from './page';

const OLD_FETCH = globalThis.fetch;

// 按微任务推进的有限 SSE
function makeFiniteSSE(lines: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      let i = 0;
      const push = () => {
        if (i >= lines.length) return controller.close();
        controller.enqueue(enc.encode(lines[i++]));
        queueMicrotask(push);
      };
      push();
    },
  });
}

// 常驻（不 close）的 SSE，方便测试 Stop
function makeNeverEndingSSE(first = 'data: {"choices":[{"delta":{"content":"chunk"}}]}\n') {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(first));
      // 不再 close，等待 cancel()
    },
  });
}

afterEach(() => {
  globalThis.fetch = OLD_FETCH as any;
  (window as any).fetch = OLD_FETCH as any;
});

it('renders assistant markdown as chunks arrive (SSE parsing)', async () => {
  const fetchMock = vi.fn(async () => {
    const body = makeFiniteSSE([
      'data: {"choices":[{"delta":{"content":"Bonjour"}}]}\n',
      'data: {"choices":[{"delta":{"content":" !"}}]}\n',
      'data: [DONE]\n',
    ]);
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }) as any;
  });
  globalThis.fetch = fetchMock as any;
  (window as any).fetch = fetchMock as any;

  render(<Page />);
  await userEvent.click(screen.getByRole('button', { name: /send/i }));

  // 用 textContent 断言，避免被 Markdown 拆 node 影响
	const ok = await screen.findByText('Bonjour !', {
	selector: 'p',
	exact: true,
	timeout: 10000,
	});

  expect(ok).toBeInTheDocument();
}, 10000);

it('Stop aborts cleanly without throwing and resets pending state', async () => {
  const fetchMock = vi.fn(async () => {
    const body = makeNeverEndingSSE();
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }) as any;
  });
  globalThis.fetch = fetchMock as any;
  (window as any).fetch = fetchMock as any;

  render(<Page />);

  await userEvent.click(screen.getByRole('button', { name: /send/i }));
  const stopBtn = await screen.findByRole('button', { name: /stop/i }, { timeout: 10000 });

  await userEvent.click(stopBtn);

  const resetBtn = await screen.findByRole('button', { name: /reset/i }, { timeout: 10000 });
  expect(resetBtn).toBeInTheDocument();
}, 10000);
