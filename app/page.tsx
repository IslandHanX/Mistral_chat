"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useRef, useState } from "react";
import "./globals.css";

type Msg = { role: "user" | "assistant" | "system"; content: string };
const DEFAULT_MODEL = "mistral-large-latest";

export default function Page() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState(
    "Bonjour! Parlez-moi du fromage français."
  );
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [pending, setPending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null); // ✅ 挪到组件里


  async function send() {
    if (!input.trim() || pending) return;

    // 先把 UI 里的占位加上（用于即时渲染）
    const next: Msg[] = [
      ...messages,
      { role: "user", content: input },
      { role: "assistant", content: "" },
    ];
    setMessages(next);
    setInput("");
    setPending(true);

    // ✅ 发送给后端时，过滤掉空的 assistant 占位
    const messagesForApi = next.filter(
      (m) => !(m.role === "assistant" && !m.content?.trim())
    );

    const ac = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ac;

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: messagesForApi, model }),
      signal: ac.signal,
    });

    if (!res.ok || !res.body) {
      const errText = await res.text(); // ← 先拿到文本
      setPending(false);
      setMessages((curr) => {
        const copy = [...curr];
        copy[copy.length - 1] = { role: "assistant", content: `⚠️ ${errText}` };
        return copy;
      });
      return;
    }

	// 读取 SSE 流并解析每一行的 data: {...}
// 读取 SSE 流并解析每一行的 data: {...}
let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

try {
  reader = res.body!.getReader();
  readerRef.current = reader;

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read(); // ← abort 时会抛 AbortError
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);

      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      try {
        const obj = JSON.parse(payload);
        const delta: string = obj?.choices?.[0]?.delta?.content ?? '';
        if (!delta) continue;

        setMessages(curr => {
          const copy = [...curr];
          const last = copy[copy.length - 1];
          if (last?.role === 'assistant') {
            copy[copy.length - 1] = { role: 'assistant', content: (last.content || '') + delta };
          }
          return copy;
        });
      } catch {
        // 半包/残片，忽略
      }
    }
  }
} catch (err: any) {
  // 用户点了 Stop：忽略这类错误，避免红卡
  if (err?.name === 'AbortError' || /aborted|BodyStreamBuffer was aborted/i.test(err?.message || '')) {
    // no-op
  } else {
    // 其他异常才展示
    setMessages(curr => {
      const copy = [...curr];
      const last = copy[copy.length - 1];
      const msg = `⚠️ ${err?.message || String(err)}`;
      copy[copy.length - 1] = { role: 'assistant', content: last?.role === 'assistant' ? (last.content || '') + `\n\n${msg}` : msg };
      return copy;
    });
  }
} finally {
  try { await readerRef.current?.cancel(); } catch {}
  readerRef.current = null;
  setPending(false);
  abortRef.current = null;
}}

function stop() {
  try { readerRef.current?.cancel(); } catch {}
  abortRef.current?.abort();
  abortRef.current = null;
  setPending(false);
}


function reset() {
  stop();
  setMessages([]);
  setInput('');
}


  return (
    <div className="container">
      <h1>
        Mistral Chat <span className="meta">Next.js • streaming</span>
      </h1>
      <div className="card" style={{ marginTop: 12 }}>
        <div
          className="row"
          style={{ alignItems: "center", justifyContent: "space-between" }}
        >
          <div className="row" style={{ alignItems: "center" }}>
            <label className="meta" htmlFor="model">
              Model:&nbsp;
            </label>
            <select
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              <option value="mistral-large-latest">mistral-large-latest</option>
              <option value="mistral-small-latest">mistral-small-latest</option>
              <option value="pixtral-large-latest">
                pixtral-large-latest (vision)
              </option>
              <option value="codestral-latest">codestral-latest</option>
            </select>
          </div>
          <div className="row">
            {!pending ? (
              <button className="btn" onClick={reset}>
                Reset
              </button>
            ) : (
              <button className="btn" onClick={stop}>
                Stop
              </button>
            )}
          </div>
        </div>
        <hr />
        <div>
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <div className="meta">{m.role}</div>
              <div className="msg-body">
                {m.role === "assistant" ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {m.content || "..."}
                  </ReactMarkdown>
                ) : (
                  <p>{m.content}</p>
                )}
              </div>
            </div>
          ))}
        </div>
        <hr />
        <div className="row">
          <input
            className="input"
            placeholder="Type your message…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button
            className="btn"
            onClick={send}
            disabled={pending || !input.trim()}
          >
            {pending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
