import { hostname } from 'node:os';
import type { ClaimedStep } from '@cairn/shared';
import {
  claimedStepSchema,
  machineEnrollResponseSchema,
  machineOkResponseSchema,
  machineUploadUrlsResponseSchema,
  PLAN_FILE_NAME,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  machine as machineTable,
  project as projectTable,
  routingRule as routingRuleTable,
  step as stepTable,
} from '../src/db/schema.js';
import { seedLocalMachine } from '../src/services/machines.js';
import { stepQueueProjector } from '../src/services/step-queue.js';
import {
  bootServer,
  insertClaudeSubscription,
  issueApiKey,
  postProject,
  req,
  seedSessionRoute,
  startLegacyBuild,
  type TestServer,
  withVerification,
} from './helpers.js';

const HOST_KEY_A = 'a'.repeat(64);
const HOST_KEY_B = 'b'.repeat(64);

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

interface Enrolled {
  machineId: string;
  token: string;
}

async function enroll(
  s: TestServer,
  key: string,
  name: string,
  hostKey?: string,
): Promise<Enrolled> {
  const res = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
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

/** The desktop path: enroll/start names the host, the owner approves, the host
 * gets a machine.json. Nothing here carries an api key, so only the hostKey can
 * tie this enrollment to the machine the host already had. */
async function enrollThroughOwner(s: TestServer, name: string, hostKey: string): Promise<Enrolled> {
  const start = await call(s.app, 'POST', '/api/machine/enroll/start', {
    body: { name, hostKey },
  });
  expect(start.status).toBe(200);
  const { enrollId } = (await start.json()) as { enrollId: string };
  const confirmed = await call(s.app, 'POST', '/api/machine/enroll/confirm', {
    body: { enrollId },
  });
  expect(confirmed.status).toBe(200);
  const { machine } = (await confirmed.json()) as { machine: Enrolled };
  return machine;
}

async function claim(app: Hono, token: string): Promise<ClaimedStep | null> {
  const res = await call(app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
  const body = (await res.json()) as { step: ClaimedStep | null };
  if (!res.ok) throw new Error(`claim answered ${res.status}`);
  return body.step === null ? null : claimedStepSchema.parse(body.step);
}

async function finishPlan(s: TestServer, token: string, stepId: string, sessionId: string) {
  const urlsRes = await call(s.app, 'POST', `/api/machine/upload-urls/${stepId}`, {
    cred: token,
    body: { files: [{ name: PLAN_FILE_NAME }] },
  });
  expect(urlsRes.status).toBe(200);
  const upload = machineUploadUrlsResponseSchema.parse(await urlsRes.json()).uploads[0]!;
  const planPut = await s.app.request(upload.url.replace(/^https?:\/\/[^/]+/, ''), {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'text/markdown' },
    body: withVerification('# plan\nContext: host identity\n'),
  });
  expect(machineOkResponseSchema.parse(await planPut.json())).toEqual({ ok: true });
  const doneRes = await call(s.app, 'POST', `/api/machine/done/${stepId}`, {
    cred: token,
    body: { status: 'success', sessionId, hasChanges: false },
  });
  expect(doneRes.status).toBe(200);
}

function machineRow(s: TestServer, machineId: string) {
  return s.db.select().from(machineTable).where(eq(machineTable.id, machineId)).get();
}

function machineRows(s: TestServer) {
  return s.db.select().from(machineTable).where(eq(machineTable.teamId, s.team.id)).all();
}

/** A plan step finishes on A and hands the build step a session, so the next
 * step is pinned to A by resume affinity — the pin a restarting host must keep. */
async function planThenPinToA(
  s: TestServer,
  tokenA: string,
): Promise<{ projectId: string; buildId: string }> {
  const projectId = await postProject(s.app, 'host-identity');
  const todoRes = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: '',
    spec: 'probe the pin',
  });
  expect(todoRes.status).toBe(201);
  const todoId = ((await todoRes.json()) as { id: string }).id;
  const buildId = startLegacyBuild(s, todoId, { withPlan: true });
  const plan = await claim(s.app, tokenA);
  expect(plan?.step.kind).toBe('plan');
  await finishPlan(s, tokenA, plan!.step.id, 'sess-host-a');
  const confirm = await req(s.app, 'POST', `/api/builds/${buildId}/steps`, { action: 'confirm' });
  expect(confirm.status).toBe(202);
  return { projectId, buildId };
}

function pendingStepKinds(s: TestServer): string[] {
  return s.db
    .select()
    .from(stepTable)
    .where(eq(stepTable.status, 'pending'))
    .all()
    .map((row) => row.kind);
}

async function world(opts: { routeMachineId?: boolean } = {}) {
  const s = bootServer({ claimHoldMs: 200 });
  insertClaudeSubscription(s);
  const keyA = await issueApiKey(s);
  const keyB = await issueApiKey(s);
  const a = await enroll(s, keyA, 'host-a', HOST_KEY_A);
  const b = await enroll(s, keyB, 'host-b', HOST_KEY_B);
  s.db.update(machineTable).set({ online: true }).where(eq(machineTable.teamId, s.team.id)).run();
  seedSessionRoute(s, {
    provider: 'stub-gw',
    modelId: 'stub-model',
    machineId: opts.routeMachineId === false ? null : a.machineId,
  });
  return { s, keyA, keyB, a, b };
}

describe('a host that re-registers keeps its machine identity', () => {
  test('the same hostKey inherits the machine row, and the step pinned to it is claimable', async () => {
    const w = await world();
    try {
      await planThenPinToA(w.s, w.a.token);
      expect(pendingStepKinds(w.s)).toEqual(['build']);
      expect(await claim(w.s.app, w.b.token)).toBeNull();

      const restart = await enrollThroughOwner(w.s, 'host-a', HOST_KEY_A);
      expect(restart.machineId).toBe(w.a.machineId);
      expect(restart.token).not.toBe(w.a.token);
      expect(machineRows(w.s)).toHaveLength(2);

      const got = await claim(w.s.app, restart.token);
      expect(got).not.toBeNull();
      expect(got!.step.machineId).toBe(w.a.machineId);
      expect(got!.step.kind).toBe('build');
    } finally {
      w.s.dispose();
    }
  });

  test('another host gets its own machine and cannot claim the first host work', async () => {
    const w = await world();
    try {
      await planThenPinToA(w.s, w.a.token);
      const stranger = await enrollThroughOwner(w.s, 'host-b', HOST_KEY_B);
      expect(stranger.machineId).toBe(w.b.machineId);
      expect(machineRows(w.s)).toHaveLength(2);
      expect(await claim(w.s.app, stranger.token)).toBeNull();
      expect(
        w.s.db.select().from(machineTable).where(eq(machineTable.id, w.a.machineId)).get()?.hostKey,
      ).toBe(HOST_KEY_A);
    } finally {
      w.s.dispose();
    }
  });

  test('presence backfills an empty hostKey on its own row and never steals one', async () => {
    const w = await world();
    try {
      const legacy = await enroll(w.s, await issueApiKey(w.s), 'host-c');
      expect(machineRow(w.s, legacy.machineId)?.hostKey).toBeNull();

      const backfill = await call(w.s.app, 'POST', '/api/machine/presence', {
        cred: legacy.token,
        body: { hostKey: HOST_KEY_A },
      });
      expect(backfill.status).toBe(200);
      expect(machineRow(w.s, legacy.machineId)?.hostKey).toBeNull();

      const own = await call(w.s.app, 'POST', '/api/machine/presence', {
        cred: legacy.token,
        body: { hostKey: 'c'.repeat(64) },
      });
      expect(own.status).toBe(200);
      expect(machineRow(w.s, legacy.machineId)?.hostKey).toBe('c'.repeat(64));
    } finally {
      w.s.dispose();
    }
  });

  test('a host that lost machine.json re-enrolls into the same row through its backfilled hostKey', async () => {
    const w = await world();
    try {
      const legacy = await enroll(w.s, await issueApiKey(w.s), 'host-d');
      await call(w.s.app, 'POST', '/api/machine/presence', {
        cred: legacy.token,
        body: { hostKey: 'd'.repeat(64) },
      });
      const again = await enrollThroughOwner(w.s, 'host-d', 'd'.repeat(64));
      expect(again.machineId).toBe(legacy.machineId);
    } finally {
      w.s.dispose();
    }
  });
});

describe('adoption guards', () => {
  test('an api key cannot adopt a local row through hostKey under any name', async () => {
    const w = await world();
    try {
      seedLocalMachine(w.s.db, w.s.team.id);
      const local = machineRows(w.s).find((m) => m.kind === 'local')!;
      w.s.db
        .update(machineTable)
        .set({ hostKey: 'e'.repeat(64) })
        .where(eq(machineTable.id, local.id))
        .run();

      const res = await call(w.s.app, 'POST', '/api/machine/enroll', {
        cred: w.keyA,
        body: readyMachine({
          teamId: w.s.team.id,
          name: 'definitely-not-local',
          hostKey: 'e'.repeat(64),
        }),
      });
      expect(res.status).toBe(403);
      expect(machineRow(w.s, local.id)?.apiKeyId).toBeNull();
    } finally {
      w.s.dispose();
    }
  });

  test('the api-key path refuses the server hostname outright: the name is not a credential', async () => {
    const w = await world();
    try {
      const res = await call(w.s.app, 'POST', '/api/machine/enroll', {
        cred: w.keyA,
        body: readyMachine({
          teamId: w.s.team.id,
          name: hostname(),
          hostKey: HOST_KEY_A,
        }),
      });
      expect(res.status).toBe(403);
      expect(machineRow(w.s, w.a.machineId)?.kind).toBe('remote');
      expect(machineRow(w.s, w.a.machineId)?.name).toBe('host-a');
    } finally {
      w.s.dispose();
    }
  });

  test('a browser-confirm adoption clears a previously bound apiKeyId', async () => {
    const w = await world();
    try {
      expect(machineRow(w.s, w.a.machineId)?.apiKeyId).not.toBeNull();
      const restart = await enrollThroughOwner(w.s, 'host-a', HOST_KEY_A);
      expect(restart.machineId).toBe(w.a.machineId);
      expect(machineRow(w.s, w.a.machineId)?.apiKeyId).toBeNull();
    } finally {
      w.s.dispose();
    }
  });
});

describe('a machine that can never return stops pinning work', () => {
  test('revoking the pinned machine releases the resume affinity: the other machine claims', async () => {
    const w = await world();
    try {
      await planThenPinToA(w.s, w.a.token);
      expect(await claim(w.s.app, w.b.token)).toBeNull();

      const revoke = await call(w.s.app, 'POST', `/api/machines/${w.a.machineId}/revoke`);
      expect(revoke.status).toBe(204);

      const got = await claim(w.s.app, w.b.token);
      expect(got).not.toBeNull();
      expect(got!.step.kind).toBe('build');
      expect(got!.step.machineId).toBe(w.b.machineId);
      expect(got!.session.priorMachineId).toBe(w.a.machineId);
    } finally {
      w.s.dispose();
    }
  });

  test('deleting the pinned machine leaves no machine id that blocks a claim', async () => {
    const w = await world();
    try {
      await planThenPinToA(w.s, w.a.token);
      const del = await call(w.s.app, 'DELETE', `/api/machines/${w.a.machineId}`);
      expect(del.status).toBe(204);

      const got = await claim(w.s.app, w.b.token);
      expect(got).not.toBeNull();
      expect(got!.step.kind).toBe('build');
      expect(got!.step.machineId).toBe(w.b.machineId);
    } finally {
      w.s.dispose();
    }
  });

  test('a retired home machine is named in the queue of a local task, and skipped for a hosted one', async () => {
    const w = await world();
    try {
      const localProject = await postProject(w.s.app, 'local-repo');
      w.s.db
        .update(projectTable)
        .set({ repoKind: 'local', githubRepo: null, autonomy: { localChecks: [] } })
        .where(eq(projectTable.id, localProject))
        .run();
      const hostedProject = await postProject(w.s.app, 'hosted-repo');
      const localStep = await pendingBuildStep(w.s, localProject);
      const hostedStep = await pendingBuildStep(w.s, hostedProject);

      const revoke = await call(w.s.app, 'POST', `/api/machines/${w.a.machineId}/revoke`);
      expect(revoke.status).toBe(204);

      const projector = stepQueueProjector(w.s.db, w.s.team.id);
      const local = projector.project({
        id: localStep.id,
        createdAt: localStep.createdAt,
        homeMachineId: w.a.machineId,
        holdReason: null,
        holdUntil: null,
      });
      expect(local?.blocked?.kind).toBe('machine-retired');
      expect(local?.waitingFor?.name).toBe('host-a');

      const hosted = projector.project({
        id: hostedStep.id,
        createdAt: hostedStep.createdAt,
        homeMachineId: w.a.machineId,
        holdReason: null,
        holdUntil: null,
      });
      expect(hosted?.blocked?.kind).not.toBe('machine-retired');
      expect(hosted?.waitingFor?.name).not.toBe('host-a');
    } finally {
      w.s.dispose();
    }
  });
});

async function pendingBuildStep(
  s: TestServer,
  projectId: string,
): Promise<{ id: string; createdAt: number }> {
  const todoRes = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: '',
    spec: 'probe the queue',
  });
  expect(todoRes.status).toBe(201);
  const todoId = ((await todoRes.json()) as { id: string }).id;
  const buildId = startLegacyBuild(s, todoId, { withPlan: false });
  const row = s.db
    .select()
    .from(stepTable)
    .where(eq(stepTable.buildId, buildId))
    .all()
    .find((candidate) => candidate.status === 'pending');
  if (row === undefined) throw new Error(`no pending step in build ${buildId}`);
  return { id: row.id, createdAt: row.createdAt };
}

describe('queue reason wiring', () => {
  test('the home machine pin still applies to the routing rule it came from', async () => {
    const w = await world();
    try {
      const rule = w.s.db
        .select()
        .from(routingRuleTable)
        .where(eq(routingRuleTable.use, 'session'))
        .get();
      expect(rule?.machineId).toBe(w.a.machineId);
    } finally {
      w.s.dispose();
    }
  });
});
