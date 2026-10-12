import { RATE_LIMIT, allowedModels, fallbackChain } from '@/lib/config';
import { encodeEvent, type ChatEvent, type Usage } from '@/lib/events';
import { openMistralStream, type Attempt } from '@/lib/mistral';
import { mockFetch } from '@/lib/mock';
import { createRateLimiter } from '@/lib/rate-limit';
import { SseDataParser } from '@/lib/sse';
import { parseChatRequest } from '@/lib/validate';

export const runtime = 'nodejs';

const limiter = createRateLimiter(RATE_LIMIT);

const MESSAGES: Record<string, string> = {
  upstream_unavailable: 'The model is busy right now. Please try again in a moment.',
  upstream_rejected: 'The model could not answer this request.',
  upstream_auth: 'The server is not configured correctly.',
  client_closed: 'The request was cancelled.',
};

export async function POST(req: Request): Promise<Response> {
  const started = Date.now();
  const requestId = crypto.randomUUID();
  const log = (fields: Record<string, unknown>) =>
    console.log(JSON.stringify({ event: 'chat_request', requestId, ms: Date.now() - started, ...fields }));

  const mock = !process.env.MISTRAL_API_KEY && process.env.MOCK_MISTRAL === '1';
  const apiKey = mock ? 'mock' : process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    log({ outcome: 'missing_api_key' });
    return jsonError(500, 'server_misconfigured', MESSAGES.upstream_auth, requestId);
  }

  const decision = limiter.check(clientIp(req));
  if (!decision.allowed) {
    const seconds = Math.ceil(decision.retryAfterMs / 1000);
    log({ outcome: 'rate_limited' });
    return jsonError(429, 'rate_limited', `Too many messages. Try again in ${seconds} s.`, requestId, {
      'Retry-After': String(seconds),
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'bad_json', 'The request body is not valid JSON.', requestId);
  }

  const allowed = allowedModels();
  const parsed = parseChatRequest(body, allowed);
  if (!parsed.ok) {
    log({ outcome: 'invalid_request' });
    return jsonError(400, 'invalid_request', parsed.message, requestId);
  }

  const { model: requested, messages } = parsed.value;
  const upstream = await openMistralStream({
    apiKey,
    models: fallbackChain(requested, allowed),
    messages,
    signal: req.signal,
    ...(mock ? { fetchImpl: mockFetch } : {}),
  });

  if (!upstream.ok) {
    log({
      outcome: upstream.code,
      requested,
      attempts: summarize(upstream.attempts),
      upstreamMessage: lastMessage(upstream.attempts),
    });
    const status = upstream.code === 'upstream_unavailable' ? 503 : 502;
    return jsonError(status, upstream.code, MESSAGES[upstream.code] ?? MESSAGES.upstream_rejected, requestId);
  }

  const stream = toEventStream(upstream.body, {
    meta: { type: 'meta', model: upstream.model, ...(upstream.model !== requested ? { fallbackFrom: requested } : {}) },
    started,
    onEnd: (outcome, usage, firstTokenMs) =>
      log({
        outcome,
        requested,
        model: upstream.model,
        attempts: summarize(upstream.attempts),
        upstreamMessage: lastMessage(upstream.attempts),
        firstTokenMs,
        usage,
      }),
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Request-Id': requestId,
    },
  });
}

function toEventStream(
  upstream: ReadableStream<Uint8Array>,
  opts: {
    meta: ChatEvent;
    started: number;
    onEnd: (outcome: string, usage: Usage | undefined, firstTokenMs: number | undefined) => void;
  },
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const parser = new SseDataParser();
  const reader = upstream.getReader();
  let usage: Usage | undefined;
  let firstTokenMs: number | undefined;

  const handle = (data: string, emit: (e: ChatEvent) => void) => {
    if (data === '[DONE]') return;
    let chunk: {
      choices?: { delta?: { content?: unknown } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try {
      chunk = JSON.parse(data);
    } catch {
      return;
    }
    const text = chunk.choices?.[0]?.delta?.content;
    if (typeof text === 'string' && text) {
      firstTokenMs ??= Date.now() - opts.started;
      emit({ type: 'delta', text });
    }
    if (chunk.usage) {
      usage = {
        promptTokens: chunk.usage.prompt_tokens ?? 0,
        completionTokens: chunk.usage.completion_tokens ?? 0,
      };
    }
  };

  let cancelled = false;
  let ended = false;
  const end = (outcome: string) => {
    if (ended) return;
    ended = true;
    opts.onEnd(outcome, usage, firstTokenMs);
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: ChatEvent) => {
        if (!cancelled) controller.enqueue(encoder.encode(encodeEvent(e)));
      };
      emit(opts.meta);
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const data of parser.push(decoder.decode(value, { stream: true }))) handle(data, emit);
        }
        for (const data of parser.flush()) handle(data, emit);
        emit({ type: 'done', ms: Date.now() - opts.started, ...(usage ? { usage } : {}) });
        end(cancelled ? 'client_cancelled' : 'completed');
      } catch {
        emit({ type: 'error', code: 'stream_interrupted', message: 'The answer was interrupted. Please try again.' });
        end(cancelled ? 'client_cancelled' : 'stream_interrupted');
      } finally {
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
      end('client_cancelled');
      return reader.cancel();
    },
  });
}

function summarize(attempts: Attempt[]) {
  return attempts.map((a) => `${a.model}:${a.status}`).join(',');
}

// Logged only: the client always gets one of the generic MESSAGES.
function lastMessage(attempts: Attempt[]) {
  return attempts.filter((a) => a.message).at(-1)?.message;
}

function clientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

function jsonError(
  status: number,
  code: string,
  message: string,
  requestId: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId, ...headers },
  });
}
