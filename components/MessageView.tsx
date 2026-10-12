import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { UiMessage } from '@/hooks/useChat';

const short = (model: string) => model.replace(/-(latest|\d{4})$/, '');

export function MessageView({ message, streaming }: { message: UiMessage; streaming: boolean }) {
  if (message.role === 'user') {
    return (
      <div className="msg user">
        <p>{message.content}</p>
      </div>
    );
  }

  const details = [
    message.model && short(message.model),
    message.fallbackFrom && `fell back from ${short(message.fallbackFrom)}`,
    message.ms !== undefined && `${(message.ms / 1000).toFixed(1)} s`,
    message.usage && `${message.usage.completionTokens} tokens`,
  ].filter(Boolean);

  return (
    <div className="msg assistant">
      {message.content ? (
        <div className="markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        </div>
      ) : (
        streaming && !message.error && <div className="typing" aria-label="Waiting for the answer" />
      )}
      {message.error && <p className="msg-error">{message.error}</p>}
      {message.stopped && <p className="msg-note">Stopped.</p>}
      {details.length > 0 && <p className="msg-meta">{details.join(' · ')}</p>}
    </div>
  );
}
