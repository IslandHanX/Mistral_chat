import { describe, expect, it } from 'vitest';
import { SseDataParser } from './sse';

describe('SseDataParser', () => {
  it('joins a data line split across chunks', () => {
    const p = new SseDataParser();
    expect(p.push('data: {"a"')).toEqual([]);
    expect(p.push(':1}\ndata: [DONE]\n')).toEqual(['{"a":1}', '[DONE]']);
  });

  it('handles CRLF line endings and ignores non-data lines', () => {
    const p = new SseDataParser();
    expect(p.push(': ping\r\nevent: x\r\ndata: hi\r\n\r\n')).toEqual(['hi']);
  });

  it('returns a last line without newline on flush', () => {
    const p = new SseDataParser();
    expect(p.push('data: tail')).toEqual([]);
    expect(p.flush()).toEqual(['tail']);
  });
});
