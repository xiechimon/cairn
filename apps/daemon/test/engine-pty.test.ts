import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { EnginePty } from '../src/engine/engine-pty.js';
import type { EnginePtyProcess } from '../src/engine/pty.js';
import { PtyRedactor } from '../src/engine/redactor.js';
import { EngineScrollback } from '../src/engine/scrollback.js';

function fakeProc(): {
  proc: EnginePtyProcess;
  stream: PassThrough;
  written: Buffer[];
  closed: boolean;
} {
  const stream = new PassThrough();
  const written: Buffer[] = [];
  const state = { closed: false };
  const proc: EnginePtyProcess = {
    stream,
    pid: Promise.resolve(1),
    close: () => {
      state.closed = true;
      stream.end();
    },
  };
  stream.on('data', () => {});
  stream.write = ((chunk: unknown) => {
    written.push(Buffer.isBuffer(chunk) ? (chunk as Buffer) : Buffer.from(String(chunk)));
    return true;
  }) as typeof stream.write;
  return {
    proc,
    stream,
    written,
    get closed() {
      return state.closed;
    },
  };
}

describe('EngineScrollback', () => {
  it('replays only chunks after fromSeq, clears and resends all below oldest', () => {
    const ring = new EngineScrollback();
    ring.append(Buffer.alloc(64 * 1024, 0x61));
    ring.append(Buffer.alloc(64 * 1024, 0x62));
    ring.append(Buffer.alloc(64 * 1024, 0x63));
    const replay = ring.replay(2 * 64 * 1024);
    expect(replay).toHaveLength(1);
    expect(replay[0]?.[0]).toBe(0x63);
    const resync = ring.replay(0);
    expect(resync.length).toBe(3);
    ring.append(Buffer.alloc(1024 * 1024, 0x64));
    const below = ring.replay(0);
    expect(below[0]?.toString()).toBe('\x1b[2J\x1b[H');
    expect(Buffer.concat(below.slice(1)).length).toBeGreaterThan(0);
  });
});

describe('PtyRedactor', () => {
  it('redacts a secret split across chunks and never emits it raw', () => {
    const secret = 'ghp_abcdefghij0123456789secret';
    const redactor = new PtyRedactor(() => [secret]);
    const out: string[] = [];
    const pushes = [
      Buffer.from('prompt> ' + secret.slice(0, 10)),
      Buffer.from(secret.slice(10) + ' done\n'),
    ];
    for (const push of pushes) {
      const chunk = redactor.push(push);
      if (chunk !== null) out.push(chunk.toString());
    }
    const flushed = redactor.flush();
    if (flushed !== null) out.push(flushed.toString());
    const joined = out.join('');
    expect(joined).not.toContain(secret);
    expect(joined).toContain('[REDACTED]');
    expect(joined).toContain('prompt> ');
  });

  it('holds a trailing token-charset run until the next chunk', () => {
    const redactor = new PtyRedactor(() => []);
    expect(redactor.push(Buffer.from(`echo ok\n${'a'.repeat(100)}`))?.toString()).toBe('echo ok\n');
  });

  it('holds a lowercase bearer marker so its token is never emitted raw', () => {
    const redactor = new PtyRedactor(() => []);
    const first = redactor.push(Buffer.from(`${'a'.repeat(8)}bearer ${'b'.repeat(64)}`));
    expect(first?.toString()).toBe('a'.repeat(8));
    const second = redactor.push(Buffer.from('c'.repeat(20)));
    expect(second).toBeNull();
    expect(redactor.flush()?.toString()).toBe('[REDACTED]');
  });
});

describe('EnginePty input gating and hold', () => {
  it('drops owner bytes with a stale lease and passes them with the live lease', () => {
    const { proc, written } = fakeProc();
    const pty = new EnginePty(proc, { secrets: () => [] });
    expect(pty.acquireHold('lease-a', 1)).toBe(true);
    pty.writeOwner('lease-b', 9, Buffer.from('stale'));
    pty.writeOwner('lease-a', 1, Buffer.from('live'));
    expect(Buffer.concat(written).toString()).toBe('live');
    pty.close();
  });

  it('queues agent stdin during a hold and flushes in order on release', async () => {
    const { proc, written } = fakeProc();
    const pty = new EnginePty(proc, { secrets: () => [] });
    pty.acquireHold('lease-a', 1);
    const first = pty.writeAgent('steer-1\n');
    const second = pty.writeAgent('steer-2\n');
    expect(written).toHaveLength(0);
    expect(pty.releaseHold('lease-a', 1)).toBe(true);
    await Promise.all([first, second]);
    expect(Buffer.concat(written).toString()).toBe('steer-1\nsteer-2\n');
    pty.close();
  });

  it('rejects held agent input past the queue cap and still flushes queued bytes', async () => {
    const { proc, written } = fakeProc();
    const pty = new EnginePty(proc, { secrets: () => [] });
    pty.acquireHold('lease-a', 1);
    const big = pty.writeAgent(Buffer.alloc(256 * 1024, 0x61));
    await expect(pty.writeAgent('x')).rejects.toThrow(/queue full/);
    expect(pty.releaseHold('lease-a', 1)).toBe(true);
    await big;
    expect(Buffer.concat(written).length).toBe(256 * 1024);
    pty.close();
  });

  it('rejects a takeover hold after close and resumes agent writes on release', async () => {
    const { proc, written } = fakeProc();
    const pty = new EnginePty(proc, { secrets: () => [] });
    pty.acquireHold('lease-a', 1);
    pty.releaseHold('lease-a', 1);
    void pty.writeAgent('back\n');
    expect(Buffer.concat(written).toString()).toBe('back\n');
    pty.close();
    expect(pty.acquireHold('lease-b', 2)).toBe(false);
    await expect(pty.writeAgent('late')).rejects.toThrow();
  });
});
