import type { CheckResult } from '../src/shared/types';

/** Reads an NDJSON body, calling onResult for each complete line as it arrives. */
export async function parseNdjsonStream(
  body: ReadableStream<Uint8Array>,
  onResult: (r: CheckResult) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const flushLine = (line: string) => {
    const t = line.trim();
    if (t) onResult(JSON.parse(t) as CheckResult);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      flushLine(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
  }
  buf += decoder.decode();
  flushLine(buf);
}
