import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { type MachineStreamEvent, machineEnrollResponseSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import pino from 'pino';
import { describe, expect, test, vi } from 'vitest';
import {
  machine as machineTable,
  provider as providerTable,
  routingRule as routingRuleTable,
  step as stepTable,
  team as teamTable,
} from '../src/db/schema.js';
import { createApiKey } from '../src/services/api-keys.js';
import { routeVerdict, targetUnavailable } from '../src/services/machine-routing.js';
import { MachineWakeHub } from '../src/services/machine-wake-hub.js';
import { seedLocalMachine } from '../src/services/machines.js';
import * as shipGate from '../src/services/ship-gate.js';
import { bootServer, postProject, seedSessionRoute, type TestServer } from './helpers.js';

function issueKey(s: TestServer, name: string): string {
  return createApiKey(s, {
    teamId: s.team.id,
    name,
    gitAccess: false,
    mcpAccess: false,
    machineAccess: true,
    toolGrants: { read: [], write: [] },
  }).plaintext;
}

const OWNER_TOKEN = 'cairn-owner-revoke-2494';

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

async function enroll(
  s: TestServer,
  apiKey: string,
  name: string,
): Promise<{ machineId: string; token: string }> {
  const res = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: apiKey,
    body: { teamId: s.team.id, name, cliVersion: '0.1.0' },
  });
  expect(res.status).toBe(200);
  return machineEnrollResponseSchema.parse(await res.json());
}

async function openMachineStream(app: Hono, token: string) {
  const ctrl = new AbortController();
  const res = await app.request('/api/machine/stream', {
    headers: { authorization: `Bearer ${token}` },
    signal: ctrl.signal,
  });
  const events: MachineStreamEvent[] = [];
  let ended = false;
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  const pump = (async () => {
    if (!reader) return;
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx = buf.indexOf('\n\n');
        while (idx >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of frame.split('\n')) {
            if (line.startsWith('data:')) {
              events.push(JSON.parse(line.slice(5).trim()) as MachineStreamEvent);
            }
          }
          idx = buf.indexOf('\n\n');
        }
      }
    } catch {
      void 0;
    }
    ended = true;
  })();
  return {
    status: res.status,
    events,
    async waitEnded(timeoutMs = 3000): Promise<boolean> {
      const deadline = Date.now() + timeoutMs;
      while (!ended && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
      return ended;
    },
    abort(): void {
      ctrl.abort();
      void pump;
    },
  };
}

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
}

function tokenHashOf(s: TestServer, machineId: string): string | null | undefined {
  return s.db.select().from(machineTable).where(eq(machineTable.id, machineId)).get()?.tokenHash;
}

interface PresenceEvent {
  type: string;
  machineId?: string;
  online?: boolean;
}

function tapPresence(s: TestServer): PresenceEvent[] {
  const events: PresenceEvent[] = [];
  s.hub.subscribe(s.team.id, {
    nextSeq: () => 1,
    send: (payload: object) => {
      events.push(payload as PresenceEvent);
      return Promise.resolve();
    },
  });
  return events;
}

function pinnedHold(s: TestServer, machineId: string) {
  const row = s.db.select().from(machineTable).where(eq(machineTable.id, machineId)).get();
  const now = Date.now();
  return routeVerdict({
    machineId: 'other-machine',
    targets: [{ machineId, session: false }],
    unavailable: (id) =>
      id !== machineId ||
      targetUnavailable(
        s.db,
        row,
        s.team.id,
        {
          agentRow: { machineId, requiredCapabilities: null },
          model: { provider: 'stub-gw', modelId: 'stub-model' },
          localProject: false,
          localMerge: true,
        },
        [],
        now,
      ),
    waitingSince: now,
    now,
  });
}

function watchRevokeOrder(s: TestServer, machineId: string, events: PresenceEvent[]): string[] {
  const order: string[] = [];
  const original = s.machineHub.revokeMachine.bind(s.machineHub);
  vi.spyOn(s.machineHub, 'revokeMachine').mockImplementation((id: string) => {
    if (id === machineId) {
      const offlineFirst = events.some(
        (event) =>
          event.type === 'machine_presence' &&
          event.machineId === machineId &&
          event.online === false,
      );
      order.push(offlineFirst ? 'offline-before-revoke' : 'revoke-while-online');
    }
    original(id);
  });
  return order;
}

async function setupWorld(
  opts: {
    pingIntervalMs?: number;
    authToken?: string;
    logger?: pino.Logger;
    pinRoute?: boolean;
  } = {},
) {
  const s = bootServer({
    claimHoldMs: 200,
    pingIntervalMs: opts.pingIntervalMs ?? 3_600_000,
    ...(opts.authToken !== undefined ? { authToken: opts.authToken } : {}),
    ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
  });
  const apiKey = issueKey(s, 'key-a');
  s.db
    .insert(providerTable)
    .values({
      id: 'prov-1',
      teamId: s.team.id,
      kind: 'custom',
      providerId: 'stub-gw',
      label: 'Stub Gateway',
      baseUrl: 'http://127.0.0.1:9/v1',
      api: 'openai-completions',
      authHeader: true,
      compat: { supportsDeveloperRole: false },
      models: [{ id: 'stub-model', name: 'stub-model' }],
      createdBy: s.user.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
  const a = await enroll(s, apiKey, 'host-a');
  seedSessionRoute(s, {
    provider: 'stub-gw',
    modelId: 'stub-model',
    machineId: opts.pinRoute !== false ? a.machineId : null,
  });
  return { s, apiKey, a };
}

describe('machine token revocation (#2494)', () => {
  test('revoke closes a live machine stream after sending shutdown, keeps the row, nulls the token', async () => {
    const w = await setupWorld();
    try {
      const stream = await openMachineStream(w.s.app, w.a.token);
      expect(stream.status).toBe(200);
      await call(w.s.app, 'POST', '/api/machine/presence', { cred: w.a.token, body: {} });
      await waitFor(() => w.s.machineHub.streamCount(w.s.team.id) === 1);

      const res = await call(w.s.app, 'POST', `/api/machines/${w.a.machineId}/revoke`);
      expect(res.status).toBe(204);
      expect(await res.text()).toBe('');

      expect(await stream.waitEnded()).toBe(true);
      expect(stream.events.at(0)).toEqual({ type: 'shutdown' });
      expect(w.s.machineHub.streamCount(w.s.team.id)).toBe(0);

      const row = w.s.db
        .select()
        .from(machineTable)
        .where(eq(machineTable.id, w.a.machineId))
        .get();
      expect(row).toBeDefined();
      expect(row?.tokenHash).toBeNull();
      expect(row?.online).toBe(false);
      expect(row?.apiKeyId).not.toBeNull();
      const pinned = w.s.db
        .select()
        .from(routingRuleTable)
        .where(eq(routingRuleTable.use, 'session'))
        .get();
      expect(pinned?.machineId).toBe(w.a.machineId);
    } finally {
      w.s.dispose();
    }
  });

  test('after revoke the old token is refused on every machine endpoint and on stream reconnect', async () => {
    const w = await setupWorld();
    try {
      const revoke = await call(w.s.app, 'POST', `/api/machines/${w.a.machineId}/revoke`);
      expect(revoke.status).toBe(204);
      const probes: [string, string][] = [
        ['GET', '/api/machine/me'],
        ['GET', '/api/machine/stream'],
        ['POST', '/api/machine/tasks/claim'],
        ['POST', '/api/machine/presence'],
        ['POST', '/api/machine/recover'],
        ['GET', '/api/machine/steer?stepId=s'],
        ['GET', '/api/machine/stop?stepId=s'],
        ['POST', '/api/machine/heartbeat/s'],
        ['POST', '/api/machine/done/s'],
      ];
      for (const [method, path] of probes) {
        const res = await call(
          w.s.app,
          method,
          path,
          method === 'POST' ? { cred: w.a.token, body: {} } : { cred: w.a.token },
        );
        expect(res.status, `${method} ${path}`).toBe(401);
      }
    } finally {
      w.s.dispose();
    }
  });

  test('revoke while a step is claimed: the old token cannot heartbeat, finish, steer or reclaim; the step stays claimed until the abandoned sweep', async () => {
    const w = await setupWorld();
    try {
      const projectId = await postProject(w.s.app);
      const todoRes = await call(w.s.app, 'POST', `/api/projects/${projectId}/todos`, {
        body: { title: 'probe', spec: 'write a probe' },
      });
      const todo = (await todoRes.json()) as { id: string };
      const started = await call(w.s.app, 'POST', `/api/projects/${projectId}/builds`, {
        body: {
          todoIds: [todo.id],
          withPlan: true,
        },
      });
      expect(started.status).toBe(201);
      const claim = await call(w.s.app, 'POST', '/api/machine/tasks/claim', {
        cred: w.a.token,
        body: {},
      });
      const claimed = (await claim.json()) as { step: { step: { id: string } } | null };
      const stepId = claimed.step?.step.id ?? '';
      expect(stepId).not.toBe('');

      const beating = await call(w.s.app, 'POST', `/api/machine/heartbeat/${stepId}`, {
        cred: w.a.token,
        body: {},
      });
      expect(beating.status).toBe(200);

      const revoke = await call(w.s.app, 'POST', `/api/machines/${w.a.machineId}/revoke`);
      expect(revoke.status).toBe(204);

      const refused = [
        await call(w.s.app, 'POST', `/api/machine/heartbeat/${stepId}`, {
          cred: w.a.token,
          body: {},
        }),
        await call(w.s.app, 'POST', `/api/machine/done/${stepId}`, { cred: w.a.token, body: {} }),
        await call(w.s.app, 'GET', `/api/machine/steer?stepId=${stepId}`, { cred: w.a.token }),
        await call(w.s.app, 'GET', `/api/machine/stop?stepId=${stepId}`, { cred: w.a.token }),
        await call(w.s.app, 'POST', '/api/machine/tasks/claim', { cred: w.a.token, body: {} }),
      ];
      expect(refused.map((r) => r.status)).toEqual([401, 401, 401, 401, 401]);

      const stepRow = w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get();
      expect(stepRow?.status).toBe('claimed');
      expect(stepRow?.machineId).toBe(w.a.machineId);
    } finally {
      w.s.dispose();
    }
  });

  test('a claim already waiting when the token is revoked gets 401 and takes no work queued afterwards', async () => {
    const w = await setupWorld();
    try {
      const projectId = await postProject(w.s.app);
      const todoRes = await call(w.s.app, 'POST', `/api/projects/${projectId}/todos`, {
        body: { title: 'late work', spec: 'queued after revoke' },
      });
      const todo = (await todoRes.json()) as { id: string };
      const waiting = call(w.s.app, 'POST', '/api/machine/tasks/claim', {
        cred: w.a.token,
        body: {},
      });
      await new Promise((r) => setTimeout(r, 30));
      const revoke = await call(w.s.app, 'POST', `/api/machines/${w.a.machineId}/revoke`);
      expect(revoke.status).toBe(204);
      const started = await call(w.s.app, 'POST', `/api/projects/${projectId}/builds`, {
        body: {
          todoIds: [todo.id],
          withPlan: true,
        },
      });
      expect(started.status).toBe(201);

      const result = await waiting;
      expect(result.status).toBe(401);
      const steps = w.s.db.select().from(stepTable).all();
      expect(steps.length).toBeGreaterThan(0);
      expect(steps.every((row) => row.machineId === null && row.status === 'pending')).toBe(true);
    } finally {
      w.s.dispose();
    }
  });

  test.each(['valid', 'revoke', 'rotate'] as const)(
    'a %s credential is checked after claim preparation and before commitment',
    async (change) => {
      const w = await setupWorld();
      let resume = () => {};
      const prepared = new Promise<void>((resolve) => {
        resume = resolve;
      });
      let preparing = false;
      const gate = vi.spyOn(shipGate, 'reverifyShip').mockImplementation(async () => {
        preparing = true;
        await prepared;
        return null;
      });
      let waiting: Promise<Response> | undefined;
      try {
        const projectId = await postProject(w.s.app);
        const todoRes = await call(w.s.app, 'POST', `/api/projects/${projectId}/todos`, {
          body: { title: 'prepared claim', spec: 'claim preparation can wait' },
        });
        const todo = (await todoRes.json()) as { id: string };
        expect(
          (
            await call(w.s.app, 'POST', `/api/projects/${projectId}/builds`, {
              body: {
                todoIds: [todo.id],
                withPlan: true,
              },
            })
          ).status,
        ).toBe(201);
        waiting = call(w.s.app, 'POST', '/api/machine/tasks/claim', { cred: w.a.token, body: {} });
        await vi.waitFor(() => expect(preparing).toBe(true));
        if (change === 'revoke') {
          expect(
            (await call(w.s.app, 'POST', `/api/machines/${w.a.machineId}/revoke`)).status,
          ).toBe(204);
        } else if (change === 'rotate') {
          const rotated = await enroll(w.s, w.apiKey, 'host-a');
          expect(rotated.token).not.toBe(w.a.token);
        }
        resume();
        expect((await waiting).status).toBe(change === 'valid' ? 200 : 401);
        const rows = w.s.db.select().from(stepTable).all();
        expect(rows.some((row) => row.status === 'claimed')).toBe(change === 'valid');
        if (change !== 'valid') expect(rows.every((row) => row.machineId === null)).toBe(true);
      } finally {
        resume();
        await waiting;
        gate.mockRestore();
        w.s.dispose();
      }
    },
  );

  test('revoking machine A leaves machine B stream and token working', async () => {
    const w = await setupWorld();
    try {
      const b = await enroll(w.s, issueKey(w.s, 'key-b'), 'host-b');
      const streamA = await openMachineStream(w.s.app, w.a.token);
      const streamB = await openMachineStream(w.s.app, b.token);
      await waitFor(() => w.s.machineHub.streamCount(w.s.team.id) === 2);

      const revoke = await call(w.s.app, 'POST', `/api/machines/${w.a.machineId}/revoke`);
      expect(revoke.status).toBe(204);
      expect(await streamA.waitEnded()).toBe(true);

      expect(w.s.machineHub.streamCount(w.s.team.id)).toBe(1);
      w.s.machineHub.wake(w.s.team.id);
      await waitFor(() => streamB.events.some((ev) => ev.type === 'wake'));
      expect(streamB.events.some((ev) => ev.type === 'shutdown')).toBe(false);
      expect((await call(w.s.app, 'GET', '/api/machine/me', { cred: b.token })).status).toBe(200);
      streamB.abort();
    } finally {
      w.s.dispose();
    }
  });

  test('revoke is idempotent and an unknown machine id is 404', async () => {
    const w = await setupWorld();
    try {
      const first = await call(w.s.app, 'POST', `/api/machines/${w.a.machineId}/revoke`);
      const second = await call(w.s.app, 'POST', `/api/machines/${w.a.machineId}/revoke`);
      expect(first.status).toBe(204);
      expect(second.status).toBe(204);
      expect(tokenHashOf(w.s, w.a.machineId)).toBeNull();
      const ghost = await call(w.s.app, 'POST', '/api/machines/machine-ghost/revoke');
      expect(ghost.status).toBe(404);
    } finally {
      w.s.dispose();
    }
  });

  test('a machine of another team is 404 and keeps its token', async () => {
    const w = await setupWorld();
    try {
      w.s.db
        .insert(teamTable)
        .values({
          id: 'team-other',
          name: 'Other',
          createdAt: 1,
          plan: 'free',
          avatarStyle: 'notionist',
        })
        .run();
      w.s.db
        .insert(machineTable)
        .values({
          id: 'machine-foreign',
          teamId: 'team-other',
          name: 'foreign',
          online: true,
          tokenHash: createHash('sha256').update('foreign-token').digest('hex'),
          enabledRuntimes: ['pi'],
        })
        .run();
      const res = await call(w.s.app, 'POST', '/api/machines/machine-foreign/revoke');
      expect(res.status).toBe(404);
      expect(tokenHashOf(w.s, 'machine-foreign')).not.toBeNull();
    } finally {
      w.s.dispose();
    }
  });

  test('revoke is refused exactly like DELETE without the owner credential, including the machine own token', async () => {
    const w = await setupWorld({ authToken: OWNER_TOKEN });
    try {
      const path = `/api/machines/${w.a.machineId}`;
      for (const cred of [undefined, w.a.token, 'wrong-token']) {
        const del = await call(w.s.app, 'DELETE', path, cred ? { cred } : {});
        const rev = await call(w.s.app, 'POST', `${path}/revoke`, cred ? { cred } : {});
        expect(del.status).toBe(401);
        expect(rev.status).toBe(401);
      }
      expect(tokenHashOf(w.s, w.a.machineId)).not.toBeNull();
      expect((await call(w.s.app, 'GET', '/api/machine/me', { cred: w.a.token })).status).toBe(200);

      const ok = await call(w.s.app, 'POST', `${path}/revoke`, { cred: OWNER_TOKEN });
      expect(ok.status).toBe(204);
      expect(tokenHashOf(w.s, w.a.machineId)).toBeNull();
    } finally {
      w.s.dispose();
    }
  });

  test('re-enrollment with the same key rotates the token, closes the old stream, and the new token connects', async () => {
    const w = await setupWorld();
    try {
      const oldStream = await openMachineStream(w.s.app, w.a.token);
      await waitFor(() => w.s.machineHub.streamCount(w.s.team.id) === 1);

      const rotated = await enroll(w.s, w.apiKey, 'host-a');
      expect(rotated.machineId).toBe(w.a.machineId);
      expect(rotated.token).not.toBe(w.a.token);

      expect(await oldStream.waitEnded()).toBe(true);
      expect(oldStream.events.at(0)).toEqual({ type: 'shutdown' });
      expect((await call(w.s.app, 'GET', '/api/machine/me', { cred: w.a.token })).status).toBe(401);

      const fresh = await openMachineStream(w.s.app, rotated.token);
      expect(fresh.status).toBe(200);
      await waitFor(() => w.s.machineHub.streamCount(w.s.team.id) === 1);
      w.s.machineHub.wake(w.s.team.id);
      await waitFor(() => fresh.events.some((ev) => ev.type === 'wake'));
      fresh.abort();
    } finally {
      w.s.dispose();
    }
  });

  test('owner-approved re-claim of the local machine closes the previous local stream', async () => {
    const w = await setupWorld({ authToken: OWNER_TOKEN, pinRoute: false });
    try {
      seedLocalMachine(w.s.db, w.s.team.id);
      const claimLocal = async (): Promise<{ machineId: string; token: string }> => {
        const start = await call(w.s.app, 'POST', '/api/machine/enroll/start', {
          body: { name: hostname(), teamId: w.s.team.id },
        });
        const { enrollId } = (await start.json()) as { enrollId: string };
        const confirmed = await call(w.s.app, 'POST', '/api/machine/enroll/confirm', {
          cred: OWNER_TOKEN,
          body: { enrollId },
        });
        expect(confirmed.status).toBe(200);
        return ((await confirmed.json()) as { machine: { machineId: string; token: string } })
          .machine;
      };
      const first = await claimLocal();
      const oldStream = await openMachineStream(w.s.app, first.token);
      await waitFor(() => w.s.machineHub.streamCount(w.s.team.id) === 1);

      const second = await claimLocal();
      expect(second.machineId).toBe(first.machineId);
      expect(second.token).not.toBe(first.token);
      expect(await oldStream.waitEnded()).toBe(true);
      expect(oldStream.events.at(0)).toEqual({ type: 'shutdown' });
      expect((await call(w.s.app, 'GET', '/api/machine/me', { cred: first.token })).status).toBe(
        401,
      );
      expect((await call(w.s.app, 'GET', '/api/machine/me', { cred: second.token })).status).toBe(
        200,
      );
    } finally {
      w.s.dispose();
    }
  });

  test('byKey rotation of an already-online machine marks it offline and publishes presence before closing the stream', async () => {
    const w = await setupWorld({ pinRoute: false });
    try {
      const present = await call(w.s.app, 'POST', '/api/machine/presence', {
        cred: w.a.token,
        body: {},
      });
      expect(present.status).toBe(200);
      expect(pinnedHold(w.s, w.a.machineId)).toEqual({
        claim: false,
        waitingFor: w.a.machineId,
        fallbackAt: expect.any(Number),
      });
      const events = tapPresence(w.s);
      const stream = await openMachineStream(w.s.app, w.a.token);
      await waitFor(() => w.s.machineHub.streamCount(w.s.team.id) === 1);
      const order = watchRevokeOrder(w.s, w.a.machineId, events);

      const rotated = await enroll(w.s, w.apiKey, 'host-a');
      expect(rotated.machineId).toBe(w.a.machineId);
      expect(rotated.token).not.toBe(w.a.token);
      const row = w.s.db
        .select()
        .from(machineTable)
        .where(eq(machineTable.id, w.a.machineId))
        .get();
      expect({
        online: row?.online,
        events,
        order,
        hold: pinnedHold(w.s, w.a.machineId),
        oldToken: (await call(w.s.app, 'GET', '/api/machine/me', { cred: w.a.token })).status,
        newToken: (await call(w.s.app, 'GET', '/api/machine/me', { cred: rotated.token })).status,
        streamEnded: await stream.waitEnded(),
        shutdown: stream.events.at(0),
      }).toEqual({
        online: false,
        events: [{ type: 'machine_presence', machineId: w.a.machineId, online: false }],
        order: ['offline-before-revoke'],
        hold: { claim: true },
        oldToken: 401,
        newToken: 200,
        streamEnded: true,
        shutdown: { type: 'shutdown' },
      });
    } finally {
      w.s.dispose();
    }
  });

  test('authorizeEnrollmentMachine rotation of an already-online local machine marks it offline and publishes presence before closing the stream', async () => {
    const w = await setupWorld({ authToken: OWNER_TOKEN, pinRoute: false });
    try {
      seedLocalMachine(w.s.db, w.s.team.id);
      const claimLocal = async (): Promise<{ machineId: string; token: string }> => {
        const start = await call(w.s.app, 'POST', '/api/machine/enroll/start', {
          body: { name: hostname(), teamId: w.s.team.id },
        });
        const { enrollId } = (await start.json()) as { enrollId: string };
        const confirmed = await call(w.s.app, 'POST', '/api/machine/enroll/confirm', {
          cred: OWNER_TOKEN,
          body: { enrollId },
        });
        expect(confirmed.status).toBe(200);
        return ((await confirmed.json()) as { machine: { machineId: string; token: string } })
          .machine;
      };
      const first = await claimLocal();
      const present = await call(w.s.app, 'POST', '/api/machine/presence', {
        cred: first.token,
        body: {},
      });
      expect(present.status).toBe(200);
      expect(pinnedHold(w.s, first.machineId)).toEqual({
        claim: false,
        waitingFor: first.machineId,
        fallbackAt: expect.any(Number),
      });
      const events = tapPresence(w.s);
      const stream = await openMachineStream(w.s.app, first.token);
      await waitFor(() => w.s.machineHub.streamCount(w.s.team.id) === 1);
      const order = watchRevokeOrder(w.s, first.machineId, events);

      const second = await claimLocal();
      expect(second.machineId).toBe(first.machineId);
      expect(second.token).not.toBe(first.token);
      const row = w.s.db
        .select()
        .from(machineTable)
        .where(eq(machineTable.id, first.machineId))
        .get();
      expect({
        online: row?.online,
        events,
        order,
        hold: pinnedHold(w.s, first.machineId),
        oldToken: (await call(w.s.app, 'GET', '/api/machine/me', { cred: first.token })).status,
        newToken: (await call(w.s.app, 'GET', '/api/machine/me', { cred: second.token })).status,
        streamEnded: await stream.waitEnded(),
        shutdown: stream.events.at(0),
      }).toEqual({
        online: false,
        events: [{ type: 'machine_presence', machineId: first.machineId, online: false }],
        order: ['offline-before-revoke'],
        hold: { claim: true },
        oldToken: 401,
        newToken: 200,
        streamEnded: true,
        shutdown: { type: 'shutdown' },
      });
    } finally {
      w.s.dispose();
    }
  });

  test('DELETE closes the live stream of the deleted machine', async () => {
    const w = await setupWorld({ pinRoute: false });
    try {
      const stream = await openMachineStream(w.s.app, w.a.token);
      await waitFor(() => w.s.machineHub.streamCount(w.s.team.id) === 1);
      const res = await call(w.s.app, 'DELETE', `/api/machines/${w.a.machineId}`);
      expect(res.status).toBe(204);
      expect(await stream.waitEnded()).toBe(true);
      expect(stream.events.at(0)).toEqual({ type: 'shutdown' });
      expect(w.s.machineHub.streamCount(w.s.team.id)).toBe(0);
    } finally {
      w.s.dispose();
    }
  });

  test('ping-time revalidation closes a stream whose tokenHash was changed directly in the database', async () => {
    const w = await setupWorld({ pingIntervalMs: 30 });
    try {
      const stream = await openMachineStream(w.s.app, w.a.token);
      await waitFor(() => w.s.machineHub.streamCount(w.s.team.id) === 1);
      w.s.db
        .update(machineTable)
        .set({ tokenHash: createHash('sha256').update('rotated-elsewhere').digest('hex') })
        .where(eq(machineTable.id, w.a.machineId))
        .run();
      expect(await stream.waitEnded()).toBe(true);
      expect(w.s.machineHub.streamCount(w.s.team.id)).toBe(0);
    } finally {
      w.s.dispose();
    }
  });

  test('ping-time revalidation closes a stream whose machine row was deleted directly', async () => {
    const w = await setupWorld({ pingIntervalMs: 30, pinRoute: false });
    try {
      const stream = await openMachineStream(w.s.app, w.a.token);
      await waitFor(() => w.s.machineHub.streamCount(w.s.team.id) === 1);
      w.s.db.delete(machineTable).where(eq(machineTable.id, w.a.machineId)).run();
      expect(await stream.waitEnded()).toBe(true);
    } finally {
      w.s.dispose();
    }
  });

  test('a healthy stream survives ping revalidation', async () => {
    const w = await setupWorld({ pingIntervalMs: 30 });
    try {
      const stream = await openMachineStream(w.s.app, w.a.token);
      await waitFor(() => w.s.machineHub.streamCount(w.s.team.id) === 1);
      await new Promise((r) => setTimeout(r, 200));
      expect(await stream.waitEnded(50)).toBe(false);
      stream.abort();
    } finally {
      w.s.dispose();
    }
  });

  test('neither the token nor its hash appears in the revoke response, the machine list or the logs', async () => {
    const logs: string[] = [];
    const w = await setupWorld({
      logger: pino({ level: 'trace' }, { write: (line) => logs.push(line) }),
    });
    try {
      const hashBefore = tokenHashOf(w.s, w.a.machineId);
      expect(hashBefore).toBeTruthy();
      const revoke = await call(w.s.app, 'POST', `/api/machines/${w.a.machineId}/revoke`);
      const list = await call(w.s.app, 'GET', `/api/teams/${w.s.team.id}/machines`);
      const surfaces = [await revoke.text(), await list.text(), logs.join('\n')].join('\n');
      expect(surfaces).not.toContain(w.a.token);
      expect(surfaces).not.toContain(hashBefore ?? 'unreachable');
      expect(surfaces).not.toContain('tokenHash');
    } finally {
      w.s.dispose();
    }
  });
});

describe('MachineWakeHub.revokeMachine', () => {
  test.each(['team-1', 'team-2'])(
    'replacement on %s closes the previous stream and revocation leaves no orphan broadcast subscriber',
    (nextTeam) => {
      const hub = new MachineWakeHub();
      const oldEvents: MachineStreamEvent[] = [];
      const newEvents: MachineStreamEvent[] = [];
      let oldClosed = 0;
      let newClosed = 0;
      const releaseOld = hub.subscribeMachine(
        'team-1',
        'm-1',
        (event) => oldEvents.push(event),
        () => {
          oldClosed += 1;
        },
      );
      const releaseNew = hub.subscribeMachine(
        nextTeam,
        'm-1',
        (event) => newEvents.push(event),
        () => {
          newClosed += 1;
        },
      );
      hub.revokeMachine('m-1');
      hub.steerSignal('team-1', 'after-revoke');
      hub.steerSignal('team-2', 'after-revoke');
      expect(oldEvents).toEqual([{ type: 'shutdown' }]);
      expect(newEvents).toEqual([{ type: 'shutdown' }]);
      expect([oldClosed, newClosed]).toEqual([1, 1]);
      expect(hub.streamCount('team-1') + hub.streamCount('team-2')).toBe(0);
      releaseOld();
      releaseNew();
      expect(hub.isConnected('m-1')).toBe(false);
    },
  );

  test('sends shutdown, calls close, removes the machine from team and machine maps', () => {
    const hub = new MachineWakeHub();
    const sent: MachineStreamEvent[] = [];
    let closed = 0;
    hub.subscribeMachine(
      'team-1',
      'm-1',
      (ev) => sent.push(ev),
      () => {
        closed += 1;
      },
    );
    expect(hub.streamCount('team-1')).toBe(1);
    hub.revokeMachine('m-1');
    expect(sent).toEqual([{ type: 'shutdown' }]);
    expect(closed).toBe(1);
    expect(hub.streamCount('team-1')).toBe(0);
    hub.wake('team-1');
    expect(sent).toEqual([{ type: 'shutdown' }]);
  });

  test('unknown machine is a no-op and a second revoke does not close twice', () => {
    const hub = new MachineWakeHub();
    expect(() => hub.revokeMachine('nobody')).not.toThrow();
    let closed = 0;
    hub.subscribeMachine(
      'team-1',
      'm-1',
      () => {},
      () => {
        closed += 1;
      },
    );
    hub.revokeMachine('m-1');
    hub.revokeMachine('m-1');
    expect(closed).toBe(1);
  });

  test('a throwing send does not stop the close', () => {
    const hub = new MachineWakeHub();
    let closed = 0;
    hub.subscribeMachine(
      'team-1',
      'm-1',
      () => {
        throw new Error('socket gone');
      },
      () => {
        closed += 1;
      },
    );
    hub.revokeMachine('m-1');
    expect(closed).toBe(1);
  });
});
