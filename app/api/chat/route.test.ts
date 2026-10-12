import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const OLD_ENV = { ...process.env };
let ipCounter = 0;

function sse(lines: string[], { failAfter }: { failAfter?: number } = {}) {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (failAfter !== undefined && i === failAfter) return controller.error(new Error('socket reset'));
      if (i >= lines.length) return controller.close();
      controller.enqueue(enc.encode(lines[i++]));
    },
  });
}

const ok = (lines: string[], opts?: { failAfter?: number }) => new Response(sse(lines, opts), { status: 200 });
const status = (code: number) => new Response('{"message":"upstream detail"}', { status: code });

function chat(body: unknown, ip = `10.0.0.${++ipCounter}`) {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

async function events(res: Response) {
  return (await res.text())
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const hello = [
  'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
  'data: {"choices":[{"delta":{"content":"lo"}}],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n',
  'data: [DONE]\n',
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env = { ...OLD_ENV, MISTRAL_API_KEY: 'test-key' };
  delete process.env.ALLOWED_MODELS;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  process.env = { ...OLD_ENV };
  vi.unstubAllGlobals();
});

describe('POST /api/chat', () => {
  it('returns a JSON error when the API key is missing', async () => {
    delete process.env.MISTRAL_API_KEY;
    const res = await POST(chat({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe('server_misconfigured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a model outside the allowed list without calling Mistral', async () => {
    const res = await POST(chat({ model: 'mistral-large-latest', messages: [{ role: 'user', content: 'hi' }] }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('streams meta, text and usage as NDJSON events', async () => {
    fetchMock.mockResolvedValueOnce(ok(hello));
    const res = await POST(
      chat({
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: '' },
          { role: 'user', content: 'again' },
        ],
      }),
    );
    expect(res.headers.get('content-type')).toMatch(/application\/x-ndjson/);
    const evs = await events(res);
    expect(evs[0]).toEqual({ type: 'meta', model: 'mistral-small-latest' });
    expect(
      evs
        .filter((e) => e.type === 'delta')
        .map((e) => e.text)
        .join(''),
    ).toBe('Hello');
    expect(evs.at(-1)).toMatchObject({ type: 'done', usage: { promptTokens: 5, completionTokens: 2 } });

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent).toMatchObject({ model: 'mistral-small-latest', stream: true, max_tokens: 1024 });
    expect(sent.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'user', content: 'again' },
    ]);
  });

  it('falls back to a cheaper model when the requested one stays saturated', async () => {
    fetchMock.mockResolvedValueOnce(status(429)).mockResolvedValueOnce(status(429)).mockResolvedValueOnce(ok(hello));
    const res = await POST(chat({ model: 'mistral-medium-latest', messages: [{ role: 'user', content: 'hi' }] }));
    const evs = await events(res);
    expect(evs[0]).toEqual({ type: 'meta', model: 'mistral-small-latest', fallbackFrom: 'mistral-medium-latest' });
    expect(fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).model)).toEqual([
      'mistral-medium-latest',
      'mistral-medium-latest',
      'mistral-small-latest',
    ]);
  });

  it('does not retry a request Mistral rejects, and does not leak its message', async () => {
    fetchMock.mockResolvedValueOnce(status(400));
    const res = await POST(chat({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('upstream detail');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('answers 503 when every allowed model is unavailable', async () => {
    fetchMock.mockImplementation(async () => status(503));
    const res = await POST(chat({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('upstream_unavailable');
  });

  it('ends with an error event when the stream breaks after the first chunk', async () => {
    fetchMock.mockResolvedValueOnce(ok(hello, { failAfter: 1 }));
    const evs = await events(await POST(chat({ messages: [{ role: 'user', content: 'hi' }] })));
    expect(evs.map((e) => e.type)).toEqual(['meta', 'delta', 'error']);
    expect(evs.at(-1).code).toBe('stream_interrupted');
  });

  it('ignores MOCK_MISTRAL when a real API key is set', async () => {
    process.env.MOCK_MISTRAL = '1';
    fetchMock.mockResolvedValueOnce(ok(hello));
    await events(await POST(chat({ messages: [{ role: 'user', content: 'hi' }] })));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('streams the canned answer in mock mode without calling Mistral', async () => {
    delete process.env.MISTRAL_API_KEY;
    process.env.MOCK_MISTRAL = '1';
    const evs = await events(await POST(chat({ messages: [{ role: 'user', content: 'hi' }] })));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(evs[0].type).toBe('meta');
    expect(evs.at(-1).type).toBe('done');
  });

  it('rate limits one client without affecting another', async () => {
    fetchMock.mockImplementation(async () => ok(hello));
    const body = { messages: [{ role: 'user', content: 'hi' }] };
    for (let i = 0; i < 8; i++) expect((await POST(chat(body, '192.0.2.1'))).status).toBe(200);
    const limited = await POST(chat(body, '192.0.2.1'));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await POST(chat(body, '192.0.2.2'))).status).toBe(200);
  });
});
