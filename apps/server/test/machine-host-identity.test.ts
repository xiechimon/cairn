import { hostname } from 'node:os';
import type { ClaimedStep } from '@cairn/shared';
import {
  claimedStepSchema,
  machineEnrollResponseSchema,
  machineOkResponseSchema,
  machineUploadUrlsResponseSchema,
  PLAN_FILE_NAME,
} from '@cairn/shared';
import { type HostIdentitySources, probeHostIdentity } from '@cairn/shared/host-identity';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  computer as computerTable,
  machine as machineTable,
  pairedDevice as pairedDeviceTable,
  phone as phoneTable,
  project as projectTable,
  routingRule as routingRuleTable,
  step as stepTable,
  team as teamTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { issueBrowserSession } from '../src/services/browser-session.js';
import { seedLocalMachine } from '../src/services/machines.js';
import { stepQueueProjector } from '../src/services/step-queue.js';
import {
  bootServer,
  claimedGeneration,
  insertClaudeSubscription,
  insertMachine,
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
  opts: { cred?: string; body?: unknown; peer?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(
      path,
      {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      },
      opts.peer === undefined ? undefined : { incoming: { socket: { remoteAddress: opts.peer } } },
    ),
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
async function enrollThroughOwner(
  s: TestServer,
  name: string,
  hostKey?: string,
  opts: {
    peer?: string;
    legacyHostKeys?: readonly string[];
    retireToken?: string;
  } = {},
): Promise<Enrolled> {
  const start = await call(s.app, 'POST', '/api/machine/enroll/start', {
    body: {
      name,
      ...(hostKey !== undefined ? { hostKey } : {}),
      ...(opts.legacyHostKeys !== undefined && opts.legacyHostKeys.length > 0
        ? { legacyHostKeys: [...opts.legacyHostKeys] }
        : {}),
    },
    ...(opts.peer !== undefined ? { peer: opts.peer } : {}),
  });
  expect(start.status).toBe(200);
  const { enrollId } = (await start.json()) as { enrollId: string };
  const confirmed = await call(s.app, 'POST', '/api/machine/enroll/confirm', {
    body: {
      enrollId,
      ...(opts.retireToken !== undefined ? { retireToken: opts.retireToken } : {}),
    },
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
    body: {
      status: 'success',
      sessionId,
      hasChanges: false,
      generation: claimedGeneration(s.db, stepId),
    },
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

describe('the server host name is not an enrollment credential', () => {
  const HOST_KEY_LOCAL = 'f'.repeat(64);

  async function enrollLocal(
    s: TestServer,
    hostKey: string,
  ): Promise<{ machineId: string; token: string }> {
    const enrolled = await enrollThroughOwner(s, hostname(), hostKey, { peer: '127.0.0.1' });
    expect(machineRow(s, enrolled.machineId)?.kind).toBe('local');
    return enrolled;
  }

  test('an anonymous enrollment named like the server host cannot re-key the local runner', async () => {
    const w = await world();
    try {
      seedLocalMachine(w.s.db, w.s.team.id);
      const local = await enrollLocal(w.s, HOST_KEY_LOCAL);
      const tokenHashBefore = machineRow(w.s, local.machineId)?.tokenHash;
      expect(tokenHashBefore).not.toBeNull();

      const start = await call(w.s.app, 'POST', '/api/machine/enroll/start', {
        body: { name: hostname() },
      });
      const enrollId =
        start.status === 200 ? ((await start.json()) as { enrollId: string }).enrollId : undefined;
      if (enrollId !== undefined) {
        await call(w.s.app, 'POST', '/api/machine/enroll/confirm', { body: { enrollId } });
      }
      expect(start.status).toBe(409);
      expect(machineRow(w.s, local.machineId)?.tokenHash).toBe(tokenHashBefore);
      expect((await call(w.s.app, 'GET', '/api/machine/me', { cred: local.token })).status).toBe(
        200,
      );
    } finally {
      w.s.dispose();
    }
  });

  test('a remote enrollment carrying the local runner host key is refused at start', async () => {
    const w = await world();
    try {
      seedLocalMachine(w.s.db, w.s.team.id);
      const local = await enrollLocal(w.s, HOST_KEY_LOCAL);
      const tokenHashBefore = machineRow(w.s, local.machineId)?.tokenHash;

      const start = await call(w.s.app, 'POST', '/api/machine/enroll/start', {
        body: { name: 'not-the-host', hostKey: HOST_KEY_LOCAL },
      });
      expect(start.status).toBe(409);
      expect(machineRow(w.s, local.machineId)?.tokenHash).toBe(tokenHashBefore);
    } finally {
      w.s.dispose();
    }
  });

  test('a loopback enrollment named like the host cannot re-key a local row whose host key it lacks', async () => {
    const w = await world();
    try {
      seedLocalMachine(w.s.db, w.s.team.id);
      const local = await enrollLocal(w.s, HOST_KEY_LOCAL);
      const tokenHashBefore = machineRow(w.s, local.machineId)?.tokenHash;

      const start = await call(w.s.app, 'POST', '/api/machine/enroll/start', {
        body: { name: hostname(), hostKey: HOST_KEY_A },
        peer: '127.0.0.1',
      });
      expect(start.status).toBe(409);
      expect(machineRow(w.s, local.machineId)?.tokenHash).toBe(tokenHashBefore);
      expect((await call(w.s.app, 'GET', '/api/machine/me', { cred: local.token })).status).toBe(
        200,
      );
    } finally {
      w.s.dispose();
    }
  });

  test('an enrollment opened before the local row was keyed cannot claim it afterwards', async () => {
    const w = await world();
    try {
      seedLocalMachine(w.s.db, w.s.team.id);
      const early = await call(w.s.app, 'POST', '/api/machine/enroll/start', {
        body: { name: hostname() },
        peer: '127.0.0.1',
      });
      expect(early.status).toBe(200);
      const { enrollId } = (await early.json()) as { enrollId: string };

      const local = await enrollLocal(w.s, HOST_KEY_LOCAL);
      const tokenHashBefore = machineRow(w.s, local.machineId)?.tokenHash;

      const confirmed = await call(w.s.app, 'POST', '/api/machine/enroll/confirm', {
        body: { enrollId },
      });
      expect(confirmed.status).toBe(403);
      expect(machineRow(w.s, local.machineId)?.tokenHash).toBe(tokenHashBefore);
    } finally {
      w.s.dispose();
    }
  });

  test('a loopback claim carrying the local host key cannot rename the local row', async () => {
    const w = await world();
    try {
      seedLocalMachine(w.s.db, w.s.team.id);
      const local = await enrollLocal(w.s, HOST_KEY_LOCAL);
      const again = await enrollThroughOwner(w.s, 'renamed-host', HOST_KEY_LOCAL, {
        peer: '127.0.0.1',
      });
      expect(again.machineId).toBe(local.machineId);
      expect(machineRow(w.s, local.machineId)?.name).toBe(hostname());
      expect(machineRows(w.s).filter((m) => m.kind === 'local')).toHaveLength(1);
    } finally {
      w.s.dispose();
    }
  });

  test('the local runner still re-keys its own row through loopback plus its host key', async () => {
    const w = await world();
    try {
      seedLocalMachine(w.s.db, w.s.team.id);
      const first = await enrollLocal(w.s, HOST_KEY_LOCAL);
      const again = await enrollLocal(w.s, HOST_KEY_LOCAL);
      expect(again.machineId).toBe(first.machineId);
      expect(again.token).not.toBe(first.token);
      expect((await call(w.s.app, 'GET', '/api/machine/me', { cred: again.token })).status).toBe(
        200,
      );
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

describe('one computer keeps one identity across runner homes and X.local / X names', () => {
  function macSources(uuid: string): HostIdentitySources {
    return {
      platform: 'darwin',
      readFile: () => null,
      run: () => `"IOPlatformUUID" = "${uuid}"`,
    };
  }

  function alternateLocalName(host: string): string {
    return host.toLowerCase().endsWith('.local')
      ? host.slice(0, -'.local'.length)
      : `${host}.local`;
  }

  test('desktop runner and browser enrollment on the same computer with different homes and X.local / X names keep one row', async () => {
    const s = bootServer({ claimHoldMs: 200 });
    insertClaudeSubscription(s);
    try {
      seedLocalMachine(s.db, s.team.id);
      const sources = macSources('11111111-2222-3333-4444-555555555555');
      const desktopIdentity = probeHostIdentity(
        '/Users/owner/Library/Application Support/Cairn/runner',
        sources,
      )!;
      const cliIdentity = probeHostIdentity('/Users/owner/.cairn', sources)!;
      expect(desktopIdentity.hostKey).toBe(cliIdentity.hostKey);
      expect(desktopIdentity.legacyHostKey).not.toBe(cliIdentity.legacyHostKey);

      const desktop = await enrollThroughOwner(s, hostname(), desktopIdentity.hostKey, {
        peer: '127.0.0.1',
      });
      const browser = await enrollThroughOwner(
        s,
        alternateLocalName(hostname()),
        cliIdentity.hostKey,
        { peer: '127.0.0.1' },
      );

      expect(browser.machineId).toBe(desktop.machineId);
      expect(machineRows(s)).toHaveLength(1);
      expect(machineRow(s, desktop.machineId)?.kind).toBe('local');
      expect(machineRow(s, desktop.machineId)?.name).toBe(hostname());
    } finally {
      s.dispose();
    }
  });

  test('a remote Mac registered as X.local and X from two runner homes keeps one row', async () => {
    const s = bootServer({ claimHoldMs: 200 });
    insertClaudeSubscription(s);
    try {
      const sources = macSources('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
      const firstId = probeHostIdentity(
        '/Users/owner/Library/Application Support/Cairn/runner',
        sources,
      )!;
      const secondId = probeHostIdentity('/Users/owner/.cairn', sources)!;

      const first = await enrollThroughOwner(s, 'studio-mac.local', firstId.hostKey);
      const second = await enrollThroughOwner(s, 'studio-mac', secondId.hostKey);

      expect(second.machineId).toBe(first.machineId);
      expect(machineRows(s)).toHaveLength(1);
    } finally {
      s.dispose();
    }
  });

  test('browser enrollment as X before desktop runner as X.local promotes into one local row', async () => {
    const s = bootServer({ claimHoldMs: 200 });
    insertClaudeSubscription(s);
    try {
      seedLocalMachine(s.db, s.team.id);
      const sources = macSources('22222222-3333-4444-5555-666666666666');
      const cliIdentity = probeHostIdentity('/Users/owner/.cairn', sources)!;
      const desktopIdentity = probeHostIdentity(
        '/Users/owner/Library/Application Support/Cairn/runner-home',
        sources,
      )!;

      const browser = await enrollThroughOwner(
        s,
        alternateLocalName(hostname()),
        cliIdentity.hostKey,
        { peer: '127.0.0.1' },
      );
      expect(machineRows(s)).toHaveLength(2);

      const desktop = await enrollThroughOwner(s, hostname(), desktopIdentity.hostKey, {
        peer: '127.0.0.1',
      });

      expect(desktop.machineId).toBe(browser.machineId);
      expect(machineRows(s)).toHaveLength(1);
      expect(machineRow(s, desktop.machineId)?.kind).toBe('local');
      expect(machineRow(s, desktop.machineId)?.name).toBe(hostname());
    } finally {
      s.dispose();
    }
  });

  test('retiring a pre-fix v1 duplicate on credential proof migrates step.machineId and all references without copying apiKeyId', async () => {
    const s = bootServer({ claimHoldMs: 200 });
    insertClaudeSubscription(s);
    try {
      const sources = macSources('33333333-4444-5555-6666-777777777777');
      const desktopIdentity = probeHostIdentity(
        '/Users/owner/Library/Application Support/Cairn/runner',
        sources,
      )!;
      const cliIdentity = probeHostIdentity('/Users/owner/.cairn', sources)!;

      const oldKey = await issueApiKey(s);
      const dup = await enroll(s, oldKey, 'studio-mac', cliIdentity.legacyHostKey);
      s.db
        .update(machineTable)
        .set({ online: true })
        .where(eq(machineTable.id, dup.machineId))
        .run();
      seedSessionRoute(s, {
        provider: 'stub-gw',
        modelId: 'stub-model',
        machineId: dup.machineId,
      });
      await planThenPinToA(s, dup.token);
      expect(pendingStepKinds(s)).toEqual(['build']);
      s.db
        .update(machineTable)
        .set({ online: false })
        .where(eq(machineTable.id, dup.machineId))
        .run();

      const survivor = await enrollThroughOwner(
        s,
        'studio-mac.local',
        desktopIdentity.legacyHostKey,
      );
      s.db
        .update(teamTable)
        .set({ defaultMachineId: dup.machineId })
        .where(eq(teamTable.id, s.team.id))
        .run();
      const projectId = await postProject(s.app, 'dup-merge');
      const todoRes = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
        title: '',
        spec: 'pin the stale row',
      });
      expect(todoRes.status).toBe(201);
      const todoId = ((await todoRes.json()) as { id: string }).id;
      s.db
        .update(todoTable)
        .set({ routeOverride: { machineId: dup.machineId } })
        .where(eq(todoTable.id, todoId))
        .run();
      s.db
        .insert(phoneTable)
        .values({
          id: 'ph-1',
          teamId: s.team.id,
          machineId: dup.machineId,
          platform: 'android',
          deviceId: 'dev-1',
          name: 'Pixel 8a',
          createdAt: 1,
          updatedAt: 1,
        })
        .run();
      s.db
        .insert(computerTable)
        .values({
          id: 'comp-1',
          teamId: s.team.id,
          machineId: dup.machineId,
          scopeKey: 'scope-1',
          providerRef: 'vm-1',
          createdAt: 1,
          updatedAt: 1,
        })
        .run();

      const upgraded = await enrollThroughOwner(s, 'studio-mac.local', desktopIdentity.hostKey, {
        legacyHostKeys: [desktopIdentity.legacyHostKey, cliIdentity.legacyHostKey],
      });
      expect(upgraded.machineId).toBe(survivor.machineId);
      s.db
        .update(machineTable)
        .set({ online: true })
        .where(eq(machineTable.id, upgraded.machineId))
        .run();

      expect(machineRows(s)).toHaveLength(1);
      expect(machineRow(s, dup.machineId)).toBeUndefined();
      expect(machineRow(s, upgraded.machineId)?.hostKey).toBe(desktopIdentity.hostKey);
      expect(machineRow(s, upgraded.machineId)?.apiKeyId).toBeNull();
      expect(s.db.select().from(routingRuleTable).get()?.machineId).toBe(upgraded.machineId);
      expect(
        s.db.select().from(teamTable).where(eq(teamTable.id, s.team.id)).get()?.defaultMachineId,
      ).toBe(upgraded.machineId);
      expect(
        s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()?.routeOverride
          ?.machineId,
      ).toBe(upgraded.machineId);
      expect(s.db.select().from(phoneTable).get()?.machineId).toBe(upgraded.machineId);
      expect(s.db.select().from(computerTable).get()?.machineId).toBe(upgraded.machineId);

      const claimed = await claim(s.app, upgraded.token);
      expect(claimed).not.toBeNull();
      expect(claimed!.step.kind).toBe('build');
      expect(claimed!.step.machineId).toBe(upgraded.machineId);
      expect(claimed!.session.action).toBe('continue');
      expect(claimed!.session.sessionId).toBe('sess-host-a');
      expect(claimed!.session.priorMachineId).toBeUndefined();

      const oldKeyWithoutHostKey = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: oldKey,
        body: readyMachine({ teamId: s.team.id, name: 'hijack-no-key' }),
      });
      expect(oldKeyWithoutHostKey.status).toBe(200);
      const minted = machineEnrollResponseSchema.parse(await oldKeyWithoutHostKey.json());
      expect(minted.machineId).not.toBe(upgraded.machineId);
      expect((await call(s.app, 'GET', '/api/machine/me', { cred: upgraded.token })).status).toBe(
        200,
      );

      const oldKeyWithHostKey = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: oldKey,
        body: readyMachine({
          teamId: s.team.id,
          name: 'hijack-with-key',
          hostKey: desktopIdentity.hostKey,
        }),
      });
      expect(oldKeyWithHostKey.status).toBe(403);
    } finally {
      s.dispose();
    }
  });

  test('retiring an unkeyed offline duplicate succeeds only when its own machine token is presented', async () => {
    const s = bootServer({ claimHoldMs: 200 });
    insertClaudeSubscription(s);
    try {
      const legacyKey = await issueApiKey(s);
      const stale = await enroll(s, legacyKey, 'studio-mac');
      s.db
        .update(machineTable)
        .set({ online: true })
        .where(eq(machineTable.id, stale.machineId))
        .run();
      seedSessionRoute(s, {
        provider: 'stub-gw',
        modelId: 'stub-model',
        machineId: stale.machineId,
      });
      await planThenPinToA(s, stale.token);
      s.db
        .update(machineTable)
        .set({ online: false })
        .where(eq(machineTable.id, stale.machineId))
        .run();

      const survivor = await enrollThroughOwner(s, 'studio-mac.local', HOST_KEY_A, {
        retireToken: stale.token,
      });

      expect(machineRows(s)).toHaveLength(1);
      expect(machineRow(s, stale.machineId)).toBeUndefined();
      expect(machineRow(s, survivor.machineId)?.apiKeyId).toBeNull();
      s.db
        .update(machineTable)
        .set({ online: true })
        .where(eq(machineTable.id, survivor.machineId))
        .run();
      const claimed = await claim(s.app, survivor.token);
      expect(claimed?.step.kind).toBe('build');
      expect(claimed?.session.sessionId).toBe('sess-host-a');
      expect(claimed?.session.priorMachineId).toBeUndefined();
    } finally {
      s.dispose();
    }
  });

  test('spoofed self-reported hostname, computerName and hardware never merge an offline row', async () => {
    const s = bootServer({ claimHoldMs: 200 });
    insertClaudeSubscription(s);
    try {
      const hardware = {
        cpuCores: 12,
        memoryTotalMb: 32_768,
        memoryAvailableMb: 12_000,
        loadAvg1: 1.25,
        diskFreeMb: 200_000,
      };
      const victim = insertMachine(s, {
        name: 'studio-mac',
        capabilities: {
          hostname: 'studio-mac.local',
          computerName: 'Studio Mac',
          hardware,
          mcpServers: [],
          skills: [],
        },
      });
      s.db.update(machineTable).set({ online: false }).where(eq(machineTable.id, victim)).run();
      const attacker = await enrollThroughOwner(s, 'studio-mac.local', HOST_KEY_A);

      const res = await call(s.app, 'POST', '/api/machine/presence', {
        cred: attacker.token,
        body: {
          hostKey: HOST_KEY_A,
          claudeCode: { installed: true, hostname: 'studio-mac.local', models: [] },
          capabilities: {
            hostname: 'studio-mac.local',
            computerName: 'Studio Mac',
            hardware,
            mcpServers: [],
            skills: [],
          },
        },
      });
      expect(res.status).toBe(200);
      expect(machineRow(s, victim)).toBeDefined();
      expect(machineRows(s)).toHaveLength(2);
    } finally {
      s.dispose();
    }
  });

  test('an api-key machine cannot retire a browser-enrolled or another-key row and cannot overwrite its own hostKey without proving it', async () => {
    const s = bootServer({ claimHoldMs: 200 });
    insertClaudeSubscription(s);
    try {
      const browserRow = await enrollThroughOwner(s, 'studio-mac', HOST_KEY_B);
      s.db
        .update(machineTable)
        .set({ online: false })
        .where(eq(machineTable.id, browserRow.machineId))
        .run();
      const otherKey = await issueApiKey(s);
      const otherKeyRow = await enroll(s, otherKey, 'other-mac', 'c'.repeat(64));
      s.db
        .update(machineTable)
        .set({ online: false })
        .where(eq(machineTable.id, otherKeyRow.machineId))
        .run();

      const keyA = await issueApiKey(s);
      const apiRow = await enroll(s, keyA, 'studio-mac.local', HOST_KEY_A);
      const withLegacy = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: keyA,
        body: readyMachine({
          teamId: s.team.id,
          name: 'studio-mac.local',
          hostKey: HOST_KEY_A,
          legacyHostKeys: [HOST_KEY_B, 'c'.repeat(64)],
        }),
      });
      expect(withLegacy.status).toBe(200);
      expect(machineRow(s, browserRow.machineId)).toBeDefined();
      expect(machineRow(s, otherKeyRow.machineId)).toBeDefined();

      const overwriteAttempt = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: keyA,
        body: readyMachine({
          teamId: s.team.id,
          name: 'studio-mac.local',
          hostKey: 'd'.repeat(64),
        }),
      });
      expect(overwriteAttempt.status).toBe(200);
      expect(machineRow(s, apiRow.machineId)?.hostKey).toBe(HOST_KEY_A);
    } finally {
      s.dispose();
    }
  });

  test('online, local-kind, revoked, and active-step rows are never retired, and presence cannot mutate a non-null hostKey', async () => {
    const s = bootServer({ claimHoldMs: 200 });
    insertClaudeSubscription(s);
    try {
      seedLocalMachine(s.db, s.team.id);
      const local = await enrollThroughOwner(s, hostname(), 'c'.repeat(64), { peer: '127.0.0.1' });
      s.db
        .update(machineTable)
        .set({ online: false })
        .where(eq(machineTable.id, local.machineId))
        .run();

      const presenceMutate = await call(s.app, 'POST', '/api/machine/presence', {
        cred: local.token,
        body: { hostKey: 'f'.repeat(64) },
      });
      expect(presenceMutate.status).toBe(200);
      expect(machineRow(s, local.machineId)?.hostKey).toBe('c'.repeat(64));
      s.db
        .update(machineTable)
        .set({ online: false })
        .where(eq(machineTable.id, local.machineId))
        .run();

      const onlineRow = await enrollThroughOwner(s, 'online-dup', 'd'.repeat(64));
      s.db
        .update(machineTable)
        .set({ online: true })
        .where(eq(machineTable.id, onlineRow.machineId))
        .run();

      const revokedRow = await enrollThroughOwner(s, 'revoked-dup', 'e'.repeat(64));
      s.db
        .update(machineTable)
        .set({ online: false, tokenHash: null, retiredAt: Date.now() })
        .where(eq(machineTable.id, revokedRow.machineId))
        .run();

      const claimedKey = await issueApiKey(s);
      const activeStepRow = await enroll(s, claimedKey, 'busy-dup', '9'.repeat(64));
      s.db
        .update(machineTable)
        .set({ online: true })
        .where(eq(machineTable.id, activeStepRow.machineId))
        .run();
      seedSessionRoute(s, {
        provider: 'stub-gw',
        modelId: 'stub-model',
        machineId: activeStepRow.machineId,
      });
      const projectId = await postProject(s.app, 'active-step-guard');
      const todoRes = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
        title: '',
        spec: 'hold a claimed step',
      });
      const todoId = ((await todoRes.json()) as { id: string }).id;
      startLegacyBuild(s, todoId, { withPlan: true });
      const claimed = await claim(s.app, activeStepRow.token);
      expect(claimed?.step.kind).toBe('plan');
      s.db
        .update(machineTable)
        .set({ online: false })
        .where(eq(machineTable.id, activeStepRow.machineId))
        .run();

      await enrollThroughOwner(s, 'remote-box', HOST_KEY_A, {
        legacyHostKeys: ['d'.repeat(64), 'e'.repeat(64), '9'.repeat(64)],
        retireToken: local.token,
      });
      expect(machineRow(s, local.machineId)).toBeDefined();
      expect(machineRow(s, onlineRow.machineId)).toBeDefined();
      expect(machineRow(s, revokedRow.machineId)).toBeDefined();
      expect(machineRow(s, activeStepRow.machineId)).toBeDefined();
      expect(
        s.db.select().from(stepTable).where(eq(stepTable.id, claimed!.step.id)).get()?.machineId,
      ).toBe(activeStepRow.machineId);
    } finally {
      s.dispose();
    }
  });

  test('paired-device confirm cannot retire another row, and a renamed local row still guards its hostKey', async () => {
    const ownerToken = 'cairn-owner-guard-test';
    const s = bootServer({ authToken: ownerToken, claimHoldMs: 200 });
    insertClaudeSubscription(s);
    try {
      seedLocalMachine(s.db, s.team.id);
      const localStart = await call(s.app, 'POST', '/api/machine/enroll/start', {
        body: { name: hostname(), hostKey: 'c'.repeat(64) },
        peer: '127.0.0.1',
      });
      expect(localStart.status).toBe(200);
      const { enrollId: localEnrollId } = (await localStart.json()) as { enrollId: string };
      const localConfirm = await call(s.app, 'POST', '/api/machine/enroll/confirm', {
        cred: ownerToken,
        body: { enrollId: localEnrollId },
      });
      expect(localConfirm.status).toBe(200);
      const local = ((await localConfirm.json()) as { machine: Enrolled }).machine;
      s.db
        .update(machineTable)
        .set({ name: 'Renamed Studio Mac' })
        .where(eq(machineTable.id, local.machineId))
        .run();

      const spoofStart = await call(s.app, 'POST', '/api/machine/enroll/start', {
        body: { name: hostname(), hostKey: HOST_KEY_B },
        peer: '127.0.0.1',
      });
      expect(spoofStart.status).toBe(409);

      const apiKeyRes = await call(s.app, 'POST', `/api/teams/${s.team.id}/api-keys`, {
        cred: ownerToken,
        body: {
          name: 'MACHINE_BOOTSTRAP',
          gitAccess: false,
          mcpAccess: false,
          machineAccess: true,
          toolGrants: { read: [], write: [] },
        },
      });
      expect(apiKeyRes.status).toBe(201);
      const apiKey = ((await apiKeyRes.json()) as { plaintext: string }).plaintext;

      const victimKeyRes = await call(s.app, 'POST', `/api/teams/${s.team.id}/api-keys`, {
        cred: ownerToken,
        body: {
          name: 'VICTIM_BOOTSTRAP',
          gitAccess: false,
          mcpAccess: false,
          machineAccess: true,
          toolGrants: { read: [], write: [] },
        },
      });
      expect(victimKeyRes.status).toBe(201);
      const victimKey = ((await victimKeyRes.json()) as { plaintext: string }).plaintext;

      const apiKeyPrimary = await enroll(s, apiKey, 'apikey-box', 'd'.repeat(64));
      const victim = await enroll(s, victimKey, 'victim-box', HOST_KEY_B);
      s.db
        .update(machineTable)
        .set({ online: false })
        .where(eq(machineTable.id, victim.machineId))
        .run();

      const browserPrimaryStart = await call(s.app, 'POST', '/api/machine/enroll/start', {
        body: { name: 'browser-primary', hostKey: HOST_KEY_A },
      });
      const { enrollId: browserPrimaryEnrollId } = (await browserPrimaryStart.json()) as {
        enrollId: string;
      };
      const browserPrimaryConfirm = await call(s.app, 'POST', '/api/machine/enroll/confirm', {
        cred: ownerToken,
        body: { enrollId: browserPrimaryEnrollId },
      });
      expect(browserPrimaryConfirm.status).toBe(200);
      const browserPrimary = ((await browserPrimaryConfirm.json()) as { machine: Enrolled })
        .machine;

      s.db
        .insert(pairedDeviceTable)
        .values({
          id: 'paired-1',
          teamId: s.team.id,
          name: 'phone',
          tokenHash: 'synthetic',
          masked: 'test',
          createdAt: 1,
        })
        .run();
      const deviceSession = issueBrowserSession(s.db, 'device', 'paired-1', null);

      const adoptApiKeyStart = await call(s.app, 'POST', '/api/machine/enroll/start', {
        body: { name: 'adopt-apikey', hostKey: 'd'.repeat(64) },
      });
      expect(adoptApiKeyStart.status).toBe(200);
      const { enrollId: adoptApiKeyEnrollId } = (await adoptApiKeyStart.json()) as {
        enrollId: string;
      };
      const adoptApiKeyConfirm = await s.app.request('/api/machine/enroll/confirm', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `cairn_auth=${deviceSession.token}`,
          'sec-fetch-site': 'same-origin',
        },
        body: JSON.stringify({ enrollId: adoptApiKeyEnrollId }),
      });
      expect(adoptApiKeyConfirm.status).toBe(200);
      expect(machineRow(s, apiKeyPrimary.machineId)?.apiKeyId).toBeNull();

      const start = await call(s.app, 'POST', '/api/machine/enroll/start', {
        body: { name: 'new-remote', hostKey: HOST_KEY_A, legacyHostKeys: [HOST_KEY_B] },
      });
      expect(start.status).toBe(200);
      const { enrollId } = (await start.json()) as { enrollId: string };
      const deviceConfirm = await s.app.request('/api/machine/enroll/confirm', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `cairn_auth=${deviceSession.token}`,
          'sec-fetch-site': 'same-origin',
        },
        body: JSON.stringify({ enrollId, retireToken: victim.token }),
      });
      expect(deviceConfirm.status).toBe(200);
      expect(machineRow(s, browserPrimary.machineId)).toBeDefined();
      expect(machineRow(s, victim.machineId)).toBeUndefined();
    } finally {
      s.dispose();
    }
  });

  test('an unverifiable stale row stays in the list until the owner deletes it', async () => {
    const s = bootServer({ claimHoldMs: 200 });
    insertClaudeSubscription(s);
    try {
      const survivor = await enrollThroughOwner(s, 'studio-mac.local', HOST_KEY_A);
      const stale = insertMachine(s, { name: 'studio-mac' });
      s.db.update(machineTable).set({ online: false }).where(eq(machineTable.id, stale)).run();

      const presence = await call(s.app, 'POST', '/api/machine/presence', {
        cred: survivor.token,
        body: { hostKey: HOST_KEY_A },
      });
      expect(presence.status).toBe(200);
      expect(machineRow(s, stale)).toBeDefined();

      const del = await call(s.app, 'DELETE', `/api/machines/${stale}`);
      expect(del.status).toBe(204);
      expect(machineRow(s, stale)).toBeUndefined();
      expect(machineRows(s)).toHaveLength(1);
    } finally {
      s.dispose();
    }
  });

  test('proxied loopback requests cannot claim or promote the local row', async () => {
    const s = bootServer({ claimHoldMs: 200 });
    insertClaudeSubscription(s);
    try {
      seedLocalMachine(s.db, s.team.id);
      const remote = await enrollThroughOwner(s, 'remote-mac', HOST_KEY_A);

      const proxyHeaders: Record<string, string>[] = [
        { 'x-forwarded-for': '100.64.0.9' },
        { 'x-forwarded-proto': 'https' },
        { 'x-forwarded-host': 'server.tailnet.ts.net' },
        { 'tailscale-user-login': 'owner@example.com' },
      ];
      for (const headers of proxyHeaders) {
        const claimUnclaimed = await call(s.app, 'POST', '/api/machine/enroll/start', {
          body: { name: hostname(), hostKey: HOST_KEY_B },
          peer: '127.0.0.1',
          headers,
        });
        expect(claimUnclaimed.status).toBe(409);

        const promoteRemote = await call(s.app, 'POST', '/api/machine/enroll/start', {
          body: { name: hostname(), hostKey: HOST_KEY_A },
          peer: '127.0.0.1',
          headers,
        });
        expect(promoteRemote.status).toBe(409);
      }

      expect(machineRow(s, remote.machineId)?.kind).toBe('remote');
    } finally {
      s.dispose();
    }
  });

  test('owner DB shape: desktop restart cleans up existing offline duplicate X for X.local, keeping default, history and unrelated machines', async () => {
    const s = bootServer({ claimHoldMs: 200 });
    insertClaudeSubscription(s);
    try {
      const macSources: HostIdentitySources = {
        platform: 'darwin',
        userHome: '/Users/owner',
        readFile: () => null,
        run: () => '"IOPlatformUUID" = "OWNER-EXACT-MAC-UUID-0001"',
      };
      const linuxSources: HostIdentitySources = {
        platform: 'linux',
        userHome: '/home/owner',
        readFile: (path) => (path === '/etc/machine-id' ? 'owner-build-linux-id-0002' : null),
        run: () => null,
      };
      const oldLaptopSources: HostIdentitySources = {
        platform: 'linux',
        userHome: '/home/owner',
        readFile: (path) => (path === '/etc/machine-id' ? 'owner-old-laptop-id-0003' : null),
        run: () => null,
      };
      const oldDesktopHome = '/Users/owner/Library/Application Support/Cairn/runner';
      const cliHome = '/Users/owner/.cairn';
      const desktopV1 = probeHostIdentity(oldDesktopHome, macSources)!;
      const cliV1 = probeHostIdentity(cliHome, macSources)!;
      const linuxId = probeHostIdentity('/home/owner/.cairn', linuxSources)!;
      const oldLaptopId = probeHostIdentity('/home/owner/.cairn', oldLaptopSources)!;
      const hostName = hostname();
      const shortName = hostName.toLowerCase().endsWith('.local')
        ? hostName.slice(0, -'.local'.length)
        : `${hostName}-short`;

      seedLocalMachine(s.db, s.team.id);
      const localEnrolled = await enrollThroughOwner(s, hostName, desktopV1.legacyHostKey, {
        peer: '127.0.0.1',
      });
      const dupEnrolled = await enrollThroughOwner(s, shortName, cliV1.legacyHostKey);
      const linuxEnrolled = await enrollThroughOwner(s, 'build-linux', linuxId.legacyHostKey);
      const oldLaptopEnrolled = await enrollThroughOwner(
        s,
        'old-laptop',
        oldLaptopId.legacyHostKey,
      );

      s.db
        .update(machineTable)
        .set({
          online: true,
          capabilities: { mcpServers: [], skills: [], osPlatform: 'darwin', hostname: hostName },
        })
        .where(eq(machineTable.id, localEnrolled.machineId))
        .run();
      s.db
        .update(machineTable)
        .set({
          online: false,
          capabilities: { mcpServers: [], skills: [], osPlatform: 'darwin', hostname: hostName },
        })
        .where(eq(machineTable.id, dupEnrolled.machineId))
        .run();
      s.db
        .update(machineTable)
        .set({ online: true })
        .where(eq(machineTable.id, linuxEnrolled.machineId))
        .run();
      s.db
        .update(machineTable)
        .set({ online: false })
        .where(eq(machineTable.id, oldLaptopEnrolled.machineId))
        .run();
      s.db
        .update(teamTable)
        .set({ defaultMachineId: localEnrolled.machineId })
        .where(eq(teamTable.id, s.team.id))
        .run();

      const projectId = await postProject(s.app, 'owner-shape-desktop');
      const dupRule = seedSessionRoute(s, {
        provider: 'stub-gw',
        modelId: 'stub-model',
        machineId: dupEnrolled.machineId,
      });
      const todoRes = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
        title: '',
        spec: 'preserve history across duplicate retirement',
      });
      const todoId = ((await todoRes.json()) as { id: string }).id;
      s.db
        .update(todoTable)
        .set({ routeOverride: { machineId: dupEnrolled.machineId } })
        .where(eq(todoTable.id, todoId))
        .run();
      const buildId = startLegacyBuild(s, todoId, { withPlan: true });
      const [firstStep] = s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
      s.db
        .update(stepTable)
        .set({ status: 'done', machineId: dupEnrolled.machineId })
        .where(eq(stepTable.id, firstStep!.id))
        .run();

      expect(machineRows(s)).toHaveLength(4);

      const restarted = await enrollThroughOwner(s, hostName, cliV1.hostKey, {
        peer: '127.0.0.1',
        legacyHostKeys: cliV1.legacyHostKeys,
      });

      expect(restarted.machineId).toBe(localEnrolled.machineId);
      const remaining = machineRows(s);
      expect(remaining).toHaveLength(3);
      expect(machineRow(s, dupEnrolled.machineId)).toBeUndefined();
      expect(machineRow(s, localEnrolled.machineId)).toMatchObject({
        id: localEnrolled.machineId,
        kind: 'local',
        hostKey: cliV1.hostKey,
      });
      expect(machineRow(s, linuxEnrolled.machineId)?.online).toBe(true);
      expect(machineRow(s, oldLaptopEnrolled.machineId)?.online).toBe(false);
      expect(
        s.db.select().from(teamTable).where(eq(teamTable.id, s.team.id)).get()?.defaultMachineId,
      ).toBe(localEnrolled.machineId);
      expect(
        s.db.select().from(stepTable).where(eq(stepTable.id, firstStep!.id)).get()?.machineId,
      ).toBe(localEnrolled.machineId);
      expect(
        s.db.select().from(routingRuleTable).where(eq(routingRuleTable.id, dupRule)).get()
          ?.machineId,
      ).toBe(localEnrolled.machineId);
      expect(
        s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()?.routeOverride
          ?.machineId,
      ).toBe(localEnrolled.machineId);
    } finally {
      s.dispose();
    }
  });

  test('owner DB shape: already-enrolled runner reconnecting via presence cleans up existing offline duplicate and upgrades to v2', async () => {
    const s = bootServer({ claimHoldMs: 200 });
    insertClaudeSubscription(s);
    try {
      const macSources: HostIdentitySources = {
        platform: 'darwin',
        userHome: '/Users/owner',
        readFile: () => null,
        run: () => '"IOPlatformUUID" = "OWNER-EXACT-MAC-UUID-0002"',
      };
      const linuxSources: HostIdentitySources = {
        platform: 'linux',
        userHome: '/home/owner',
        readFile: (path) => (path === '/etc/machine-id' ? 'owner-build-linux-id-0004' : null),
        run: () => null,
      };
      const oldLaptopSources: HostIdentitySources = {
        platform: 'linux',
        userHome: '/home/owner',
        readFile: (path) => (path === '/etc/machine-id' ? 'owner-old-laptop-id-0005' : null),
        run: () => null,
      };
      const desktopV1 = probeHostIdentity(
        '/Users/owner/Library/Application Support/Cairn/runner',
        macSources,
      )!;
      const cliV1 = probeHostIdentity('/Users/owner/.cairn', macSources)!;
      const linuxId = probeHostIdentity('/home/owner/.cairn', linuxSources)!;
      const oldLaptopId = probeHostIdentity('/home/owner/.cairn', oldLaptopSources)!;

      const hostName = hostname();
      const shortName = hostName.toLowerCase().endsWith('.local')
        ? hostName.slice(0, -'.local'.length)
        : `${hostName}-short`;
      seedLocalMachine(s.db, s.team.id);
      const localEnrolled = await enrollThroughOwner(s, hostName, desktopV1.legacyHostKey, {
        peer: '127.0.0.1',
      });
      const dupEnrolled = await enrollThroughOwner(s, shortName, cliV1.legacyHostKey);
      const linuxEnrolled = await enrollThroughOwner(s, 'build-linux', linuxId.legacyHostKey);
      const oldLaptopEnrolled = await enrollThroughOwner(
        s,
        'old-laptop',
        oldLaptopId.legacyHostKey,
      );

      s.db
        .update(machineTable)
        .set({
          online: true,
          capabilities: { mcpServers: [], skills: [], osPlatform: 'darwin', hostname: hostName },
        })
        .where(eq(machineTable.id, localEnrolled.machineId))
        .run();
      s.db
        .update(machineTable)
        .set({
          online: false,
          capabilities: { mcpServers: [], skills: [], osPlatform: 'darwin', hostname: hostName },
        })
        .where(eq(machineTable.id, dupEnrolled.machineId))
        .run();
      s.db
        .update(machineTable)
        .set({ online: true })
        .where(eq(machineTable.id, linuxEnrolled.machineId))
        .run();
      s.db
        .update(machineTable)
        .set({ online: false })
        .where(eq(machineTable.id, oldLaptopEnrolled.machineId))
        .run();
      s.db
        .update(teamTable)
        .set({ defaultMachineId: localEnrolled.machineId })
        .where(eq(teamTable.id, s.team.id))
        .run();

      const projectId = await postProject(s.app, 'owner-shape-presence');
      const todoRes = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
        title: '',
        spec: 'presence cleanup keeps step history',
      });
      const todoId = ((await todoRes.json()) as { id: string }).id;
      const buildId = startLegacyBuild(s, todoId, { withPlan: true });
      const [firstStep] = s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
      s.db
        .update(stepTable)
        .set({ status: 'done', machineId: dupEnrolled.machineId })
        .where(eq(stepTable.id, firstStep!.id))
        .run();

      const presence = await call(s.app, 'POST', '/api/machine/presence', {
        cred: localEnrolled.token,
        body: {
          hostKey: desktopV1.hostKey,
          legacyHostKeys: desktopV1.legacyHostKeys,
        },
      });
      expect(presence.status).toBe(200);

      expect(machineRows(s)).toHaveLength(3);
      expect(machineRow(s, dupEnrolled.machineId)).toBeUndefined();
      expect(machineRow(s, localEnrolled.machineId)).toMatchObject({
        id: localEnrolled.machineId,
        online: true,
        kind: 'local',
        hostKey: desktopV1.legacyHostKey,
      });
      expect(machineRow(s, linuxEnrolled.machineId)?.online).toBe(true);
      expect(machineRow(s, oldLaptopEnrolled.machineId)?.online).toBe(false);
      expect(
        s.db.select().from(teamTable).where(eq(teamTable.id, s.team.id)).get()?.defaultMachineId,
      ).toBe(localEnrolled.machineId);
      expect(
        s.db.select().from(stepTable).where(eq(stepTable.id, firstStep!.id)).get()?.machineId,
      ).toBe(localEnrolled.machineId);
    } finally {
      s.dispose();
    }
  });

  test('presence requires proving the caller own hostKey and respects apiKey boundaries', async () => {
    const s = bootServer({ claimHoldMs: 200 });
    insertClaudeSubscription(s);
    try {
      const keyA = await issueApiKey(s);
      const keyB = await issueApiKey(s);
      const caller = await enroll(s, keyA, 'caller-mac', HOST_KEY_A);
      const callerApiKeyId = machineRow(s, caller.machineId)?.apiKeyId ?? null;
      const victimOtherKey = await enroll(s, keyB, 'victim-key-b', HOST_KEY_B);
      const victimBrowser = await enrollThroughOwner(s, 'victim-browser', 'c'.repeat(64));
      const sameKeyDupId = insertMachine(s, { name: 'same-key-dup' });
      s.db
        .update(machineTable)
        .set({ online: false, apiKeyId: callerApiKeyId, hostKey: 'd'.repeat(64) })
        .where(eq(machineTable.id, sameKeyDupId))
        .run();
      for (const id of [victimOtherKey.machineId, victimBrowser.machineId]) {
        s.db.update(machineTable).set({ online: false }).where(eq(machineTable.id, id)).run();
      }

      const withoutOwnKey = await call(s.app, 'POST', '/api/machine/presence', {
        cred: caller.token,
        body: {
          hostKey: 'e'.repeat(64),
          legacyHostKeys: ['d'.repeat(64)],
        },
      });
      expect(withoutOwnKey.status).toBe(200);
      expect(machineRow(s, caller.machineId)?.hostKey).toBe(HOST_KEY_A);
      expect(machineRow(s, sameKeyDupId)).toBeDefined();

      const withOwnKeyCrossBoundary = await call(s.app, 'POST', '/api/machine/presence', {
        cred: caller.token,
        body: {
          hostKey: 'e'.repeat(64),
          legacyHostKeys: [HOST_KEY_A, HOST_KEY_B, 'c'.repeat(64)],
        },
      });
      expect(withOwnKeyCrossBoundary.status).toBe(200);
      expect(machineRow(s, caller.machineId)?.hostKey).toBe(HOST_KEY_A);
      expect(machineRow(s, victimOtherKey.machineId)).toBeDefined();
      expect(machineRow(s, victimBrowser.machineId)).toBeDefined();
      expect(machineRow(s, sameKeyDupId)).toBeDefined();

      const unkeyed = await enrollThroughOwner(s, 'unkeyed-remote');
      const unkeyedAttempt = await call(s.app, 'POST', '/api/machine/presence', {
        cred: unkeyed.token,
        body: {
          hostKey: 'f'.repeat(64),
          legacyHostKeys: ['c'.repeat(64)],
        },
      });
      expect(unkeyedAttempt.status).toBe(200);
      expect(machineRow(s, unkeyed.machineId)?.hostKey).toBe('f'.repeat(64));
      expect(machineRow(s, victimBrowser.machineId)).toBeDefined();
    } finally {
      s.dispose();
    }
  });
});
