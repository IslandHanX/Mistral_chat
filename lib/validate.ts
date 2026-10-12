import { DEFAULT_MODEL, LIMITS, isModelId, type ModelId } from './config';

export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export type ChatRequest = { messages: ChatMessage[]; model: ModelId };
export type Validation = { ok: true; value: ChatRequest } | { ok: false; message: string };

export function parseChatRequest(body: unknown, allowed: ModelId[]): Validation {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, message: 'The request body must be a JSON object.' };
  }
  const { messages, model } = body as { messages?: unknown; model?: unknown };

  const requestedModel = model ?? DEFAULT_MODEL;
  if (!isModelId(requestedModel) || !allowed.includes(requestedModel)) {
    return { ok: false, message: `Unsupported model. Allowed: ${allowed.join(', ')}.` };
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, message: 'messages must be a non-empty array.' };
  }

  const cleaned: ChatMessage[] = [];
  for (const m of messages) {
    const role = (m as { role?: unknown })?.role;
    const content = (m as { content?: unknown })?.content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') {
      return { ok: false, message: 'Each message needs a role (user or assistant) and a string content.' };
    }
    // The client sends the empty placeholder of the answer it is waiting for.
    if (role === 'assistant' && content.trim() === '') continue;
    if (content.length > LIMITS.maxMessageChars) {
      return { ok: false, message: `A message is longer than ${LIMITS.maxMessageChars} characters.` };
    }
    cleaned.push({ role, content });
  }

  if (cleaned.length > LIMITS.maxMessages) {
    return { ok: false, message: `The conversation is longer than ${LIMITS.maxMessages} messages. Start a new one.` };
  }
  const total = cleaned.reduce((sum, m) => sum + m.content.length, 0);
  if (total > LIMITS.maxTotalChars) {
    return { ok: false, message: 'The conversation is too long. Start a new one.' };
  }
  if (cleaned.at(-1)?.role !== 'user' || cleaned.at(-1)?.content.trim() === '') {
    return { ok: false, message: 'The last message must be a non-empty user message.' };
  }

  return { ok: true, value: { messages: cleaned, model: requestedModel } };
}
