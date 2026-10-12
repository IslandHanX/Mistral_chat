// Incremental parser for `data:` lines of a server-sent event stream: a line can
// arrive split across chunks, so the unfinished tail is kept until the next push.
export class SseDataParser {
  private buffer = '';

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? '';
    return lines.flatMap(dataOf);
  }

  flush(): string[] {
    const rest = this.buffer;
    this.buffer = '';
    return dataOf(rest);
  }
}

function dataOf(line: string): string[] {
  if (!line.startsWith('data:')) return [];
  const data = line.slice(5).trim();
  return data ? [data] : [];
}
