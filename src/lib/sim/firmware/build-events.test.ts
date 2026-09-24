import { describe, expect, it } from 'vitest';
import { readSseBuild, type BuildMessage } from './build-events';

const fqbn = 'arduino:avr:uno';
function response(chunks: Uint8Array[]): Response {
  return new Response(new ReadableStream({
    start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); },
  }), { headers: { 'content-type': 'text/event-stream' } });
}

describe('bounded SSE AVR build stream', () => {
  it('reassembles split UTF-8/event boundaries, ignores heartbeats and yields only the requested HEX', async () => {
    const bytes = new TextEncoder().encode(': keepalive\n\nevent: status\ndata: {"text":"Building…"}\n\n' +
      'event: log\ndata: {"text":"avr-gcc ✓"}\n\n' +
      'event: result\ndata: {"fqbn":"arduino:avr:uno","hex":":00000001FF"}\n\n');
    const chunks = [...bytes].map((value) => new Uint8Array([value]));
    const events: BuildMessage[] = [];
    const hex = await readSseBuild(response(chunks), fqbn, (event) => events.push(event));
    expect(hex).toBe(':00000001FF');
    expect(events).toEqual([{ type: 'status', text: 'Building…' }, { type: 'log', text: 'avr-gcc ✓' }]);
  });

  it('surfaces a compiler error but never invents a HEX image', async () => {
    const bytes = new TextEncoder().encode('event: error\ndata: {"code":"compile-failed","message":"bad syntax"}\n\n');
    const events: BuildMessage[] = [];
    await expect(readSseBuild(response([bytes]), fqbn, (event) => events.push(event))).rejects.toThrow('bad syntax');
    expect(events).toEqual([{ type: 'error', text: 'bad syntax' }]);
  });

  it('rejects the wrong board, truncated stream and unbounded output', async () => {
    const wrong = new TextEncoder().encode('event: result\ndata: {"fqbn":"arduino:avr:nano","hex":":00000001FF"}\n\n');
    await expect(readSseBuild(response([wrong]), fqbn, () => {})).rejects.toThrow(/requested board/);
    await expect(readSseBuild(response([new TextEncoder().encode(': ping\n\n')]), fqbn, () => {})).rejects.toThrow(/without an AVR image/);
    const huge = new Uint8Array(385 * 1024);
    await expect(readSseBuild(response([huge]), fqbn, () => {})).rejects.toThrow(/size limit/);
  });
});
