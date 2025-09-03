# Mistral Next.js Chat (Streaming)

A minimal, production‑leaning chat app built with **Next.js (App Router)** + **TypeScript** that streams responses from **Mistral AI**’s public API.

---

## Features

- Server‑side proxy to **avoid exposing your API key**
- **Streaming** tokens to the browser for a responsive chat UX
- Sensible defaults: `mistral-large-latest`, `temperature=0.2`, `safe_prompt=true`
- Auto‑fallback when the preferred model returns **429 capacity** (tries `mistral-medium-latest`, then `mistral-small-latest`)
- Robust TLS handling (honors `NODE_EXTRA_CA_CERTS`; optional `ALLOW_INSECURE_TLS` for local debugging)
- Type‑safe, small footprint, no extra UI libs
- **Unit tests** for the server route, client streaming UI, and a tiny SSE parser

---

## Quickstart

1) **Clone or unzip** this project and `cd` into it.  
2) **Install deps** (Node 18+ recommended):

```bash
npm i
# or: pnpm i / yarn
```

3) **Add API key**:
   - Copy `.env.example` → `.env.local`
   - Put your key in `MISTRAL_API_KEY="..."`

4) **Run the dev server**:

```bash
npm run dev
```

Open http://localhost:3000

---

## How it works

- The UI posts your conversation to `/api/chat`.
- The API route calls Mistral’s **Chat Completions** endpoint with `{ stream: true }`  
  and **re‑streams** the upstream SSE to the browser.
- On the client, we read the `ReadableStream` line‑by‑line, parse `data: {...}`, and
  incrementally update the last assistant message (rendered with `react-markdown` + GFM).

---

## Project structure

```
mistral-next-chat/
├─ app/
│  ├─ api/chat/route.ts     # Node runtime route; proxies & streams SSE from Mistral (with 429 fallback)
│  ├─ globals.css           # Minimal styling
│  └─ page.tsx              # Chat UI + streaming client code (Stop/Reset, Markdown render)
├─ lib/
│  └─ sse.ts                # Tiny SSE line parser (also unit-tested)
├─ tests/
│  ├─ sse.test.ts           # Parser smoke test
│  ├─ app/api/chat/route.test.ts   # Server route tests (axios mocked; Node Readable)
│  └─ app/page.test.tsx     # Client streaming UI tests (jsdom; ReadableStream)
├─ .env.example
├─ package.json
├─ tsconfig.json
└─ README.md
```

---

## Testing

Run the full test suite:

```bash
npm test
```

Generate coverage:

```bash
npm test -- --coverage
```

Run a specific file / test:

```bash
npx vitest app/page.test.tsx -t "Stop aborts cleanly"
```

### What the tests cover

#### 1) Server route — `app/api/chat/route.test.ts`

- **returns 500 when missing `MISTRAL_API_KEY`**  
  Guard clause so we don’t hit the upstream without credentials.

- **filters empty assistant placeholders before calling upstream**  
  UI inserts an empty assistant message as a streaming placeholder; we strip it
  to avoid Mistral 400: “At least one content or tool_calls should be non‑empty”.

- **bubbles up non‑429 upstream error with status**  
  For non‑capacity errors (e.g., 400), we propagate status & response body so the
  client can surface a meaningful error.

- **sets `X-Model-Used` header to the chosen model (after fallback)**  
  If `mistral-large-latest` returns 429 capacity exceeded, we fall back to
  `mistral-medium-latest`, then `mistral-small-latest`. The final selection is
  exposed via the response header.

> **Technical notes:**  
> - `axios` is **fully mocked**.  
> - Upstream bodies are faked with **Node `Readable` streams** to emulate SSE and error payloads.  
> - No real network calls happen in tests.

#### 2) Client streaming UI — `app/page.test.tsx`

- **renders assistant markdown as chunks arrive (SSE parsing)**  
  We stub `fetch` to return a **finite** browser `ReadableStream` that emits:
  ```
  data: {"choices":[{"delta":{"content":"Bonjour"}}]}

  data: {"choices":[{"delta":{"content":" !"}}]}

  data: [DONE]
  ```
  The test waits until a paragraph renders **“Bonjour !”**.

- **Stop aborts cleanly without throwing and resets pending state**  
  We stub `fetch` to return a **never‑ending** stream (no `close()`), click **Send**, then **Stop**.  
  Assertions:
  - Cancels the reader and resets UI from **Stop → Reset** (`pending=false`).
  - No uncaught errors.

> **Technical notes:**  
> - Environment: `jsdom` + `@testing-library/react`.  
> - To avoid “Found multiple elements …” when querying text that may appear in multiple nodes,
>   use a **selector** to scope the assertion, e.g. `findByText('Bonjour !', { selector: 'p', exact: true })`.  
> - Global `fetch` is restored after each test.

#### 3) SSE parser smoke test — `tests/sse.test.ts`

- Light check that we can extract `choices[0].delta.content` from `data:` lines.  
- Handles **partial chunks**, **empty lines**, and **[DONE]** gracefully.

### How we mock streaming

**Browser (client tests):** build `ReadableStream`s.

```ts
// Finite stream (closes after all lines)
function makeFiniteSSE(lines: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      let i = 0;
      const push = () => {
        if (i >= lines.length) return controller.close();
        controller.enqueue(enc.encode(lines[i++]));
        queueMicrotask(push);
      };
      push();
    },
  });
}

// Never-ending stream (used by the Stop test)
function makeNeverEndingSSE(first = 'data: {\"choices\":[{\"delta\":{\"content\":\"chunk\"}}]}\n') {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(first));
      // no close(); waits for reader.cancel()
    },
  });
}
```

**Server route (route tests):** emulate upstream with **Node `Readable`**.

```ts
import { Readable } from 'node:stream';

function makeNodeStream(chunks: string[]) {
  const r = new Readable({ read() {} });
  for (const c of chunks) r.push(c);
  r.push(null);
  return r;
}
```

---

## Notes & Tips

- **Never** expose your API key in client code. All Mistral calls go through the server route.
- You can switch models in the UI or change the default in `app/api/chat/route.ts`.
- For deployments (e.g., Vercel), set `MISTRAL_API_KEY` in project env vars.
- If you’re behind a TLS‑inspecting proxy:
  - Provide a custom CA via `NODE_EXTRA_CA_CERTS`, or
  - As a last resort for **local debugging only**, set `ALLOW_INSECURE_TLS=1`.

---

## Environment variables

Create `.env.local` and set:

```bash
MISTRAL_API_KEY=YOUR_KEY_HERE

# Optional: override the API base URL (useful if you run a local proxy or custom gateway)
# MISTRAL_API_BASE_URL=http://127.0.0.1:8787

# Optional: custom CA bundle for TLS‑inspecting networks
# NODE_EXTRA_CA_CERTS=/path/to/cert.pem

# Optional: local debug only — disable TLS verification
# ALLOW_INSECURE_TLS=1
```

If you are on a restricted network and need a proxy, run a local forwarder and point
`MISTRAL_API_BASE_URL` to it (e.g., `http://localhost:8080`). The server route will
send requests to `${MISTRAL_API_BASE_URL}/v1/chat/completions` if provided, otherwise
it uses `https://api.mistral.ai`.

---

## References

- Mistral Chat Completions + Streaming (`stream: true`) and SSE format – see official API docs.
- Model aliases like `mistral-large-latest` – see Mistral model overview.
- Next.js App Router streaming patterns – see official Next.js docs/blog.

---

Made for the Mistral AI chat task. Have fun! 🎯
