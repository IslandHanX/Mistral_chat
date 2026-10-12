// Events the API streams to the browser, one JSON object per line (NDJSON).
export type Usage = { promptTokens: number; completionTokens: number };

export type ChatEvent =
  | { type: 'meta'; model: string; fallbackFrom?: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; ms: number; usage?: Usage }
  | { type: 'error'; code: string; message: string };

export function encodeEvent(event: ChatEvent): string {
  return `${JSON.stringify(event)}\n`;
}
