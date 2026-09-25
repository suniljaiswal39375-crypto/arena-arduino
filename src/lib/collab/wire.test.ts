import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  decodeClientFrame,
  decodeServerFrame,
  decodeWireFrame,
  encodeClientFrame,
  encodeServerFrame,
  encodeWireFrame,
} from './wire';
import type { CollabWireMessage } from './session';

describe('collab wire protocol', () => {
  it('round-trips base64 payloads, including empty and chunk-boundary sizes', () => {
    for (const size of [0, 1, 255, 0x8000, 0x8000 + 7, 0x12000]) {
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + 7) % 256;
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    }
  });

  it('round-trips every session wire message kind through client frames', () => {
    const messages: CollabWireMessage[] = [
      { kind: 'hello', from: 'abc123' },
      { kind: 'update', from: 'abc123', data: new Uint8Array([0, 1, 2, 250, 255]) },
      {
        kind: 'presence',
        from: 'abc123',
        state: {
          clientId: 'abc123',
          name: 'Asha',
          color: '#123456',
          selectedPartId: 'part-1',
          role: 'editor',
          caret: null,
          updatedAt: 42,
        },
      },
      { kind: 'presence', from: 'abc123', state: null },
    ];
    for (const msg of messages) {
      const text = encodeClientFrame({ t: 'msg', frame: encodeWireFrame(msg) });
      const decoded = decodeClientFrame(text);
      expect(decoded?.t).toBe('msg');
      if (decoded?.t === 'msg') {
        const wire = decodeWireFrame(decoded.frame);
        expect(wire).toEqual(msg);
      }
    }
  });

  it('round-trips join frames and truncates over-long presence names on decode', () => {
    const join = decodeClientFrame(encodeClientFrame({ t: 'join', room: 'room-1' }));
    expect(join).toEqual({ t: 'join', room: 'room-1' });

    const long = 'x'.repeat(120);
    const frame = encodeWireFrame({
      kind: 'presence',
      from: 'p1',
      state: {
        clientId: 'p1',
        name: long,
        color: '#000000',
        role: 'editor',
        selectedPartId: null,
        updatedAt: 1,
      },
    });
    const decoded = decodeWireFrame(frame);
    expect(decoded?.kind === 'presence' && decoded.state?.name.length).toBe(40);
  });

  it('rejects malformed client frames instead of throwing', () => {
    expect(decodeClientFrame('not json')).toBeNull();
    expect(decodeClientFrame('"just a string"')).toBeNull();
    expect(decodeClientFrame(JSON.stringify({ t: 'join' }))).toBeNull();
    expect(decodeClientFrame(JSON.stringify({ t: 'join', room: 42 }))).toBeNull();
    expect(decodeClientFrame(JSON.stringify({ t: 'nope' }))).toBeNull();
    // A message before joining, with a broken frame.
    expect(decodeClientFrame(JSON.stringify({ t: 'msg', frame: { kind: 'update' } }))).toBeNull();
    // Bad base64 in an update must decode to null, not throw.
    const bad = decodeClientFrame(
      JSON.stringify({ t: 'msg', frame: { kind: 'update', from: 'a', data: '!!!' } }),
    );
    expect(bad).toBeNull();
  });

  it('round-trips server frames and normalises unknown error codes', () => {
    const joinedNull = decodeServerFrame(
      encodeServerFrame({ t: 'joined', room: 'r', state: null }),
    );
    expect(joinedNull).toEqual({ t: 'joined', room: 'r', state: null });

    const joinedState = decodeServerFrame(
      encodeServerFrame({ t: 'joined', room: 'r', state: 'AAAA' }),
    );
    expect(joinedState).toEqual({ t: 'joined', room: 'r', state: 'AAAA' });

    const err = decodeServerFrame(
      JSON.stringify({ t: 'error', code: 'made-up', message: 'm' }),
    );
    expect(err).toEqual({ t: 'error', code: 'bad-frame', message: 'm' });

    expect(decodeServerFrame('garbage')).toBeNull();
    expect(decodeServerFrame(JSON.stringify({ t: 'msg' }))).toBeNull();
  });

  it('parses a valid remote caret and rejects malformed ones', () => {
    const good = decodeWireFrame({
      kind: 'presence',
      from: 'p1',
      state: {
        clientId: 'p1',
        name: 'Asha',
        color: '#e63946',
        role: 'editor',
        selectedPartId: null,
        caret: { file: 'sketch.ino', offset: 42 },
        updatedAt: 1,
      },
    });
    expect(good?.kind === 'presence' && good.state?.caret).toEqual({ file: 'sketch.ino', offset: 42 });

    for (const bad of [
      { file: 'sketch.ino', offset: 'twelve' },
      { file: 'sketch.ino', offset: -1 },
      { file: 'sketch.ino', offset: Number.NaN },
      { offset: 5 },
      'sketch.ino:5',
    ]) {
      const decoded = decodeWireFrame({
        kind: 'presence',
        from: 'p2',
        state: {
          clientId: 'p2',
          name: 'Bo',
          color: '#3a86ff',
          role: 'editor',
          selectedPartId: null,
          caret: bad,
          updatedAt: 1,
        },
      } as never);
      expect(decoded?.kind === 'presence' && decoded.state?.caret).toBeNull();
    }
  });
});
