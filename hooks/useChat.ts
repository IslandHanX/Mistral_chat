'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatEvent, Usage } from '@/lib/events';

export type UiMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  fallbackFrom?: string;
  ms?: number;
  usage?: Usage;
  error?: string;
  stopped?: boolean;
};

const STORAGE_KEY = 'mistral-chat:v1';
const uid = () => Math.random().toString(36).slice(2, 10);

export function useChat() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [pending, setPending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setMessages(JSON.parse(saved));
    } catch {
      // Private mode or a corrupted entry: start empty.
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // Storage full or unavailable: the chat still works, it is just not kept.
    }
  }, [messages]);

  const patchLast = useCallback((patch: (m: UiMessage) => UiMessage) => {
    setMessages((curr) => {
      const last = curr.at(-1);
      if (last?.role !== 'assistant') return curr;
      return [...curr.slice(0, -1), patch(last)];
    });
  }, []);

  const apply = useCallback(
    (event: ChatEvent) => {
      switch (event.type) {
        case 'meta':
          return patchLast((m) => ({ ...m, model: event.model, fallbackFrom: event.fallbackFrom }));
        case 'delta':
          return patchLast((m) => ({ ...m, content: m.content + event.text }));
        case 'done':
          return patchLast((m) => ({ ...m, ms: event.ms, usage: event.usage }));
        case 'error':
          return patchLast((m) => ({ ...m, error: event.message }));
      }
    },
    [patchLast],
  );

  const send = useCallback(
    async (text: string, model: string) => {
      const content = text.trim();
      if (!content || pending) return;

      const history: UiMessage[] = [...messages, { id: uid(), role: 'user', content }];
      setMessages([...history, { id: uid(), role: 'assistant', content: '' }]);
      setPending(true);

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: history.map(({ role, content }) => ({ role, content })),
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const message = await readError(res);
          patchLast((m) => ({ ...m, error: message }));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) if (line.trim()) apply(JSON.parse(line) as ChatEvent);
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          patchLast((m) => ({ ...m, stopped: true }));
        } else {
          patchLast((m) => ({ ...m, error: 'Network error. Please try again.' }));
        }
      } finally {
        abortRef.current = null;
        setPending(false);
      }
    },
    [messages, pending, apply, patchLast],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
  }, []);

  return { messages, pending, send, stop, reset };
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body?.error?.message) return body.error.message;
  } catch {
    // Not JSON: fall through to a generic message.
  }
  return `Request failed (${res.status}).`;
}
