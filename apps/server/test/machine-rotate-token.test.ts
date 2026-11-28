import { createHash } from 'node:crypto';
import {
  DEVICE_TOKEN_PREFIX,
  type MachineStreamEvent,
  machineEnrollResponseSchema,
} from '@cairn/shared';
import { serve } from '@hono/node-server';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import pino from 'pino';
import { describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { PI_CAPABILITIES } from '../../daemon/src/backend/pi.js';
import { loadDaemonConfig } from '../../daemon/src/config.js';
import { createDaemonLogger } from '../../daemon/src/log.js';
import { runMachine } from '../../daemon/src/machine-loop.js';
import { loadMachineJson, statePaths } from '../../daemon/src/state.js';
import { offlineDaemonRuntimeOpts } from '../../daemon/test/runtime-stubs.js';
import {
  build as buildTable,
  computer as computerTable,
  dueEvent as dueEventTable,
  machine as machineTable,
  pairedDevice as pairedDeviceTable,
  phone as phoneTable,
  provider as providerTable,
  routingRule as routingRuleTable,
  step as stepTable,
  team as teamTable,
} from '../src/db/schema.js';
import { hashCredential } from '../src/lib/hash.js';
import { createApiKey } from '../src/services/api-keys.js';
import { createDueRunner, type DueClock } from '../src/services/due-events.js';
import {
  armOverdueTokenRotationOnConnect,
  MACHINE_TOKEN_ROTATION_CONNECT_GRACE_MS,
  MACHINE_TOKEN_ROTATION_EVENT_KIND,
  MACHINE_TOKEN_ROTATION_INTERVAL_MS,
  MACHINE_TOKEN_ROTATION_RETRY_MS,
  machineTokenRotationEventId,
  processMachineTokenRotationDue,
} from '../src/services/machine-rotate-token.js';
import { createScheduler } from '../src/services/scheduler.js';
import { bootServer, postProject, seedSessionRoute, type TestServer } from './helpers.js';

const OWNER_TOKEN = 'cairn-owner-rotate-token-test';
const HOST_KEY_A = 'a'.repeat(64);
const HOST_KEY_B = 'b'.repeat(64);

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

function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown; peer?: string; signal?: AbortSignal } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(
      path,
      {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
      opts.peer === undefined ? undefined : { incoming: { socket: { remoteAddress: opts.peer } } },
    ),
  );
}

async function enroll(
  s: TestServer,
  apiKey: string,
  name: string,
  hostKey?: string,
): Promise<{ machineId: string; token: string }> {
  const res = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: apiKey,
    body: readyMachine({
      teamId: s.team.id,
      name,
      cliVersion: '0.1.0',
      ...(hostKey !== undefined ? { hostKey } : {}),
    }),
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
  const events: Array<
    MachineStreamEvent | { type: string; connectionId?: string; rotationId?: string }
  > = [];
  let connectionId = '';
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
            if (!line.startsWith('data:')) continue;
            const ev = JSON.parse(line.slice(5).trim()) as {
              type: string;
              connectionId?: string;
              rotationId?: string;
            };
            if (ev.type === 'hello' && ev.connectionId) {
              connectionId = ev.connectionId;
            } else {
              events.push(ev);
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
    getConnectionId: () => connectionId,
    async waitEnded(timeoutMs = 3000): Promise<boolean> {
      const deadline = Date.now() + timeoutMs;
      while (!ended && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
      return ended;
    },
    abort(): void {
      ctrl.abort();
      void reader?.cancel().catch(() => {});
      void pump;
    },
  };
}

async function waitFor(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
}

function machineRowOf(s: TestServer, machineId: string) {
  return s.db.select().from(machineTable).where(eq(machineTable.id, machineId)).get();
}

function tapTeamEvents(s: TestServer) {
  const events: Array<{ type: string; machineId?: string; online?: boolean }> = [];
  s.hub.subscribe(s.team.id, {
    nextSeq: () => 1,
    send: (payload: object) => {
      events.push(payload as { type: string; machineId?: string; online?: boolean });
      return Promise.resolve();
    },
  });
  return events;
}

async function setupWorld(
  opts: {
    authToken?: string;
    offlineGraceMs?: number;
    tokenRotationTimeoutMs?: number;
    hostKey?: string;
    logger?: pino.Logger;
    db?: TestServer['db'];
  } = {},
) {
  const s = bootServer({
    claimHoldMs: 250,
    pingIntervalMs: 3_600_000,
    ...(opts.db !== undefined ? { db: opts.db } : {}),
    ...(opts.offlineGraceMs !== undefined ? { offlineGraceMs: opts.offlineGraceMs } : {}),
    ...(opts.tokenRotationTimeoutMs !== undefined
      ? { tokenRotationTimeoutMs: opts.tokenRotationTimeoutMs }
      : {}),
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
  const a = await enroll(s, apiKey, 'host-a', opts.hostKey);
  s.db
    .update(teamTable)
    .set({ defaultMachineId: a.machineId })
    .where(eq(teamTable.id, s.team.id))
    .run();
  seedSessionRoute(s, {
    provider: 'stub-gw',
    modelId: 'stub-model',
    machineId: a.machineId,
  });
  return { s, apiKey, a };
}

async function performPushedRotate(
  s: TestServer,
  machineId: string,
  oldToken: string,
  opts: { cred?: string; hostKey?: string } = {},
) {
  const stream = await openMachineStream(s.app, oldToken);
  expect(stream.status).toBe(200);
  await waitFor(() => stream.getConnectionId() !== '');

  const rotatePromise = call(s.app, 'POST', `/api/machines/${machineId}/rotate-token`, {
    ...(opts.cred ? { cred: opts.cred } : {}),
    body: {},
  });

  await waitFor(() => stream.events.some((ev) => ev.type === 'token.rotate'));
  const rotateEv = stream.events.find((ev) => ev.type === 'token.rotate') as {
    type: 'token.rotate';
    rotationId: string;
  };

  const claimRes = await call(s.app, 'POST', '/api/machine/token-rotate/claim', {
    cred: oldToken,
    body: {
      rotationId: rotateEv.rotationId,
      connectionId: stream.getConnectionId(),
      ...(opts.hostKey !== undefined ? { hostKey: opts.hostKey } : {}),
    },
  });
  expect(claimRes.status).toBe(200);
  expect(claimRes.headers.get('cache-control')).toContain('no-store');
  const { token: newToken } = (await claimRes.json()) as { token: string };

  const ackRes = await call(s.app, 'POST', '/api/machine/token-rotate/ack', {
    cred: newToken,
    body: { rotationId: rotateEv.rotationId },
  });
  expect(ackRes.status).toBe(200);

  const rotateRes = await rotatePromise;
  return { rotateRes, newToken, stream, rotationId: rotateEv.rotationId };
}

describe('in-place runner token rotation', () => {
  test('online rotation pushes new token, invalidates old token at once, keeps row Online, default flag, routing and history', async () => {
    const w = await setupWorld({ hostKey: HOST_KEY_A });
    try {
      const projectId = await postProject(w.s.app);
      const todoRes = await call(w.s.app, 'POST', `/api/projects/${projectId}/todos`, {
        body: { title: 'history task', spec: 'verify history preserved' },
      });
      const todo = (await todoRes.json()) as { id: string };
      await call(w.s.app, 'POST', `/api/projects/${projectId}/builds`, {
        body: { todoIds: [todo.id] },
      });
      const claimed = await call(w.s.app, 'POST', '/api/machine/tasks/claim', {
        cred: w.a.token,
        body: {},
      });
      const claimedBody = (await claimed.json()) as {
        step: { step: { id: string; generation?: number } } | null;
      };
      const stepId = claimedBody.step?.step.id ?? '';
      expect(stepId).not.toBe('');

      const now = Date.now();
      w.s.db
        .insert(phoneTable)
        .values({
          id: 'phone-1',
          machineId: w.a.machineId,
          teamId: w.s.team.id,
          platform: 'ios',
          deviceId: 'dev-1',
          name: 'Phone',
          createdAt: now,
          updatedAt: now,
        })
        .run();
      w.s.db
        .insert(computerTable)
        .values({
          id: 'comp-1',
          teamId: w.s.team.id,
          machineId: w.a.machineId,
          scopeKey: 'default',
          providerRef: 'orb:comp-1',
          state: 'running',
          controlHolder: 'bot',
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const { rotateRes, newToken, stream } = await performPushedRotate(
        w.s,
        w.a.machineId,
        w.a.token,
        {
          hostKey: HOST_KEY_A,
        },
      );
      expect(rotateRes.status).toBe(200);
      expect(rotateRes.headers.get('cache-control')).toContain('no-store');
      const rotateJson = (await rotateRes.json()) as {
        delivery: string;
        machine: { id: string; online: boolean; tokenReauthRequired?: boolean };
      };
      expect(rotateJson.delivery).toBe('pushed');
      expect(rotateJson.machine.id).toBe(w.a.machineId);
      expect(rotateJson.machine.online).toBe(true);
      expect(rotateJson.machine.tokenReauthRequired).toBeUndefined();
      expect(newToken).not.toBe(w.a.token);

      expect(await stream.waitEnded()).toBe(true);
      expect(stream.events.some((ev) => ev.type === 'shutdown')).toBe(false);

      const oldProbes: [string, string][] = [
        ['GET', '/api/machine/me'],
        ['GET', '/api/machine/stream'],
        ['POST', '/api/machine/tasks/claim'],
        ['POST', '/api/machine/presence'],
        ['POST', '/api/machine/recover'],
        ['POST', `/api/machine/heartbeat/${stepId}`],
      ];
      for (const [method, path] of oldProbes) {
        const res = await call(
          w.s.app,
          method,
          path,
          method === 'POST' ? { cred: w.a.token, body: {} } : { cred: w.a.token },
        );
        expect(res.status, `old token ${method} ${path}`).toBe(401);
      }

      const freshStream = await openMachineStream(w.s.app, newToken);
      expect(freshStream.status).toBe(200);
      expect((await call(w.s.app, 'GET', '/api/machine/me', { cred: newToken })).status).toBe(200);
      expect(
        (
          await call(w.s.app, 'POST', `/api/machine/heartbeat/${stepId}`, {
            cred: newToken,
            body: {},
          })
        ).status,
      ).toBe(200);
      freshStream.abort();

      const row = machineRowOf(w.s, w.a.machineId) as Record<string, unknown> | undefined;
      expect(row?.retiredAt).toBeNull();
      expect(row?.online).toBe(true);
      expect(row?.pendingTokenHash).toBeNull();
      expect(row?.tokenReauthRequired).toBe(false);
      expect(
        w.s.db.select().from(teamTable).where(eq(teamTable.id, w.s.team.id)).get()
          ?.defaultMachineId,
      ).toBe(w.a.machineId);
      expect(
        w.s.db.select().from(routingRuleTable).where(eq(routingRuleTable.use, 'session')).get()
          ?.machineId,
      ).toBe(w.a.machineId);
      expect(w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()?.machineId).toBe(
        w.a.machineId,
      );
      expect(
        w.s.db.select().from(phoneTable).where(eq(phoneTable.id, 'phone-1')).get()?.machineId,
      ).toBe(w.a.machineId);
      expect(
        w.s.db.select().from(computerTable).where(eq(computerTable.id, 'comp-1')).get()?.machineId,
      ).toBe(w.a.machineId);
      expect(w.s.db.select().from(buildTable).all().length).toBe(1);
    } finally {
      w.s.dispose();
    }
  });

  test('real daemon client + real HTTP server completes SSE -> claim -> machine.json -> ack -> reconnect -> task run', async () => {
    const w = await setupWorld({ tokenRotationTimeoutMs: 4_000 });
    const home = makeTestTempDir('rotate-live-daemon-');
    const server = serve({ fetch: w.s.app.fetch, hostname: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const serverUrl = `http://127.0.0.1:${port}`;
    try {
      const config = loadDaemonConfig(
        { serverUrl, apiKey: w.apiKey, teamId: w.s.team.id, home, name: 'live-runner' },
        {},
      );
      const paths = statePaths(home, config.workspacesDir);
      const lines: string[] = [];
      const logger = createDaemonLogger({ logFile: paths.daemonLog });
      const origMachine = logger.machine.bind(logger);
      logger.machine = (msg: string) => {
        lines.push(msg);
        origMachine(msg);
      };
      const backend = {
        capabilities: PI_CAPABILITIES,
        async createSession() {
          return {
            sessionId: 'sess-rotate-1',
            events: (async function* () {
              yield { type: 'text_delta' as const, text: 'rotated ok' };
              yield { type: 'done' as const, usage: [] };
            })(),
            async steer() {},
            async stop() {},
            usage: () => [],
          };
        },
        async continueSession() {
          throw new Error('unexpected continue');
        },
      };
      let tokenRef = '';
      const handle = await runMachine({
        config,
        paths,
        logger,
        backend,
        claudeCodeAuthProbe: async () => ({
          state: 'logged-in',
          method: 'claude.ai',
          provider: 'firstParty',
        }),
        readClaudeOauthExpiresAt: () => null,
        capabilitiesProbe: () => ({ mcpServers: [], skills: [] }),
        idleSleepPrevention: false,
        presenceIntervalMs: 60_000,
        claimBackoffBaseMs: 20,
        proxyEnv: {},
        ...offlineDaemonRuntimeOpts(),
      });
      try {
        await waitFor(
          () => loadMachineJson(paths) !== null && w.s.machineHub.isConnected(handle.machineId),
        );
        const beforeJson = loadMachineJson(paths)!;
        tokenRef = beforeJson.token;
        expect((await call(w.s.app, 'GET', '/api/machine/me', { cred: tokenRef })).status).toBe(
          200,
        );

        const rotateRes = await call(
          w.s.app,
          'POST',
          `/api/machines/${handle.machineId}/rotate-token`,
          {
            body: {},
          },
        );
        expect(rotateRes.status).toBe(200);
        const rotateBody = (await rotateRes.json()) as {
          delivery: string;
          machine: { online: boolean };
        };
        expect(rotateBody.delivery).toBe('pushed');
        expect(rotateBody.machine.online).toBe(true);

        await waitFor(() => loadMachineJson(paths)?.token !== tokenRef);
        const afterJson = loadMachineJson(paths)!;
        expect(afterJson.machineId).toBe(handle.machineId);
        expect(afterJson.token).not.toBe(tokenRef);
        expect((await call(w.s.app, 'GET', '/api/machine/me', { cred: tokenRef })).status).toBe(
          401,
        );
        expect(
          (await call(w.s.app, 'GET', '/api/machine/me', { cred: afterJson.token })).status,
        ).toBe(200);
        await waitFor(() => w.s.machineHub.isConnected(handle.machineId));

        w.s.db
          .update(routingRuleTable)
          .set({ machineId: handle.machineId })
          .where(eq(routingRuleTable.use, 'session'))
          .run();
        const projectId = await postProject(w.s.app);
        const todoRes = await call(w.s.app, 'POST', `/api/projects/${projectId}/todos`, {
          body: { title: 'post-rotate task', spec: 'run on rotated token' },
        });
        const todo = (await todoRes.json()) as { id: string };
        const buildRes = await call(w.s.app, 'POST', `/api/projects/${projectId}/builds`, {
          body: { todoIds: [todo.id] },
        });
        expect(buildRes.status).toBe(201);
        await waitFor(
          () =>
            w.s.db
              .select()
              .from(stepTable)
              .all()
              .some((st) => st.machineId === handle.machineId && st.status === 'done'),
          6_000,
        );
        const joinedLogs = lines.join('\n');
        expect(joinedLogs).not.toContain(tokenRef);
        expect(joinedLogs).not.toContain(afterJson.token);
      } finally {
        await handle.stop();
        await handle.done;
      }
    } finally {
      if ('closeAllConnections' in server && typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
      releaseTestTempDir(home);
      w.s.dispose();
    }
  });

  test('offline rotation invalidates old token immediately, marks tokenReauthRequired, and clears on browser or API-key re-enroll keeping same machine id', async () => {
    const w = await setupWorld({ hostKey: HOST_KEY_A });
    try {
      const rotateRes = await call(w.s.app, 'POST', `/api/machines/${w.a.machineId}/rotate-token`, {
        body: {},
      });
      expect(rotateRes.status).toBe(200);
      const rotated = (await rotateRes.json()) as {
        delivery: string;
        machine: { id: string; online: boolean; tokenReauthRequired?: boolean };
      };
      expect(rotated.delivery).toBe('offline');
      expect(rotated.machine.online).toBe(false);
      expect(rotated.machine.tokenReauthRequired).toBe(true);
      expect((await call(w.s.app, 'GET', '/api/machine/me', { cred: w.a.token })).status).toBe(401);

      const reEnrolledApiKey = await enroll(w.s, w.apiKey, 'host-a', HOST_KEY_A);
      expect(reEnrolledApiKey.machineId).toBe(w.a.machineId);
      expect((await call(w.s.app, 'GET', '/api/machine/me', { cred: w.a.token })).status).toBe(401);
      expect(
        (await call(w.s.app, 'GET', '/api/machine/me', { cred: reEnrolledApiKey.token })).status,
      ).toBe(200);
      const afterApiKey = machineRowOf(w.s, w.a.machineId) as Record<string, unknown> | undefined;
      expect(afterApiKey?.tokenReauthRequired).toBe(false);

      const rotate2 = await call(w.s.app, 'POST', `/api/machines/${w.a.machineId}/rotate-token`, {
        body: {},
      });
      expect(rotate2.status).toBe(200);
      expect(
        (await call(w.s.app, 'GET', '/api/machine/me', { cred: reEnrolledApiKey.token })).status,
      ).toBe(401);

      const startRes = await call(w.s.app, 'POST', '/api/machine/enroll/start', {
        body: { name: 'host-a', hostKey: HOST_KEY_A, teamId: w.s.team.id },
      });
      const { enrollId } = (await startRes.json()) as { enrollId: string };
      const confirmRes = await call(w.s.app, 'POST', '/api/machine/enroll/confirm', {
        body: { enrollId },
      });
      expect(confirmRes.status).toBe(200);
      const browserEnrolled = (
        (await confirmRes.json()) as { machine: { machineId: string; token: string } }
      ).machine;
      expect(browserEnrolled.machineId).toBe(w.a.machineId);
      expect(
        (await call(w.s.app, 'GET', '/api/machine/me', { cred: browserEnrolled.token })).status,
      ).toBe(200);
      const afterBrowser = machineRowOf(w.s, w.a.machineId) as Record<string, unknown> | undefined;
      expect(afterBrowser?.tokenReauthRequired).toBe(false);
    } finally {
      w.s.dispose();
    }
  });

  test('server restart after claim promotes persisted pendingTokenHash on ack; idempotent ack handles lost response; markConnected publishes presence', async () => {
    const w1 = await setupWorld({ tokenRotationTimeoutMs: 2_000 });
    const stream = await openMachineStream(w1.s.app, w1.a.token);
    await waitFor(() => stream.getConnectionId() !== '');
    const rotatePromise = call(w1.s.app, 'POST', `/api/machines/${w1.a.machineId}/rotate-token`, {
      body: {},
    });
    await waitFor(() => stream.events.some((ev) => ev.type === 'token.rotate'));
    const rotateEv = stream.events.find((ev) => ev.type === 'token.rotate') as {
      rotationId: string;
    };
    const claimRes = await call(w1.s.app, 'POST', '/api/machine/token-rotate/claim', {
      cred: w1.a.token,
      body: { rotationId: rotateEv.rotationId, connectionId: stream.getConnectionId() },
    });
    expect(claimRes.status).toBe(200);
    const { token: newToken } = (await claimRes.json()) as { token: string };
    expect((machineRowOf(w1.s, w1.a.machineId) as Record<string, unknown>)?.pendingTokenHash).toBe(
      hashCredential(newToken),
    );
    expect((await call(w1.s.app, 'GET', '/api/machine/me', { cred: newToken })).status).toBe(401);

    const w2 = bootServer({ db: w1.s.db, pingIntervalMs: 3_600_000 });
    try {
      const preAckReconnect = await openMachineStream(w2.app, w1.a.token);
      expect(preAckReconnect.status).toBe(200);
      preAckReconnect.abort();
      expect((machineRowOf(w2, w1.a.machineId) as Record<string, unknown>)?.pendingTokenHash).toBe(
        hashCredential(newToken),
      );
      const teamEvents = tapTeamEvents(w2);
      const ackAfterRestart = await call(w2.app, 'POST', '/api/machine/token-rotate/ack', {
        cred: newToken,
        body: { rotationId: rotateEv.rotationId },
      });
      expect(ackAfterRestart.status).toBe(200);
      expect((await call(w2.app, 'GET', '/api/machine/me', { cred: w1.a.token })).status).toBe(401);
      expect((await call(w2.app, 'GET', '/api/machine/me', { cred: newToken })).status).toBe(200);
      expect(
        (machineRowOf(w2, w1.a.machineId) as Record<string, unknown>)?.pendingTokenHash,
      ).toBeNull();

      w2.db
        .update(machineTable)
        .set({
          online: true,
          tokenReauthRequired: true,
          pendingTokenHash: 'staged-next-rotation',
        } as Record<string, unknown>)
        .where(eq(machineTable.id, w1.a.machineId))
        .run();
      const idempotentAck = await call(w2.app, 'POST', '/api/machine/token-rotate/ack', {
        cred: newToken,
        body: { rotationId: rotateEv.rotationId },
      });
      expect(idempotentAck.status).toBe(200);
      expect(
        (machineRowOf(w2, w1.a.machineId) as Record<string, unknown>)?.tokenReauthRequired,
      ).toBe(false);
      expect((machineRowOf(w2, w1.a.machineId) as Record<string, unknown>)?.pendingTokenHash).toBe(
        'staged-next-rotation',
      );
      expect(
        teamEvents.some((ev) => ev.type === 'machine_presence' && ev.machineId === w1.a.machineId),
      ).toBe(true);
    } finally {
      stream.abort();
      await rotatePromise.catch(() => {});
      w2.dispose();
      w1.s.dispose();
    }
  });

  test('online timeout (unclaimed) cuts over offline; claimed-then-timeout hands off without shutdown and self-heals on reconnect; grace expiry marks offline', async () => {
    const w = await setupWorld({ tokenRotationTimeoutMs: 60, offlineGraceMs: 80 });
    try {
      const unclaimedStream = await openMachineStream(w.s.app, w.a.token);
      await waitFor(() => unclaimedStream.getConnectionId() !== '');
      const timeoutRes = await call(
        w.s.app,
        'POST',
        `/api/machines/${w.a.machineId}/rotate-token`,
        { body: {} },
      );
      expect(timeoutRes.status).toBe(200);
      const timeoutBody = (await timeoutRes.json()) as {
        delivery: string;
        machine: { online: boolean; tokenReauthRequired?: boolean };
      };
      expect(timeoutBody.delivery).toBe('offline');
      expect(timeoutBody.machine.online).toBe(false);
      expect(timeoutBody.machine.tokenReauthRequired).toBe(true);
      expect(await unclaimedStream.waitEnded()).toBe(true);
      expect((await call(w.s.app, 'GET', '/api/machine/me', { cred: w.a.token })).status).toBe(401);

      const b = await enroll(w.s, w.apiKey, 'host-a');
      const claimedStream = await openMachineStream(w.s.app, b.token);
      await waitFor(() => claimedStream.getConnectionId() !== '');
      const claimedRotateP = call(w.s.app, 'POST', `/api/machines/${b.machineId}/rotate-token`, {
        body: {},
      });
      await waitFor(() => claimedStream.events.some((ev) => ev.type === 'token.rotate'));
      const ev = claimedStream.events.find((item) => item.type === 'token.rotate') as {
        rotationId: string;
      };
      const claimRes = await call(w.s.app, 'POST', '/api/machine/token-rotate/claim', {
        cred: b.token,
        body: { rotationId: ev.rotationId, connectionId: claimedStream.getConnectionId() },
      });
      expect(claimRes.status).toBe(200);
      const { token: savedToken } = (await claimRes.json()) as { token: string };
      const claimedRotateRes = await claimedRotateP;
      expect(claimedRotateRes.status).toBe(200);
      expect(((await claimedRotateRes.json()) as { delivery: string }).delivery).toBe('offline');
      expect(await claimedStream.waitEnded()).toBe(true);
      expect(claimedStream.events.some((item) => item.type === 'shutdown')).toBe(false);

      const reconnectStream = await openMachineStream(w.s.app, savedToken);
      expect(reconnectStream.status).toBe(200);
      expect((machineRowOf(w.s, b.machineId) as Record<string, unknown>)?.tokenReauthRequired).toBe(
        false,
      );
      reconnectStream.abort();

      await waitFor(() => !machineRowOf(w.s, b.machineId)?.online, 1000);
    } finally {
      w.s.dispose();
    }
  });

  test('SSE disconnect or replacement mid-rotation aborts immediately and rejects stale claim; mismatched hostKey rejected', async () => {
    const w = await setupWorld({ hostKey: HOST_KEY_A, tokenRotationTimeoutMs: 5_000 });
    try {
      const stream1 = await openMachineStream(w.s.app, w.a.token);
      await waitFor(() => stream1.getConnectionId() !== '');
      const conn1 = stream1.getConnectionId();
      const rotateP = call(w.s.app, 'POST', `/api/machines/${w.a.machineId}/rotate-token`, {
        body: {},
      });
      await waitFor(() => stream1.events.some((ev) => ev.type === 'token.rotate'));
      const ev1 = stream1.events.find((item) => item.type === 'token.rotate') as {
        rotationId: string;
      };

      const badHost = await call(w.s.app, 'POST', '/api/machine/token-rotate/claim', {
        cred: w.a.token,
        body: { rotationId: ev1.rotationId, connectionId: conn1, hostKey: HOST_KEY_B },
      });
      expect(badHost.status).toBe(404);

      const hijackStream = await openMachineStream(w.s.app, w.a.token);
      expect(hijackStream.status).toBe(401);
      const rotateRes = await rotateP;
      expect(rotateRes.status).toBe(200);
      expect(((await rotateRes.json()) as { delivery: string }).delivery).toBe('offline');
      expect((await call(w.s.app, 'GET', '/api/machine/me', { cred: w.a.token })).status).toBe(401);
      hijackStream.abort();

      const legacyHostRunner = await enroll(w.s, w.apiKey, 'legacy-host-box', HOST_KEY_A);
      const legacyStream = await openMachineStream(w.s.app, legacyHostRunner.token);
      await waitFor(() => legacyStream.getConnectionId() !== '');
      const legacyRotateP = call(
        w.s.app,
        'POST',
        `/api/machines/${legacyHostRunner.machineId}/rotate-token`,
        {
          body: {},
        },
      );
      await waitFor(() => legacyStream.events.some((ev) => ev.type === 'token.rotate'));
      const legacyEv = legacyStream.events.find((ev) => ev.type === 'token.rotate') as {
        rotationId: string;
      };
      const legacyClaimRes = await call(w.s.app, 'POST', '/api/machine/token-rotate/claim', {
        cred: legacyHostRunner.token,
        body: {
          rotationId: legacyEv.rotationId,
          connectionId: legacyStream.getConnectionId(),
          hostKey: HOST_KEY_B,
          legacyHostKeys: [HOST_KEY_A],
        },
      });
      expect(legacyClaimRes.status).toBe(200);
      const { token: legacyNewToken } = (await legacyClaimRes.json()) as { token: string };
      expect(
        (
          await call(w.s.app, 'POST', '/api/machine/token-rotate/ack', {
            cred: legacyNewToken,
            body: { rotationId: legacyEv.rotationId },
          })
        ).status,
      ).toBe(200);
      expect(((await (await legacyRotateP).json()) as { delivery: string }).delivery).toBe(
        'pushed',
      );
      legacyStream.abort();
    } finally {
      w.s.dispose();
    }
  });

  test('concurrent double rotation, CAS miss, duplicate claim, invalid/unclaimed ack, auth/team guards', async () => {
    const w = await setupWorld({ authToken: OWNER_TOKEN, tokenRotationTimeoutMs: 5_000 });
    try {
      for (const cred of [undefined, w.a.token, 'wrong-owner-token']) {
        const res = await call(w.s.app, 'POST', `/api/machines/${w.a.machineId}/rotate-token`, {
          ...(cred ? { cred } : {}),
          body: {},
        });
        expect(res.status).toBe(401);
      }

      const deviceToken = `${DEVICE_TOKEN_PREFIX}rotate-test-token`;
      w.s.db
        .insert(pairedDeviceTable)
        .values({
          id: 'pd-1',
          teamId: w.s.team.id,
          name: 'Phone',
          tokenHash: hashCredential(deviceToken),
          masked: 'pair...ok',
          createdAt: Date.now(),
        })
        .run();
      expect(
        (
          await call(w.s.app, 'POST', `/api/machines/${w.a.machineId}/rotate-token`, {
            cred: deviceToken,
            body: {},
          })
        ).status,
      ).toBe(200);
      const reEnrolled = await enroll(w.s, w.apiKey, 'host-a');

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
        .values(
          readyMachine({
            id: 'machine-foreign',
            teamId: 'team-other',
            name: 'foreign',
            online: false,
            tokenHash: hashCredential('foreign-tok'),
          }),
        )
        .run();
      expect(
        (
          await call(w.s.app, 'POST', '/api/machines/machine-foreign/rotate-token', {
            cred: OWNER_TOKEN,
            body: {},
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await call(w.s.app, 'POST', '/api/machines/missing/rotate-token', {
            cred: OWNER_TOKEN,
            body: {},
          })
        ).status,
      ).toBe(404);

      w.s.db
        .insert(machineTable)
        .values({
          id: 'machine-unenrolled',
          teamId: w.s.team.id,
          name: 'local-unenrolled',
          online: false,
          tokenHash: null,
          apiKeyId: null,
          latestCliVersion: null,
          kind: 'local',
        })
        .run();
      expect(
        (
          await call(w.s.app, 'POST', '/api/machines/machine-unenrolled/rotate-token', {
            cred: OWNER_TOKEN,
            body: {},
          })
        ).status,
      ).toBe(409);

      const stream = await openMachineStream(w.s.app, reEnrolled.token);
      await waitFor(() => stream.getConnectionId() !== '');
      const firstRotate = call(
        w.s.app,
        'POST',
        `/api/machines/${reEnrolled.machineId}/rotate-token`,
        {
          cred: OWNER_TOKEN,
          body: {},
        },
      );
      await waitFor(() => stream.events.some((ev) => ev.type === 'token.rotate'));
      const ev = stream.events.find((item) => item.type === 'token.rotate') as {
        rotationId: string;
      };

      const secondRotate = await call(
        w.s.app,
        'POST',
        `/api/machines/${reEnrolled.machineId}/rotate-token`,
        {
          cred: OWNER_TOKEN,
          body: {},
        },
      );
      expect(secondRotate.status).toBe(409);

      const unclaimedAck = await call(w.s.app, 'POST', '/api/machine/token-rotate/ack', {
        cred: 'f'.repeat(64),
        body: { rotationId: ev.rotationId },
      });
      expect(unclaimedAck.status).toBe(401);

      const claim1 = await call(w.s.app, 'POST', '/api/machine/token-rotate/claim', {
        cred: reEnrolled.token,
        body: { rotationId: ev.rotationId, connectionId: stream.getConnectionId() },
      });
      expect(claim1.status).toBe(200);
      const { token: newToken } = (await claim1.json()) as { token: string };

      const claim2 = await call(w.s.app, 'POST', '/api/machine/token-rotate/claim', {
        cred: reEnrolled.token,
        body: { rotationId: ev.rotationId, connectionId: stream.getConnectionId() },
      });
      expect(claim2.status).toBe(404);

      expect(
        (
          await call(w.s.app, 'POST', `/api/machines/${reEnrolled.machineId}/revoke`, {
            cred: OWNER_TOKEN,
          })
        ).status,
      ).toBe(204);
      const lateAck = await call(w.s.app, 'POST', '/api/machine/token-rotate/ack', {
        cred: newToken,
        body: { rotationId: ev.rotationId },
      });
      expect(lateAck.status).toBe(401);
      const firstRes = await firstRotate;
      expect([404, 409]).toContain(firstRes.status);
    } finally {
      w.s.dispose();
    }
  });

  test('secret hygiene: neither plaintext tokens nor hashes leak on rotate, claim, ack, list, SSE or trace logs', async () => {
    const logs: string[] = [];
    const w = await setupWorld({
      logger: pino({ level: 'trace' }, { write: (line) => logs.push(line) }),
    });
    try {
      const oldHash = createHash('sha256').update(w.a.token).digest('hex');
      const { rotateRes, newToken, stream } = await performPushedRotate(
        w.s,
        w.a.machineId,
        w.a.token,
      );
      const newHash = createHash('sha256').update(newToken).digest('hex');
      const listRes = await call(w.s.app, 'GET', `/api/teams/${w.s.team.id}/machines`);
      const errorAck = await call(w.s.app, 'POST', '/api/machine/token-rotate/ack', {
        cred: '0'.repeat(64),
        body: { rotationId: 'bad-id' },
      });
      const surfaces = [
        await rotateRes.text(),
        await listRes.text(),
        await errorAck.text(),
        JSON.stringify(stream.events),
        logs.join('\n'),
      ].join('\n');
      expect(surfaces).not.toContain(w.a.token);
      expect(surfaces).not.toContain(newToken);
      expect(surfaces).not.toContain(oldHash);
      expect(surfaces).not.toContain(newHash);
      expect(surfaces).not.toContain('tokenHash');
      expect(surfaces).not.toContain('pendingTokenHash');
    } finally {
      w.s.dispose();
    }
  });
});

function createControlledClock(initialNow = Date.now()) {
  let current = initialNow;
  let nextHandle = 1;
  const timers = new Map<
    number,
    { fireAt: number; cb: () => void | Promise<void>; native?: ReturnType<typeof setTimeout> }
  >();
  const clock: DueClock = {
    now: () => current,
    setTimer(cb, delayMs) {
      const id = nextHandle++;
      const fireAt = current + Math.max(0, delayMs);
      const native =
        delayMs <= 0
          ? setTimeout(() => {
              const entry = timers.get(id);
              if (!entry) return;
              timers.delete(id);
              void entry.cb();
            }, 0)
          : undefined;
      timers.set(id, { fireAt, cb, ...(native !== undefined ? { native } : {}) });
      return id;
    },
    clearTimer(handle) {
      const entry = timers.get(handle as number);
      if (entry?.native !== undefined) clearTimeout(entry.native);
      timers.delete(handle as number);
    },
  };
  return {
    clock,
    now: () => current,
    async advanceTo(targetMs: number) {
      if (targetMs > current) current = targetMs;
      for (;;) {
        let soonestId: number | null = null;
        let soonestAt = Number.POSITIVE_INFINITY;
        for (const [id, entry] of timers.entries()) {
          if (entry.fireAt <= current && entry.fireAt < soonestAt) {
            soonestAt = entry.fireAt;
            soonestId = id;
          }
        }
        if (soonestId === null) break;
        const entry = timers.get(soonestId);
        if (entry?.native !== undefined) clearTimeout(entry.native);
        timers.delete(soonestId);
        if (entry) await entry.cb();
      }
    },
  };
}

describe('automatic runner token rotation', () => {
  test('scheduled auto-rotation rotates online runner in place while active step finishes and queued task dispatches', async () => {
    const w = await setupWorld({ hostKey: HOST_KEY_A });
    const stream = await openMachineStream(w.s.app, w.a.token);
    const controlled = createControlledClock();
    const scheduler = createScheduler(
      {
        db: w.s.db,
        hub: w.s.hub,
        user: w.s.user,
        machineHub: w.s.machineHub,
        convHub: w.s.convHub,
        reposDir: w.s.reposDir,
        attachmentsDir: w.s.attachmentsDir,
      },
      { tickMs: 3_600_000, clock: controlled.clock },
    );
    try {
      await waitFor(() => stream.getConnectionId() !== '');
      const projectId = await postProject(w.s.app);
      const todo1Res = await call(w.s.app, 'POST', `/api/projects/${projectId}/todos`, {
        body: { title: 'active task', spec: 'finish after auto rotation' },
      });
      const todo2Res = await call(w.s.app, 'POST', `/api/projects/${projectId}/todos`, {
        body: { title: 'queued task', spec: 'dispatch after auto rotation' },
      });
      const todo1 = (await todo1Res.json()) as { id: string };
      const todo2 = (await todo2Res.json()) as { id: string };
      await call(w.s.app, 'POST', `/api/projects/${projectId}/builds`, {
        body: { todoIds: [todo1.id, todo2.id] },
      });

      const claimed1 = await call(w.s.app, 'POST', '/api/machine/tasks/claim', {
        cred: w.a.token,
        body: {},
      });
      const step1Id = ((await claimed1.json()) as { step: { step: { id: string } } | null }).step
        ?.step.id;
      expect(step1Id).toBeTruthy();

      const eventId = machineTokenRotationEventId(w.a.machineId);
      w.s.db
        .update(dueEventTable)
        .set({ dueAt: controlled.now() })
        .where(eq(dueEventTable.id, eventId))
        .run();

      scheduler.start();
      await waitFor(() => stream.events.some((ev) => ev.type === 'token.rotate'));
      const rotateEv = stream.events.find((ev) => ev.type === 'token.rotate') as {
        rotationId: string;
      };

      const claimRot = await call(w.s.app, 'POST', '/api/machine/token-rotate/claim', {
        cred: w.a.token,
        body: {
          rotationId: rotateEv.rotationId,
          connectionId: stream.getConnectionId(),
          hostKey: HOST_KEY_A,
        },
      });
      expect(claimRot.status).toBe(200);
      const { token: newToken } = (await claimRot.json()) as { token: string };

      const ackRot = await call(w.s.app, 'POST', '/api/machine/token-rotate/ack', {
        cred: newToken,
        body: { rotationId: rotateEv.rotationId },
      });
      expect(ackRot.status).toBe(200);

      await waitFor(() => {
        const due = w.s.db.select().from(dueEventTable).where(eq(dueEventTable.id, eventId)).get();
        return (
          due !== undefined &&
          due.dueAt >= controlled.now() + MACHINE_TOKEN_ROTATION_INTERVAL_MS - 10_000
        );
      });

      const oldProbe = await call(w.s.app, 'POST', '/api/machine/tasks/claim', {
        cred: w.a.token,
        body: {},
      });
      expect(oldProbe.status).toBe(401);

      const newStream = await openMachineStream(w.s.app, newToken);
      try {
        await waitFor(() => newStream.getConnectionId() !== '');
        const done1 = await call(w.s.app, 'POST', `/api/machine/done/${step1Id}`, {
          cred: newToken,
          body: { status: 'success' },
        });
        expect(done1.status).toBe(200);

        const claimed2 = await call(w.s.app, 'POST', '/api/machine/tasks/claim', {
          cred: newToken,
          body: {},
        });
        expect(claimed2.status).toBe(200);
        const step2Id = ((await claimed2.json()) as { step: { step: { id: string } } | null }).step
          ?.step.id;
        expect(step2Id).toBeTruthy();

        const row = machineRowOf(w.s, w.a.machineId);
        expect(row?.online).toBe(true);
        expect(row?.tokenReauthRequired).toBe(false);
        expect(row?.pendingTokenHash).toBeNull();
        const due = w.s.db.select().from(dueEventTable).where(eq(dueEventTable.id, eventId)).get();
        expect(due?.intervalMs).toBeNull();
        expect(due?.attempts).toBe(0);
      } finally {
        newStream.abort();
      }
    } finally {
      scheduler.stop();
      stream.abort();
      w.s.dispose();
    }
  });

  test('offline auto-rotation keeps old token valid, retries 1h, arms 5s on reconnect (not normal 7d <1h), and survives restart', async () => {
    const w = await setupWorld({ hostKey: HOST_KEY_A });
    const eventId = machineTokenRotationEventId(w.a.machineId);
    try {
      const dueNow = Date.now() - 1000;
      w.s.db
        .update(dueEventTable)
        .set({ dueAt: dueNow, intervalMs: null, attempts: 0 })
        .where(eq(dueEventTable.id, eventId))
        .run();

      const dueRow = w.s.db
        .select()
        .from(dueEventTable)
        .where(eq(dueEventTable.id, eventId))
        .get()!;
      const resOffline = await processMachineTokenRotationDue(
        { db: w.s.db, hub: w.s.hub, machineHub: w.s.machineHub },
        dueRow,
        Date.now(),
      );
      expect(resOffline.rescheduleAt).toBeGreaterThanOrEqual(
        Date.now() + MACHINE_TOKEN_ROTATION_RETRY_MS - 5000,
      );
      expect(resOffline.intervalMs).toBe(MACHINE_TOKEN_ROTATION_RETRY_MS);
      const afterOffline = machineRowOf(w.s, w.a.machineId);
      expect(afterOffline?.tokenReauthRequired).toBe(false);
      expect(afterOffline?.tokenHash).toBe(hashCredential(w.a.token));

      const pollWhileOffline = await call(w.s.app, 'POST', '/api/machine/tasks/claim', {
        cred: w.a.token,
        body: {},
      });
      expect(pollWhileOffline.status).toBe(200);

      w.s.db
        .update(dueEventTable)
        .set({
          dueAt: resOffline.rescheduleAt!,
          intervalMs: resOffline.intervalMs ?? null,
          attempts: 0,
        })
        .where(eq(dueEventTable.id, eventId))
        .run();

      const connectBefore = Date.now();
      const stream = await openMachineStream(w.s.app, w.a.token);
      try {
        await waitFor(() => stream.getConnectionId() !== '');
        const armed = w.s.db
          .select()
          .from(dueEventTable)
          .where(eq(dueEventTable.id, eventId))
          .get();
        expect(armed).toBeDefined();
        expect(armed!.dueAt).toBeGreaterThanOrEqual(connectBefore);
        expect(armed!.dueAt).toBeLessThanOrEqual(
          Date.now() + MACHINE_TOKEN_ROTATION_CONNECT_GRACE_MS + 1000,
        );
        expect(armed!.intervalMs).toBe(MACHINE_TOKEN_ROTATION_RETRY_MS);
      } finally {
        stream.abort();
      }

      const normalShortDue = Date.now() + 30 * 60_000;
      w.s.db
        .update(dueEventTable)
        .set({ dueAt: normalShortDue, intervalMs: null, attempts: 0 })
        .where(eq(dueEventTable.id, eventId))
        .run();
      armOverdueTokenRotationOnConnect(w.s.db, w.a.machineId, Date.now());
      const afterNormalConnect = w.s.db
        .select()
        .from(dueEventTable)
        .where(eq(dueEventTable.id, eventId))
        .get();
      expect(afterNormalConnect?.dueAt).toBe(normalShortDue);
      expect(afterNormalConnect?.intervalMs).toBeNull();

      const restarted = bootServer({ db: w.s.db });
      try {
        const persisted = restarted.db
          .select()
          .from(dueEventTable)
          .where(eq(dueEventTable.id, eventId))
          .get();
        expect(persisted?.dueAt).toBe(normalShortDue);
      } finally {
        restarted.dispose();
      }
    } finally {
      w.s.dispose();
    }
  });

  test('online timeout, claimed-then-timeout + late ack, idempotent ack, and concurrency cap preserve old token and schedule integrity', async () => {
    const w = await setupWorld({ hostKey: HOST_KEY_A, tokenRotationTimeoutMs: 60 });
    const stream = await openMachineStream(w.s.app, w.a.token);
    const eventId = machineTokenRotationEventId(w.a.machineId);
    try {
      await waitFor(() => stream.getConnectionId() !== '');
      const dueRow = w.s.db
        .select()
        .from(dueEventTable)
        .where(eq(dueEventTable.id, eventId))
        .get()!;

      const timedOut = await processMachineTokenRotationDue(
        { db: w.s.db, hub: w.s.hub, machineHub: w.s.machineHub },
        dueRow,
        Date.now(),
        { timeoutMs: 60 },
      );
      expect(timedOut.intervalMs).toBe(MACHINE_TOKEN_ROTATION_RETRY_MS);
      expect(machineRowOf(w.s, w.a.machineId)?.online).toBe(true);
      expect(machineRowOf(w.s, w.a.machineId)?.tokenReauthRequired).toBe(false);
      expect(machineRowOf(w.s, w.a.machineId)?.tokenHash).toBe(hashCredential(w.a.token));

      const rotatePromise = processMachineTokenRotationDue(
        { db: w.s.db, hub: w.s.hub, machineHub: w.s.machineHub },
        dueRow,
        Date.now(),
        { timeoutMs: 120 },
      );
      await waitFor(() => stream.events.filter((e) => e.type === 'token.rotate').length >= 2);
      const latestEv = stream.events.filter((e) => e.type === 'token.rotate').at(-1) as {
        rotationId: string;
      };
      const claimRes = await call(w.s.app, 'POST', '/api/machine/token-rotate/claim', {
        cred: w.a.token,
        body: {
          rotationId: latestEv.rotationId,
          connectionId: stream.getConnectionId(),
          hostKey: HOST_KEY_A,
        },
      });
      expect(claimRes.status).toBe(200);
      const { token: stagedToken } = (await claimRes.json()) as { token: string };

      const claimTimeoutRes = await rotatePromise;
      expect(claimTimeoutRes.intervalMs).toBe(MACHINE_TOKEN_ROTATION_RETRY_MS);
      expect(machineRowOf(w.s, w.a.machineId)?.tokenHash).toBe(hashCredential(w.a.token));
      expect(machineRowOf(w.s, w.a.machineId)?.pendingTokenHash).toBe(hashCredential(stagedToken));

      const blockingRot = processMachineTokenRotationDue(
        { db: w.s.db, hub: w.s.hub, machineHub: w.s.machineHub },
        dueRow,
        Date.now(),
        { timeoutMs: 120 },
      );
      const activeBlockedAck = await call(w.s.app, 'POST', '/api/machine/token-rotate/ack', {
        cred: stagedToken,
        body: { rotationId: latestEv.rotationId },
      });
      expect(activeBlockedAck.status).toBe(401);
      await blockingRot;

      const lateAck = await call(w.s.app, 'POST', '/api/machine/token-rotate/ack', {
        cred: stagedToken,
        body: { rotationId: latestEv.rotationId },
      });
      expect(lateAck.status).toBe(200);
      expect(machineRowOf(w.s, w.a.machineId)?.tokenHash).toBe(hashCredential(stagedToken));

      const sentinelDue = Date.now() + 123_456;
      w.s.db
        .update(dueEventTable)
        .set({ dueAt: sentinelDue, intervalMs: null })
        .where(eq(dueEventTable.id, eventId))
        .run();
      const replayAck = await call(w.s.app, 'POST', '/api/machine/token-rotate/ack', {
        cred: stagedToken,
        body: { rotationId: latestEv.rotationId },
      });
      expect(replayAck.status).toBe(200);
      expect(
        w.s.db.select().from(dueEventTable).where(eq(dueEventTable.id, eventId)).get()?.dueAt,
      ).toBe(sentinelDue);

      const extras = await Promise.all(
        ['b', 'c', 'd', 'e'].map((n) =>
          enroll(w.s, issueKey(w.s, `key-${n}`), `cap-${n}`, n.repeat(64)),
        ),
      );
      const streams = await Promise.all(
        [stagedToken, ...extras.map((e) => e.token)].map((tok) => openMachineStream(w.s.app, tok)),
      );
      try {
        await waitFor(() => streams.every((st) => st.getConnectionId() !== ''));
        const ids = [w.a.machineId, ...extras.map((e) => e.machineId)];
        const slowCalls = ids.slice(0, 4).map((id) =>
          processMachineTokenRotationDue(
            { db: w.s.db, hub: w.s.hub, machineHub: w.s.machineHub },
            w.s.db
              .select()
              .from(dueEventTable)
              .where(eq(dueEventTable.id, machineTokenRotationEventId(id)))
              .get()!,
            Date.now(),
            { timeoutMs: 150 },
          ),
        );
        const fifthStart = Date.now();
        const fifthRes = await processMachineTokenRotationDue(
          { db: w.s.db, hub: w.s.hub, machineHub: w.s.machineHub },
          w.s.db
            .select()
            .from(dueEventTable)
            .where(eq(dueEventTable.id, machineTokenRotationEventId(ids[4]!)))
            .get()!,
          fifthStart,
          { timeoutMs: 150 },
        );
        expect(Date.now() - fifthStart).toBeLessThan(80);
        expect(fifthRes.intervalMs).toBe(MACHINE_TOKEN_ROTATION_RETRY_MS);
        await Promise.all(slowCalls);
      } finally {
        for (const st of streams) st.abort();
      }
    } finally {
      stream.abort();
      w.s.dispose();
    }
  });

  test('lifecycle reset/cancel, concurrent re-enroll & reservedDueAt CAS, and syncDueSources staggered seed/prune', async () => {
    const w = await setupWorld({ hostKey: HOST_KEY_A });
    const stream = await openMachineStream(w.s.app, w.a.token);
    const controlled = createControlledClock();
    try {
      await waitFor(() => stream.getConnectionId() !== '');
      const eventId = machineTokenRotationEventId(w.a.machineId);

      const runner = createDueRunner(w.s.db, controlled.clock, {
        [MACHINE_TOKEN_ROTATION_EVENT_KIND]: async (event, now) => {
          return processMachineTokenRotationDue(
            { db: w.s.db, hub: w.s.hub, machineHub: w.s.machineHub },
            event,
            now,
            { timeoutMs: 120 },
          );
        },
      });
      try {
        w.s.db
          .update(dueEventTable)
          .set({ dueAt: controlled.now(), intervalMs: null, attempts: 0 })
          .where(eq(dueEventTable.id, eventId))
          .run();
        runner.arm();
        await waitFor(() => stream.events.some((ev) => ev.type === 'token.rotate'));

        const reEnrolled = await enroll(w.s, w.apiKey, 'host-a', HOST_KEY_A);
        expect(reEnrolled.machineId).toBe(w.a.machineId);
        const dueAfterEnroll = w.s.db
          .select()
          .from(dueEventTable)
          .where(eq(dueEventTable.id, eventId))
          .get();
        expect(dueAfterEnroll?.intervalMs).toBeNull();
        expect(dueAfterEnroll!.dueAt).toBeGreaterThanOrEqual(
          Date.now() + MACHINE_TOKEN_ROTATION_INTERVAL_MS - 10_000,
        );
        const targetDueAt = dueAfterEnroll!.dueAt;

        await new Promise((r) => setTimeout(r, 180));
        const dueAfterSettle = w.s.db
          .select()
          .from(dueEventTable)
          .where(eq(dueEventTable.id, eventId))
          .get();
        expect(dueAfterSettle?.dueAt).toBe(targetDueAt);
        expect(dueAfterSettle?.intervalMs).toBeNull();
      } finally {
        runner.stop();
      }

      await call(w.s.app, 'POST', `/api/machines/${w.a.machineId}/revoke`);
      expect(
        w.s.db.select().from(dueEventTable).where(eq(dueEventTable.id, eventId)).get(),
      ).toBeUndefined();

      const b = await enroll(w.s, issueKey(w.s, 'key-b-del'), 'host-b', HOST_KEY_B);
      const bEvent = machineTokenRotationEventId(b.machineId);
      expect(
        w.s.db.select().from(dueEventTable).where(eq(dueEventTable.id, bEvent)).get(),
      ).toBeDefined();
      await call(w.s.app, 'DELETE', `/api/machines/${b.machineId}`);
      expect(
        w.s.db.select().from(dueEventTable).where(eq(dueEventTable.id, bEvent)).get(),
      ).toBeUndefined();

      const active = await enroll(w.s, issueKey(w.s, 'key-seed'), 'host-seed', 'c'.repeat(64));
      w.s.db.delete(dueEventTable).run();
      w.s.db
        .insert(dueEventTable)
        .values({
          id: machineTokenRotationEventId('orphan-id'),
          kind: MACHINE_TOKEN_ROTATION_EVENT_KIND,
          dueAt: controlled.now() + 1000,
          intervalMs: null,
          attempts: 0,
          lastError: null,
        })
        .run();

      const sched = createScheduler(
        {
          db: w.s.db,
          hub: w.s.hub,
          user: w.s.user,
          machineHub: w.s.machineHub,
          convHub: w.s.convHub,
          reposDir: w.s.reposDir,
          attachmentsDir: w.s.attachmentsDir,
        },
        { tickMs: 3_600_000, clock: controlled.clock },
      );
      try {
        sched.start();
        const seeded = w.s.db
          .select()
          .from(dueEventTable)
          .where(eq(dueEventTable.id, machineTokenRotationEventId(active.machineId)))
          .get();
        expect(seeded).toBeDefined();
        expect(seeded!.intervalMs).toBeNull();
        expect(seeded!.dueAt).toBeGreaterThanOrEqual(
          controlled.now() + MACHINE_TOKEN_ROTATION_INTERVAL_MS * 0.5,
        );
        expect(seeded!.dueAt).toBeLessThanOrEqual(
          controlled.now() + MACHINE_TOKEN_ROTATION_INTERVAL_MS,
        );
        expect(
          w.s.db
            .select()
            .from(dueEventTable)
            .where(eq(dueEventTable.id, machineTokenRotationEventId('orphan-id')))
            .get(),
        ).toBeUndefined();
      } finally {
        sched.stop();
      }
    } finally {
      stream.abort();
      w.s.dispose();
    }
  });

  test('mid-flight SSE replacement on initial rotation retains 5s arming, restart scheduler consumes persisted dueEvent, push failure and handler error log cleanly and retry 1h, and in-flight delete stays deleted', async () => {
    const w = await setupWorld({ hostKey: HOST_KEY_A });
    const stream1 = await openMachineStream(w.s.app, w.a.token);
    const controlled = createControlledClock();
    const infoLogs: Array<{ msg?: string; obj?: object }> = [];
    const warnLogs: Array<{ msg?: string; obj?: object }> = [];
    const logger = {
      info(obj: object, msg?: string) {
        infoLogs.push({ obj, msg });
      },
      warn(obj: object, msg?: string) {
        warnLogs.push({ obj, msg });
      },
    };
    const eventId = machineTokenRotationEventId(w.a.machineId);
    let stream2: Awaited<ReturnType<typeof openMachineStream>> | null = null;
    try {
      await waitFor(() => stream1.getConnectionId() !== '');
      const sched = createScheduler(
        {
          db: w.s.db,
          hub: w.s.hub,
          user: w.s.user,
          machineHub: w.s.machineHub,
          convHub: w.s.convHub,
          reposDir: w.s.reposDir,
          attachmentsDir: w.s.attachmentsDir,
        },
        { tickMs: 3_600_000, clock: controlled.clock, tokenRotationTimeoutMs: 120, logger },
      );
      try {
        w.s.db
          .update(dueEventTable)
          .set({ dueAt: controlled.now(), intervalMs: null, attempts: 0 })
          .where(eq(dueEventTable.id, eventId))
          .run();
        sched.start();
        await waitFor(() => stream1.events.some((ev) => ev.type === 'token.rotate'));

        const reconnectStart = Date.now();
        stream2 = await openMachineStream(w.s.app, w.a.token);
        await waitFor(() => (stream2?.getConnectionId() ?? '') !== '');
        await new Promise((r) => setTimeout(r, 160));
        expect(stream2.events).toBeDefined();

        const afterReplaceDue = w.s.db
          .select()
          .from(dueEventTable)
          .where(eq(dueEventTable.id, eventId))
          .get();
        expect(afterReplaceDue).toBeDefined();
        expect(afterReplaceDue!.intervalMs).toBe(MACHINE_TOKEN_ROTATION_RETRY_MS);
        expect(afterReplaceDue!.dueAt).toBeGreaterThanOrEqual(reconnectStart);
        expect(afterReplaceDue!.dueAt).toBeLessThanOrEqual(
          Date.now() + MACHINE_TOKEN_ROTATION_CONNECT_GRACE_MS + 1000,
        );
      } finally {
        sched.stop();
        stream2?.abort();
        stream1.abort();
      }

      const streamRestart = await openMachineStream(w.s.app, w.a.token);
      const restartedServer = bootServer({ db: w.s.db, machineHub: w.s.machineHub });
      const restartClock = createControlledClock(Date.now());
      const restartSched = createScheduler(
        {
          db: restartedServer.db,
          hub: restartedServer.hub,
          user: restartedServer.user,
          machineHub: restartedServer.machineHub,
          convHub: restartedServer.convHub,
          reposDir: restartedServer.reposDir,
          attachmentsDir: restartedServer.attachmentsDir,
        },
        { tickMs: 3_600_000, clock: restartClock.clock, tokenRotationTimeoutMs: 500, logger },
      );
      try {
        await waitFor(() => streamRestart.getConnectionId() !== '');
        w.s.db
          .update(dueEventTable)
          .set({ dueAt: restartClock.now() })
          .where(eq(dueEventTable.id, eventId))
          .run();
        restartSched.start();
        await waitFor(() => streamRestart.events.some((ev) => ev.type === 'token.rotate'));
        const ev = streamRestart.events.find((e) => e.type === 'token.rotate') as {
          rotationId: string;
        };
        const claimRes = await call(
          restartedServer.app,
          'POST',
          '/api/machine/token-rotate/claim',
          {
            cred: w.a.token,
            body: {
              rotationId: ev.rotationId,
              connectionId: streamRestart.getConnectionId(),
              hostKey: HOST_KEY_A,
            },
          },
        );
        expect(claimRes.status).toBe(200);
        const { token: freshToken } = (await claimRes.json()) as { token: string };
        const ackRes = await call(restartedServer.app, 'POST', '/api/machine/token-rotate/ack', {
          cred: freshToken,
          body: { rotationId: ev.rotationId },
        });
        expect(ackRes.status).toBe(200);
        await waitFor(() => {
          const row = restartedServer.db
            .select()
            .from(dueEventTable)
            .where(eq(dueEventTable.id, eventId))
            .get();
          return (
            row !== undefined && row.intervalMs === null && row.dueAt > restartClock.now() + 1000
          );
        });
        w.a.token = freshToken;
      } finally {
        restartSched.stop();
        streamRestart.abort();
        restartedServer.dispose();
      }

      const streamFail = await openMachineStream(w.s.app, w.a.token);
      const origPush = w.s.machineHub.pushTokenRotate.bind(w.s.machineHub);
      const origConnId = w.s.machineHub.connectionId.bind(w.s.machineHub);
      const diagClock = createControlledClock(Date.now());
      const diagSched = createScheduler(
        {
          db: w.s.db,
          hub: w.s.hub,
          user: w.s.user,
          machineHub: w.s.machineHub,
          convHub: w.s.convHub,
          reposDir: w.s.reposDir,
          attachmentsDir: w.s.attachmentsDir,
        },
        { tickMs: 3_600_000, clock: diagClock.clock, tokenRotationTimeoutMs: 120, logger },
      );
      try {
        await waitFor(() => streamFail.getConnectionId() !== '');
        w.s.machineHub.pushTokenRotate = () => false;
        w.s.db
          .update(dueEventTable)
          .set({ dueAt: diagClock.now(), intervalMs: null, attempts: 0 })
          .where(eq(dueEventTable.id, eventId))
          .run();
        const infoBeforePushFail = infoLogs.length;
        diagSched.start();
        await waitFor(() => {
          const row = w.s.db
            .select()
            .from(dueEventTable)
            .where(eq(dueEventTable.id, eventId))
            .get();
          return (
            infoLogs.length > infoBeforePushFail &&
            row?.intervalMs === MACHINE_TOKEN_ROTATION_RETRY_MS
          );
        });
        const afterPushFail = w.s.db
          .select()
          .from(dueEventTable)
          .where(eq(dueEventTable.id, eventId))
          .get();
        expect(afterPushFail?.intervalMs).toBe(MACHINE_TOKEN_ROTATION_RETRY_MS);
        expect(machineRowOf(w.s, w.a.machineId)?.tokenReauthRequired).toBe(false);
        expect(
          (await call(w.s.app, 'POST', '/api/machine/tasks/claim', { cred: w.a.token, body: {} }))
            .status,
        ).toBe(200);

        diagSched.stop();
        w.s.machineHub.pushTokenRotate = origPush;
        w.s.machineHub.connectionId = () => {
          throw new Error('push-boom');
        };
        w.s.db
          .update(dueEventTable)
          .set({ dueAt: diagClock.now(), intervalMs: null, attempts: 0 })
          .where(eq(dueEventTable.id, eventId))
          .run();
        const throwSched = createScheduler(
          {
            db: w.s.db,
            hub: w.s.hub,
            user: w.s.user,
            machineHub: w.s.machineHub,
            convHub: w.s.convHub,
            reposDir: w.s.reposDir,
            attachmentsDir: w.s.attachmentsDir,
          },
          { tickMs: 3_600_000, clock: diagClock.clock, tokenRotationTimeoutMs: 120, logger },
        );
        try {
          throwSched.start();
          await waitFor(() => {
            const row = w.s.db
              .select()
              .from(dueEventTable)
              .where(eq(dueEventTable.id, eventId))
              .get();
            return warnLogs.length > 0 && row?.intervalMs === MACHINE_TOKEN_ROTATION_RETRY_MS;
          });
          expect(JSON.stringify(warnLogs)).toContain('push-boom');
          expect(JSON.stringify(warnLogs)).not.toContain(w.a.token);
          const afterThrow = w.s.db
            .select()
            .from(dueEventTable)
            .where(eq(dueEventTable.id, eventId))
            .get();
          expect(afterThrow?.intervalMs).toBe(MACHINE_TOKEN_ROTATION_RETRY_MS);
          expect(afterThrow?.attempts).toBe(0);
        } finally {
          throwSched.stop();
        }
      } finally {
        w.s.machineHub.pushTokenRotate = origPush;
        w.s.machineHub.connectionId = origConnId;
        diagSched.stop();
        streamFail.abort();
      }

      const delConnectAt = Date.now();
      const streamDel = await openMachineStream(w.s.app, w.a.token);
      const clockDel = createControlledClock(Date.now());
      const runnerDel = createDueRunner(w.s.db, clockDel.clock, {
        [MACHINE_TOKEN_ROTATION_EVENT_KIND]: async (event, now) => {
          return processMachineTokenRotationDue(
            { db: w.s.db, hub: w.s.hub, machineHub: w.s.machineHub },
            event,
            now,
            { timeoutMs: 150 },
          );
        },
      });
      try {
        await waitFor(() => {
          const armed = w.s.db
            .select()
            .from(dueEventTable)
            .where(eq(dueEventTable.id, eventId))
            .get();
          return (
            streamDel.getConnectionId() !== '' &&
            armed !== undefined &&
            armed.dueAt <= delConnectAt + MACHINE_TOKEN_ROTATION_CONNECT_GRACE_MS + 1000 &&
            armed.intervalMs === MACHINE_TOKEN_ROTATION_RETRY_MS &&
            armed.attempts === 0
          );
        });
        w.s.db
          .update(dueEventTable)
          .set({ dueAt: 0, intervalMs: null, attempts: 0 })
          .where(eq(dueEventTable.id, eventId))
          .run();
        runnerDel.arm();
        await waitFor(() => streamDel.events.some((e) => e.type === 'token.rotate'));
        const delRes = await call(w.s.app, 'DELETE', `/api/machines/${w.a.machineId}`);
        expect(delRes.status).toBe(204);
        await new Promise((r) => setTimeout(r, 200));
        expect(
          w.s.db.select().from(dueEventTable).where(eq(dueEventTable.id, eventId)).get(),
        ).toBeUndefined();
      } finally {
        runnerDel.stop();
        streamDel.abort();
      }
    } finally {
      w.s.dispose();
    }
  });
});
