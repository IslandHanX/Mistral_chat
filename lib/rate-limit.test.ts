import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rate-limit';

describe('createRateLimiter', () => {
  it('blocks after max hits in the window and frees up once it slides', () => {
    const limiter = createRateLimiter({ windowMs: 1_000, max: 2 });
    expect(limiter.check('a', 0).allowed).toBe(true);
    expect(limiter.check('a', 100).allowed).toBe(true);
    const blocked = limiter.check('a', 200);
    expect(blocked).toEqual({ allowed: false, retryAfterMs: 800 });
    expect(limiter.check('b', 200).allowed).toBe(true);
    expect(limiter.check('a', 1_001).allowed).toBe(true);
  });
});
