import { createHash } from 'node:crypto';
import { type MachineStreamEvent, machineEnrollResponseSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { machine as machineTable, team as teamTable } from '../src/db/schema.js';
import { createApiKey } from '../src/services/api-keys.js';
import { MACHINE_OFFLINE_GRACE_MS, MachineWakeHub } from '../src/services/machine-wake-hub.js';
import { sweepStaleMachines } from '../src/services/machines.js';
import { bootServer, type TestServer } from './helpers.js';

const GRACE_MS = 600;

const servers: TestServer[] = [];
const streams: { abort: () => void }[] = [];
afterEach(() => {
  for (const st of streams.splice(0)) st.abort();
  for (const s of servers.splice(0)) s.dispose();
  vi.useRealTimers();
});

function boot(opts: { pingIntervalMs?: number } = {}): TestServer {
  const s = bootServer({ offlineGraceMs: GRACE_MS, ...opts });
  servers.push(s);
  return s;
}

function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

function issueKey(s: TestServer): string {
  return createApiKey(s, {
    teamId: s.team.id,
    name: 'grace',
    gitAccess: false,
    mcpAccess: false,
    machineAccess: true,
    toolGrants: { read: [], write: [] },
  }).plaintext;
}

async function enroll(s: TestServer, apiKey: string, name = 'grace-box') {
  const res = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: apiKey,
    body: readyMachine({ teamId: s.team.id, name, cliVersion: '0.1.0' }),
  });
  expect(res.status).toBe(200);
  return machineEnrollResponseSchema.parse(await res.json());
}

async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
}

async function openStream(s: TestServer, token: string, machineId: string) {
  const ctrl = new AbortController();
  const res = await s.app.request('/api/machine/stream', {
    headers: { authorization: `Bearer ${token}` },
    signal: ctrl.signal,
  });
  expect(res.status).toBe(200);
  const events: MachineStreamEvent[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  void (async () => {
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += decoder.decode(value, { stream: true });
        let idx = buf.indexOf('\n\n');
        while (idx >= 0) {
          for (const line of buf.slice(0, idx).split('\n')) {
            if (line.startsWith('data:')) events.push(JSON.parse(line.slice(5).trim()));
          }
          buf = buf.slice(idx + 2);
          idx = buf.indexOf('\n\n');
        }
      }
    } catch {}
  })();
  await waitFor(() => events.some((e) => e.type === 'hello'));
  const hello = events.find((e) => e.type === 'hello') as { connectionId: string };
  const handle = {
    connectionId: hello.connectionId,
    events,
    abort: () => {
      ctrl.abort();
      void reader.cancel().catch(() => {});
    },
    async drop() {
      handle.abort();
      await waitFor(() => s.machineHub.connectionId(machineId) !== hello.connectionId);
    },
  };
  streams.push(handle);
  return handle;
}

function machineRow(s: TestServer, id: string) {
  return s.db.select().from(machineTable).where(eq(machineTable.id, id)).get()!;
}

function presenceEvents(s: TestServer, machineId: string) {
  const events: boolean[] = [];
  s.hub.subscribe(s.team.id, {
    nextSeq: () => 1,
    send: async (ev: object) => {
      const e = ev as { type?: string; machineId?: string; online?: boolean };
      if (e.type === 'machine_presence' && e.machineId === machineId) events.push(e.online!);
    },
  });
  return events;
}

const presence = (s: TestServer, token: string, connectionId?: string | null) =>
  call(s.app, 'POST', '/api/machine/presence', {
    cred: token,
    body: connectionId === undefined ? {} : { connectionId },
  });

const goodbye = (s: TestServer, token: string | undefined, connectionId: string) =>
  call(s.app, 'POST', '/api/machine/offline', {
    ...(token ? { cred: token } : {}),
    body: { connectionId },
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Runner offline grace (docs/design/runner-offline-grace.md)', () => {
  test('grace timer fires at exactly the grace length, not before', () => {
    vi.useFakeTimers();
    const hub = new MachineWakeHub();
    hub.subscribeMachine('t', 'm', () => {});
    const id = hub.connectionId('m')!;
    const expired = vi.fn();
    expect(hub.dropConnection('m', id, expired)).toBe(true);
    vi.advanceTimersByTime(MACHINE_OFFLINE_GRACE_MS - 1);
    expect(expired).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(MACHINE_OFFLINE_GRACE_MS).toBe(45_000);
  });

  test('1: abort of the current stream keeps the Runner online until the grace ends, then one offline event', async () => {
    const s = boot();
    const m = await enroll(s, issueKey(s));
    const st = await openStream(s, m.token, m.machineId);
    expect(machineRow(s, m.machineId).online).toBe(true);
    const events = presenceEvents(s, m.machineId);
    await st.drop();
    expect(machineRow(s, m.machineId).online).toBe(true);
    await waitFor(() => !machineRow(s, m.machineId).online);
    await sleep(GRACE_MS);
    expect(events).toEqual([false]);
  });

  test('2: a new stream within the grace keeps it online with no event; after expiry a new stream marks it online and refreshes lastSeenAt', async () => {
    const s = boot();
    const m = await enroll(s, issueKey(s));
    const a = await openStream(s, m.token, m.machineId);
    const events = presenceEvents(s, m.machineId);
    await a.drop();
    await openStream(s, m.token, m.machineId);
    await sleep(GRACE_MS + 200);
    expect(machineRow(s, m.machineId).online).toBe(true);
    expect(events).toEqual([]);

    const s2 = boot();
    const m2 = await enroll(s2, issueKey(s2));
    const c = await openStream(s2, m2.token, m2.machineId);
    await c.drop();
    await waitFor(() => !machineRow(s2, m2.machineId).online);
    s2.db
      .update(machineTable)
      .set({ lastSeenAt: 1 })
      .where(eq(machineTable.id, m2.machineId))
      .run();
    await openStream(s2, m2.token, m2.machineId);
    expect(machineRow(s2, m2.machineId).online).toBe(true);
    expect(machineRow(s2, m2.machineId).lastSeenAt).toBeGreaterThan(Date.now() - 5_000);
  });

  test('3: presence on the grace id refreshes lastSeenAt without cancelling the grace; after expiry it writes nothing; a new stream recovers', async () => {
    const s = boot();
    const m = await enroll(s, issueKey(s));
    const a = await openStream(s, m.token, m.machineId);
    await a.drop();
    s.db.update(machineTable).set({ lastSeenAt: 1 }).where(eq(machineTable.id, m.machineId)).run();
    expect((await presence(s, m.token, a.connectionId)).status).toBe(200);
    expect(machineRow(s, m.machineId).lastSeenAt).toBeGreaterThan(1);
    await waitFor(() => !machineRow(s, m.machineId).online);
    s.db.update(machineTable).set({ lastSeenAt: 2 }).where(eq(machineTable.id, m.machineId)).run();
    expect((await presence(s, m.token, a.connectionId)).status).toBe(200);
    expect(machineRow(s, m.machineId).online).toBe(false);
    expect(machineRow(s, m.machineId).lastSeenAt).toBe(2);
    await openStream(s, m.token, m.machineId);
    expect(machineRow(s, m.machineId).online).toBe(true);
  });

  test('4: a replaced stream cannot change the new one; after goodbye(B) a late presence(A) leaves it offline', async () => {
    const s = boot();
    const m = await enroll(s, issueKey(s));
    const a = await openStream(s, m.token, m.machineId);
    const b = await openStream(s, m.token, m.machineId);
    expect(a.events.some((e) => e.type === 'shutdown')).toBe(true);
    a.abort();
    expect(await (await goodbye(s, m.token, a.connectionId)).json()).toEqual({ applied: false });
    await presence(s, m.token, a.connectionId);
    await sleep(GRACE_MS + 200);
    expect(s.machineHub.connectionId(m.machineId)).toBe(b.connectionId);
    expect(machineRow(s, m.machineId).online).toBe(true);

    expect(await (await goodbye(s, m.token, b.connectionId)).json()).toEqual({ applied: true });
    expect(machineRow(s, m.machineId).online).toBe(false);
    await presence(s, m.token, a.connectionId);
    await presence(s, m.token, b.connectionId);
    expect(machineRow(s, m.machineId).online).toBe(false);
  });

  test('5: after rotation the old stream finding its token invalid does not take the new connection offline', async () => {
    const s = boot({ pingIntervalMs: 20 });
    const key = issueKey(s);
    const first = await enroll(s, key);
    const a = await openStream(s, first.token, first.machineId);
    const second = await enroll(s, key);
    expect(second.machineId).toBe(first.machineId);
    const b = await openStream(s, second.token, second.machineId);
    await presence(s, second.token, b.connectionId);
    expect(s.machineHub.endConnection(first.machineId, a.connectionId)).toBe(false);
    await sleep(200);
    expect(s.machineHub.connectionId(first.machineId)).toBe(b.connectionId);
    expect(machineRow(s, first.machineId).online).toBe(true);
  });

  test('6: goodbye ends the current connection or a grace at once; unknown or expired ids do nothing; null presence after goodbye stays offline', async () => {
    const s = boot();
    const m = await enroll(s, issueKey(s));
    const a = await openStream(s, m.token, m.machineId);
    expect(await (await goodbye(s, m.token, 'unknown-id')).json()).toEqual({ applied: false });
    expect(machineRow(s, m.machineId).online).toBe(true);
    expect(await (await goodbye(s, m.token, a.connectionId)).json()).toEqual({ applied: true });
    expect(machineRow(s, m.machineId).online).toBe(false);
    await presence(s, m.token, null);
    expect(machineRow(s, m.machineId).online).toBe(false);

    const b = await openStream(s, m.token, m.machineId);
    await b.drop();
    expect(machineRow(s, m.machineId).online).toBe(true);
    expect(await (await goodbye(s, m.token, b.connectionId)).json()).toEqual({ applied: true });
    expect(machineRow(s, m.machineId).online).toBe(false);

    const c = await openStream(s, m.token, m.machineId);
    await c.drop();
    await waitFor(() => !machineRow(s, m.machineId).online);
    expect(await (await goodbye(s, m.token, c.connectionId)).json()).toEqual({ applied: false });
  });

  test('7: goodbye and presence act only on the caller machine; bad, revoked and rotated tokens are refused', async () => {
    const s = boot();
    const key = issueKey(s);
    const a = await enroll(s, key, 'box-a');
    const b = await enroll(s, issueKey(s), 'box-b');
    const sb = await openStream(s, b.token, b.machineId);
    s.db
      .insert(teamTable)
      .values({
        id: 'team-other',
        name: 'Other',
        createdAt: 1,
        plan: 'free',
        avatarStyle: 'notionist',
      })
      .run();
    s.db
      .insert(machineTable)
      .values(
        readyMachine({
          id: 'machine-foreign',
          teamId: 'team-other',
          name: 'foreign',
          online: true,
          tokenHash: createHash('sha256').update('foreign-token').digest('hex'),
          enabledRuntimes: ['pi'],
        }),
      )
      .run();
    for (const cred of [a.token, 'foreign-token']) {
      expect(await (await goodbye(s, cred, sb.connectionId)).json()).toEqual({ applied: false });
      expect((await presence(s, cred, sb.connectionId)).status).toBe(200);
    }
    expect((await goodbye(s, undefined, sb.connectionId)).status).toBe(401);
    expect((await goodbye(s, 'wrong-token', sb.connectionId)).status).toBe(401);
    const rotated = await enroll(s, key, 'box-a');
    expect((await goodbye(s, a.token, sb.connectionId)).status).toBe(401);
    expect((await call(s.app, 'POST', `/api/machines/${rotated.machineId}/revoke`)).status).toBe(
      204,
    );
    expect((await goodbye(s, rotated.token, sb.connectionId)).status).toBe(401);
    expect(s.machineHub.connectionId(b.machineId)).toBe(sb.connectionId);
    expect(machineRow(s, b.machineId).online).toBe(true);
  });

  test('8: revoke during grace marks offline at once, refuses the token, and the old timer changes nothing', async () => {
    const s = boot();
    const m = await enroll(s, issueKey(s));
    const a = await openStream(s, m.token, m.machineId);
    await a.drop();
    const events = presenceEvents(s, m.machineId);
    expect((await call(s.app, 'POST', `/api/machines/${m.machineId}/revoke`)).status).toBe(204);
    expect(machineRow(s, m.machineId).online).toBe(false);
    expect((await presence(s, m.token, a.connectionId)).status).toBe(401);
    expect(
      (await call(s.app, 'POST', '/api/machine/tasks/claim', { cred: m.token, body: {} })).status,
    ).toBe(401);
    await sleep(GRACE_MS + 200);
    expect(events).toEqual([false]);
  });

  test('9: two machines keep independent graces', async () => {
    const s = boot();
    const a = await enroll(s, issueKey(s), 'box-a');
    const b = await enroll(s, issueKey(s), 'box-b');
    const sa = await openStream(s, a.token, a.machineId);
    const sb = await openStream(s, b.token, b.machineId);
    await sa.drop();
    await sleep(GRACE_MS / 2);
    await sb.drop();
    await waitFor(() => !machineRow(s, a.machineId).online);
    expect(machineRow(s, b.machineId).online).toBe(true);
    await waitFor(() => !machineRow(s, b.machineId).online);
  });

  test('10: the stale sweep wins over a running grace with one event; still-current presence after a sweep brings it back', async () => {
    const s = boot();
    const m = await enroll(s, issueKey(s));
    const a = await openStream(s, m.token, m.machineId);
    await a.drop();
    const events = presenceEvents(s, m.machineId);
    s.db.update(machineTable).set({ lastSeenAt: 1 }).where(eq(machineTable.id, m.machineId)).run();
    sweepStaleMachines({ db: s.db, hub: s.hub, machineHub: s.machineHub });
    expect(machineRow(s, m.machineId).online).toBe(false);
    expect(s.machineHub.silentSinceDrop(m.machineId)).toBe(false);
    await sleep(GRACE_MS + 200);
    expect(events).toEqual([false]);

    const b = await openStream(s, m.token, m.machineId);
    s.db.update(machineTable).set({ lastSeenAt: 1 }).where(eq(machineTable.id, m.machineId)).run();
    sweepStaleMachines({ db: s.db, hub: s.hub, machineHub: s.machineHub });
    expect(machineRow(s, m.machineId).online).toBe(false);
    await presence(s, m.token, b.connectionId);
    expect(machineRow(s, m.machineId).online).toBe(true);
  });

  test('12: after a restart a pre-restart id writes nothing; a new stream marks online; otherwise the stale sweep applies', async () => {
    const s = boot();
    const m = await enroll(s, issueKey(s));
    s.db
      .update(machineTable)
      .set({ online: true, lastSeenAt: 5 })
      .where(eq(machineTable.id, m.machineId))
      .run();
    await presence(s, m.token, 'id-from-before-restart');
    expect(machineRow(s, m.machineId).lastSeenAt).toBe(5);
    sweepStaleMachines({ db: s.db, hub: s.hub, machineHub: s.machineHub });
    expect(machineRow(s, m.machineId).online).toBe(false);
    await openStream(s, m.token, m.machineId);
    expect(machineRow(s, m.machineId).online).toBe(true);
  });

  test('13: presence without a connectionId field keeps today behavior, including during a grace', async () => {
    const s = boot();
    const m = await enroll(s, issueKey(s));
    expect(machineRow(s, m.machineId).online).toBe(false);
    await presence(s, m.token);
    expect(machineRow(s, m.machineId).online).toBe(true);
    const a = await openStream(s, m.token, m.machineId);
    await a.drop();
    expect(s.machineHub.silentSinceDrop(m.machineId)).toBe(true);
    await presence(s, m.token);
    expect(s.machineHub.silentSinceDrop(m.machineId)).toBe(false);
  });

  test('14: during grace pushed commands find no connection', async () => {
    const s = boot();
    const m = await enroll(s, issueKey(s));
    const a = await openStream(s, m.token, m.machineId);
    await a.drop();
    expect(machineRow(s, m.machineId).online).toBe(true);
    expect(s.machineHub.isConnected(m.machineId)).toBe(false);
    expect(
      s.machineHub.pushSync(m.machineId, {
        syncId: 'sync-1',
        buildId: 'b',
        projectId: 'p',
        cloneUrl: '',
        directory: '/tmp/x',
        ref: 'main',
        commit: 'a'.repeat(40),
        force: false,
      }),
    ).toBe(false);
  });
});
