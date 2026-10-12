import { useState, type KeyboardEvent } from 'react';

export const MODEL_OPTIONS = [
  { id: 'mistral-small-latest', label: 'Mistral Small' },
  { id: 'mistral-medium-latest', label: 'Mistral Medium' },
];

type Props = {
  pending: boolean;
  model: string;
  onModelChange: (model: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
};

export function Composer({ pending, model, onModelChange, onSend, onStop }: Props) {
  const [text, setText] = useState('');

  const submit = () => {
    if (!text.trim() || pending) return;
    onSend(text);
    setText('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="composer">
      <textarea
        aria-label="Message"
        placeholder="Ask anything. Enter to send, Shift+Enter for a new line."
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="composer-row">
        <select aria-label="Model" value={model} onChange={(e) => onModelChange(e.target.value)}>
          {MODEL_OPTIONS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        {pending ? (
          <button className="btn" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button className="btn primary" onClick={submit} disabled={!text.trim()}>
            Send
          </button>
        )}
      </div>
    </div>
  );
}
