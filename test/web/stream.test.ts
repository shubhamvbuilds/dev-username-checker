import { describe, it, expect } from 'vitest';
import { parseNdjsonStream } from '../../web/stream';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const s of chunks) c.enqueue(enc.encode(s));
      c.close();
    },
  });
}

describe('parseNdjsonStream', () => {
  it('handles lines split across chunks and a final line without newline', async () => {
    const got: unknown[] = [];
    await parseNdjsonStream(streamOf(['{"a":1}\n{"a"', ':2}\n\n{"a":3}']), (r) => got.push(r));
    expect(got).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it('handles a multibyte character split across chunks', async () => {
    const bytes = new TextEncoder().encode('{"a":"é"}\n');
    const body = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(bytes.slice(0, 7)); c.enqueue(bytes.slice(7)); c.close(); },
    });
    const got: unknown[] = [];
    await parseNdjsonStream(body, (r) => got.push(r));
    expect(got).toEqual([{ a: 'é' }]);
  });
});
