'use client';

import { useEffect, useRef, useState } from 'react';
import { Composer, MODEL_OPTIONS } from '@/components/Composer';
import { EmptyState } from '@/components/EmptyState';
import { MessageView } from '@/components/MessageView';
import { useChat } from '@/hooks/useChat';
import './globals.css';

export default function Page() {
  const { messages, pending, send, stop, reset } = useChat();
  const [model, setModel] = useState(MODEL_OPTIONS[0].id);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages]);

  return (
    <main className="app">
      <header className="header">
        <div>
          <h1>Mistral Chat</h1>
          <p className="subtitle">Streaming answers from Mistral AI, with model fallback and rate limiting.</p>
        </div>
        {messages.length > 0 && (
          <button className="btn" onClick={reset}>
            New chat
          </button>
        )}
      </header>

      <section className="messages" aria-live="polite">
        {messages.length === 0 ? (
          <EmptyState onPick={(p) => send(p, model)} />
        ) : (
          messages.map((m, i) => (
            <MessageView key={m.id} message={m} streaming={pending && i === messages.length - 1} />
          ))
        )}
        <div ref={endRef} />
      </section>

      <Composer pending={pending} model={model} onModelChange={setModel} onSend={(t) => send(t, model)} onStop={stop} />

      <footer className="footer">
        <a href="https://github.com/IslandHanX/Mistral_chat" target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
        <span>Conversations stay in your browser.</span>
      </footer>
    </main>
  );
}
