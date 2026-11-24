import { describe, expect, test, vi } from 'vitest';
import { createSerialConnection, SSE_MAX_PENDING_WRITES } from '../src/services/events.js';
import { bootServer } from './helpers.js';

async function headersOf(app: ReturnType<typeof bootServer>['app'], path: string) {
  const ctrl = new AbortController();
  const res = await app.request(path, { signal: ctrl.signal });
  const headers = {
    type: res.headers.get('content-type'),
    buffering: res.headers.get('x-accel-buffering'),
    cache: res.headers.get('cache-control'),
  };
  ctrl.abort();
  await res.body?.cancel().catch(() => {});
  return headers;
}

describe('SSE responses are safe behind a buffering proxy', () => {
  test.each([
    ['team stream', (teamId: string) => `/api/teams/${teamId}/stream`],
    ['conversation stream', () => '/api/conversations/conv-a/stream'],
  ])('the %s opts out of proxy buffering and transformation', async (_name, path) => {
    const s = bootServer({ pingIntervalMs: 60_000 });
    const headers = await headersOf(s.app, path(s.team.id));
    expect(headers.type).toContain('text/event-stream');
    expect(headers.buffering).toBe('no');
    expect(headers.cache).toBe('no-cache, no-transform');
  });
});

describe('a stalled consumer is closed instead of growing the write queue', () => {
  test('past the cap the connection reports overflow once and drops later frames', async () => {
    let overflows = 0;
    let written = 0;
    const stalled = new Promise<void>(() => {});
    const conn = createSerialConnection(
      () => {
        written += 1;
        return stalled;
      },
      { maxPending: 3, onOverflow: () => (overflows += 1) },
    );
    for (let i = 0; i < 10; i++) void conn.send({ n: i });
    await Promise.resolve();
    expect(overflows).toBe(1);
    expect(written).toBe(1);
  });

  test('a consumer that keeps up never overflows', async () => {
    let overflows = 0;
    const seen: unknown[] = [];
    const conn = createSerialConnection(
      async (payload) => {
        seen.push(payload);
      },
      { maxPending: 3, onOverflow: () => (overflows += 1) },
    );
    for (let i = 0; i < 50; i++) await conn.send({ n: i });
    expect(overflows).toBe(0);
    expect(seen).toHaveLength(50);
  });

  test('the default cap matches the 4096 frames other agent servers allow', () => {
    expect(SSE_MAX_PENDING_WRITES).toBe(4096);
  });
});

describe('every SSE route goes through the header helper', () => {
  test('no route file calls streamSSE directly', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const dir = new URL('../src/', import.meta.url);
    const offenders = readdirSync(dir)
      .filter((name) => name.startsWith('routes') && name.endsWith('.ts'))
      .filter((name) => readFileSync(new URL(name, dir), 'utf8').includes('streamSSE('));
    expect(offenders).toEqual([]);
  });
});

describe('the team stream route closes a reader that stops reading', () => {
  test('publishing past the cap to an unread stream drops its subscription', async () => {
    const s = bootServer({ pingIntervalMs: 60_000 });
    const ctrl = new AbortController();
    const res = await s.app.request(`/api/teams/${s.team.id}/stream`, { signal: ctrl.signal });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(s.hub.subscriberCount(s.team.id)).toBe(1));
    for (let i = 0; i < SSE_MAX_PENDING_WRITES + 100; i++) {
      s.hub.publish(s.team.id, () => ({ type: 'ping' }));
    }
    await vi.waitFor(() => expect(s.hub.subscriberCount(s.team.id)).toBe(0));
    ctrl.abort();
  });
});
