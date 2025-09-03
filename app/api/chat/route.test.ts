import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'node:stream';

// 先 mock axios，再 import 被测模块
vi.mock('axios', () => {
  const post = vi.fn();
  return { default: { post } };
});

import axios from 'axios';
import { POST } from './route';

// 把字符串数组变 Node Readable 流
function makeNodeStream(chunks: string[]) {
  const r = new Readable({ read() {} });
  for (const c of chunks) r.push(c);
  r.push(null);
  return r;
}

// 备份/恢复环境变量（可选但更干净）
const OLD_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...OLD_ENV, MISTRAL_API_KEY: 'test-key' };
});

afterEach(() => {
  process.env = { ...OLD_ENV };
});

it('returns 500 when missing MISTRAL_API_KEY', async () => {
  delete process.env.MISTRAL_API_KEY;

  const req = new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  }) as any;

  const res = await POST(req);
  expect(res.status).toBe(500);
});

it('filters empty assistant placeholders before calling upstream', async () => {
  // 第一次、第二次 429；第三次成功（触发降级）
  const postMock = (axios as any).post as vi.Mock;
  postMock
    .mockResolvedValueOnce({ status: 429, data: makeNodeStream(['{"object":"error","message":"..."}']) })
    .mockResolvedValueOnce({ status: 429, data: makeNodeStream(['{"object":"error","message":"..."}']) })
    .mockResolvedValueOnce({
      status: 200,
      data: makeNodeStream([
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n',
        'data: [DONE]\n',
      ]),
    });

  const reqBody = {
    model: 'mistral-large-latest',
    messages: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: '' }, // 应被过滤
    ],
  };
  const req = new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reqBody),
  }) as any;

  const res = await POST(req);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toMatch(/text\/event-stream/i);

  // 读取透传的 SSE 内容
  const text = await res.text();
  expect(text).toContain('data: {"choices":[{"delta":{"content":"Hi"}}]}');
  expect(text).toContain('data: [DONE]');

  // 校验发给 axios 的 messages 已过滤掉空 assistant
  const firstCallPayload = (axios as any).post.mock.calls[0][1];
  expect(Array.isArray(firstCallPayload.messages)).toBe(true);
  expect(firstCallPayload.messages.find((m: any) => m.role === 'assistant')).toBeUndefined();
});

it('bubbles up non-429 upstream error with status', async () => {
  // 直接一次 400，路由应把状态/文本原样冒泡
  const postMock = (axios as any).post as vi.Mock;
  postMock.mockResolvedValueOnce({
    status: 400,
    data: makeNodeStream(['{"object":"error","message":"bad request"}']),
  });

  const req = new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  }) as any;

  const res = await POST(req);
  expect(res.status).toBe(400);
  const body = await res.text();
  expect(body).toMatch(/Upstream 400/);
  expect(body).toMatch(/bad request/);
});

it('sets X-Model-Used header to the chosen model (after fallback)', async () => {
  const postMock = (axios as any).post as vi.Mock;
  postMock
    .mockResolvedValueOnce({ status: 429, data: makeNodeStream(['{"object":"error"}']) }) // large 尝试 1
    .mockResolvedValueOnce({ status: 429, data: makeNodeStream(['{"object":"error"}']) }) // large 尝试 2
    // 降级到 medium：成功
    .mockResolvedValueOnce({
      status: 200,
      data: makeNodeStream(['data: {"choices":[{"delta":{"content":"OK"}}]}\n', 'data: [DONE]\n']),
    });

  const req = new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], model: 'mistral-large-latest' }),
  }) as any;

  const res = await POST(req);
  expect(res.status).toBe(200);
  const used = res.headers.get('x-model-used');
  expect(used).toBe('mistral-medium-latest'); // 本用例中第 3 次就是 medium 成功
});
