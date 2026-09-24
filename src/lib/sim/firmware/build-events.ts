/** Browser-safe, bounded SSE reader for the same-origin firmware build stream. */
export interface BuildMessage {
  type: 'status' | 'log' | 'error';
  text: string;
}

const MAX_STREAM_BYTES = 384 * 1024;
const MAX_HEX_CHARS = 256 * 1024;

export async function readSseBuild(
  response: Response,
  fqbn: string,
  emit: (message: BuildMessage) => void,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The build stream has no body.');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error('The build stream ended without an AVR image.');
      total += chunk.value.byteLength;
      if (total > MAX_STREAM_BYTES) throw new Error('The AVR build stream exceeded its size limit.');
      buffer += decoder.decode(chunk.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (!frame || frame.startsWith(':')) continue; // SSE keepalive
        const event = /^event: ([a-z-]+)$/m.exec(frame)?.[1];
        const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
        if (!event || !dataLine) throw new Error('Malformed AVR build stream.');
        const data: unknown = JSON.parse(dataLine.slice(6));
        if (typeof data !== 'object' || data === null) throw new Error('Invalid AVR build event.');
        const value = data as Record<string, unknown>;
        if (event === 'result') {
          if (value.fqbn !== fqbn || typeof value.hex !== 'string' ||
              !value.hex.startsWith(':') || value.hex.length > MAX_HEX_CHARS) {
            throw new Error('The AVR build result did not match its requested board.');
          }
          return value.hex;
        }
        if (event === 'error' && typeof value.message === 'string') {
          emit({ type: 'error', text: value.message.slice(0, 2048) });
          throw new Error(value.message.slice(0, 2048));
        }
        if ((event === 'log' || event === 'status') && typeof value.text === 'string') {
          emit({ type: event, text: value.text.slice(0, 8192) });
          continue;
        }
        throw new Error('Unknown AVR build event.');
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
