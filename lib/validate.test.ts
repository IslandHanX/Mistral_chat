import { describe, expect, it } from 'vitest';
import { LIMITS, type ModelId } from './config';
import { parseChatRequest } from './validate';

const allowed: ModelId[] = ['mistral-small-latest', 'mistral-medium-latest'];
const user = (content: string) => ({ role: 'user', content });

describe('parseChatRequest', () => {
  it('defaults the model and drops the empty assistant placeholder', () => {
    const r = parseChatRequest({ messages: [user('hi'), { role: 'assistant', content: '' }, user('again')] }, allowed);
    expect(r).toEqual({
      ok: true,
      value: { model: 'mistral-small-latest', messages: [user('hi'), user('again')] },
    });
  });

  it('rejects a model outside the allowed list', () => {
    const r = parseChatRequest({ model: 'mistral-large-latest', messages: [user('hi')] }, allowed);
    expect(r.ok).toBe(false);
  });

  it('rejects unknown roles, oversized messages and a conversation not ending on the user', () => {
    expect(parseChatRequest({ messages: [{ role: 'system', content: 'x' }] }, allowed).ok).toBe(false);
    expect(parseChatRequest({ messages: [user('x'.repeat(LIMITS.maxMessageChars + 1))] }, allowed).ok).toBe(false);
    expect(parseChatRequest({ messages: [user('hi'), { role: 'assistant', content: 'yo' }] }, allowed).ok).toBe(false);
  });

  it('rejects a conversation with too many messages', () => {
    const messages = Array.from({ length: LIMITS.maxMessages + 1 }, () => user('a'));
    expect(parseChatRequest({ messages }, allowed).ok).toBe(false);
  });
});
