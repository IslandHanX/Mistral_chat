import { describe, expect, it } from 'vitest';
import { allowedModels, fallbackChain } from './config';

describe('model configuration', () => {
  it('allows the Ministral models by default and reads ALLOWED_MODELS', () => {
    expect(allowedModels({})).toEqual(['ministral-14b-2512', 'ministral-8b-2512', 'ministral-3b-2512']);
    expect(allowedModels({ ALLOWED_MODELS: 'mistral-large-latest, nope' })).toEqual(['mistral-large-latest']);
  });

  it('falls back only to smaller allowed models', () => {
    const all = ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest'] as const;
    expect(fallbackChain('mistral-large-latest', [...all])).toEqual([...all]);
    expect(fallbackChain('mistral-medium-latest', ['mistral-small-latest', 'mistral-medium-latest'])).toEqual([
      'mistral-medium-latest',
      'mistral-small-latest',
    ]);
    expect(fallbackChain('mistral-small-latest', [...all])).toEqual(['mistral-small-latest']);
    expect(fallbackChain('ministral-14b-2512', allowedModels({}))).toEqual([
      'ministral-14b-2512',
      'ministral-8b-2512',
      'ministral-3b-2512',
    ]);
  });
});
