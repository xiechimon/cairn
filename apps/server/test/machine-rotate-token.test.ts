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
