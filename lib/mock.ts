// Local development without an API key: streams a canned answer in Mistral's SSE format.
const ANSWER = [
  'A **mutex** lets one thread at a time into a critical section, and only the thread that locked it may unlock it.',
  '\n\nA **semaphore** keeps a counter: up to *n* threads may hold it at once, and any thread may release it.',
  '\n\n```c\nsem_wait(&slots);   /* take one of n slots */\nuse_connection();\nsem_post(&slots);   /* give it back */\n```',
  '\n\nUse a mutex to protect shared state, and a semaphore to cap how many workers use a pool.',
];

export const mockFetch: typeof fetch = async () => {
  const enc = new TextEncoder();
  const words = ANSWER.join('').split(/(?<= )/);
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      await new Promise((r) => setTimeout(r, 25));
      if (i < words.length) {
        const chunk = { choices: [{ delta: { content: words[i++] } }] };
        controller.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        return;
      }
      const usage = { prompt_tokens: 18, completion_tokens: words.length };
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage })}\n\ndata: [DONE]\n\n`));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};
