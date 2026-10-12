import { describe, expect, it, vi } from 'vitest';
import { openMistralStream } from './mistral';

const status = (code: number) => new Response('{"message":"busy"}', { status: code });

async function retryDelayAfter(code: number) {
  const sleep = vi.fn<[number], Promise<void>>(async () => undefined);
  const fetchImpl = vi
    .fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    .mockResolvedValueOnce(status(code))
    .mockResolvedValueOnce(status(503));
  await openMistralStream({
    apiKey: 'test-key',
    models: ['ministral-8b-2512'],
    messages: [{ role: 'user', content: 'hi' }],
    fetchImpl,
    sleep,
  });
  expect(sleep).toHaveBeenCalledTimes(1);
  return sleep.mock.calls[0][0];
}

describe('openMistralStream retries', () => {
  it('waits at least a second after a 429', async () => {
    expect(await retryDelayAfter(429)).toBeGreaterThanOrEqual(1_000);
  });

  it('retries a 5xx sooner', async () => {
    expect(await retryDelayAfter(503)).toBeLessThan(1_000);
  });
});
