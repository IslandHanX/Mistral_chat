export const MODEL_ORDER = [
  'mistral-large-latest',
  'mistral-medium-latest',
  'mistral-small-latest',
  'ministral-14b-2512',
  'ministral-8b-2512',
  'ministral-3b-2512',
] as const;

export type ModelId = (typeof MODEL_ORDER)[number];

export const DEFAULT_MODEL: ModelId = 'ministral-8b-2512';

export const LIMITS = {
  maxMessages: 30,
  maxMessageChars: 4_000,
  maxTotalChars: 24_000,
  maxOutputTokens: 1_024,
  timeToFirstByteMs: 20_000,
  attemptsPerModel: 2,
};

export const RATE_LIMIT = { windowMs: 60_000, max: 8 };

export function isModelId(value: unknown): value is ModelId {
  return typeof value === 'string' && (MODEL_ORDER as readonly string[]).includes(value);
}

// Mistral's free tier answers the Large, Medium and Small models with a 429 whatever the traffic,
// so the demo runs on Ministral and the larger models are opt-in through ALLOWED_MODELS.
// Checked on 2026-10-12.
export function allowedModels(env: Record<string, string | undefined> = process.env): ModelId[] {
  const configured = (env.ALLOWED_MODELS ?? 'ministral-14b-2512,ministral-8b-2512,ministral-3b-2512')
    .split(',')
    .map((m) => m.trim())
    .filter(isModelId);
  return configured.length > 0 ? configured : [DEFAULT_MODEL];
}

// MODEL_ORDER runs from the largest model to the smallest: fallback only goes towards smaller ones.
export function fallbackChain(requested: ModelId, allowed: ModelId[]): ModelId[] {
  return MODEL_ORDER.slice(MODEL_ORDER.indexOf(requested)).filter((m) => allowed.includes(m));
}
