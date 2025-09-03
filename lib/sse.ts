// lib/sse.ts
export function extractDeltaContentFromSSE(buffer: string): string[] {
  const out: string[] = [];
  for (const line of buffer.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const obj = JSON.parse(data);
      const delta = obj?.choices?.[0]?.delta?.content ?? '';
      if (delta) out.push(delta);
    } catch {
      // 忽略半包，等下一轮
    }
  }
  return out;
}
