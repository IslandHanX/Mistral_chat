const PROMPTS = [
  'Explain the difference between a mutex and a semaphore with an example.',
  'Write a SQL query that finds duplicate emails in a users table.',
  'Summarise the CAP theorem in three sentences.',
  'Plan a one-day walk around Geneva for a first visit.',
];

export function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="empty">
      <p>Try one of these:</p>
      <div className="prompts">
        {PROMPTS.map((p) => (
          <button key={p} className="prompt" onClick={() => onPick(p)}>
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
