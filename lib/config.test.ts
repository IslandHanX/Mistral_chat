import { describe, expect, it } from 'vitest';
import { allowedModels, fallbackChain } from './config';

describe('model configuration', () => {
  it('allows small and medium by default and reads ALLOWED_MODELS', () => {
    expect(allowedModels({})).toEqual(['mistral-small-latest', 'mistral-medium-latest']);
    expect(allowedModels({ ALLOWED_MODELS: 'mistral-large-latest, nope' })).toEqual(['mistral-large-latest']);
  });

  it('falls back only to cheaper allowed models', () => {
    const all = ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest'] as const;
    expect(fallbackChain('mistral-large-latest', [...all])).toEqual([...all]);
    expect(fallbackChain('mistral-medium-latest', ['mistral-small-latest', 'mistral-medium-latest'])).toEqual([
      'mistral-medium-latest',
      'mistral-small-latest',
    ]);
    expect(fallbackChain('mistral-small-latest', [...all])).toEqual(['mistral-small-latest']);
  });
});
