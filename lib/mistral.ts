import { LIMITS, type ModelId } from './config';
import type { ChatMessage } from './validate';

const MISTRAL_URL = 'https://api.mistral.ai/v1/chat/completions';
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export type Attempt = { model: ModelId; status: number | 'timeout' | 'network'; message?: string };

export type UpstreamResult =
  | { ok: true; model: ModelId; body: ReadableStream<Uint8Array>; attempts: Attempt[] }
  | { ok: false; status: number; code: string; attempts: Attempt[] };

type Options = {
  apiKey: string;
  models: ModelId[];
  messages: ChatMessage[];
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Retries and falls back only until the first byte: once text has reached the
// user, switching model would mix two answers.
export async function openMistralStream({
  apiKey,
  models,
  messages,
  signal,
  fetchImpl = fetch,
  sleep = defaultSleep,
}: Options): Promise<UpstreamResult> {
  const attempts: Attempt[] = [];

  for (const model of models) {
    for (let attempt = 0; attempt < LIMITS.attemptsPerModel; attempt++) {
      if (attempt > 0) {
        const base = 250 * 2 ** (attempt - 1);
        await sleep(base + Math.floor(Math.random() * base));
      }
      if (signal?.aborted) return { ok: false, status: 499, code: 'client_closed', attempts };

      const timeout = AbortSignal.timeout(LIMITS.timeToFirstByteMs);
      let res: Response;
      try {
        res = await fetchImpl(MISTRAL_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify({
            model,
            messages,
            stream: true,
            temperature: 0.3,
            max_tokens: LIMITS.maxOutputTokens,
            safe_prompt: true,
          }),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
      } catch (err) {
        if (signal?.aborted) return { ok: false, status: 499, code: 'client_closed', attempts };
        attempts.push({
          model,
          status: timeout.aborted ? 'timeout' : 'network',
          message: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      if (res.ok && res.body) return { ok: true, model, body: res.body, attempts };

      attempts.push({ model, status: res.status, message: await errorMessage(res) });
      if (!RETRYABLE.has(res.status)) {
        // 401/403 mean the server's key is wrong; 400/422 mean a request the provider refuses.
        const code = res.status === 401 || res.status === 403 ? 'upstream_auth' : 'upstream_rejected';
        return { ok: false, status: res.status, code, attempts };
      }
    }
  }

  return { ok: false, status: 503, code: 'upstream_unavailable', attempts };
}

async function errorMessage(res: Response): Promise<string | undefined> {
  const text = await res.text().catch(() => '');
  let message = text;
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    if (typeof parsed.message === 'string') message = parsed.message;
  } catch {
    // Not JSON: keep the raw text.
  }
  return message.trim().slice(0, 200) || undefined;
}
