import { join } from 'node:path';
import { type ClaimedStep, claimedStepSchema, WORKFLOW_PUSH_REFUSAL } from '@cairn/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { openDbWithHandle } from '../src/db/client.js';
import {
  apiKey as apiKeyTable,
  build as buildTable,
  machine as machineTable,
  message as messageTable,
  plan as planTable,
  project as projectTable,
  step as stepTable,
} from '../src/db/schema.js';
import * as runtimeOtel from '../src/runtime-otel.js';
import type { BlockerHandoffDeps } from '../src/services/blocker-handoff.js';
import { claimPendingChiefStep } from '../src/services/coordinator-steps.js';
import { issueStepGitCredential } from '../src/services/credentials.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import type { MachineDeps } from '../src/services/machine-deps.js';
import {
  bootServer,
  issueApiKey,
  req,
  seedRoute,
  seedSessionRoute,
  startLegacyBuild,
  type TestServer,
} from './helpers.js';

const race = vi.hoisted(() => ({
  fn: null as ((deps: BlockerHandoffDeps, stepRow: typeof stepTable.$inferSelect) => void) | null,
}));

vi.mock('../src/services/blocker-handoff.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/services/blocker-handoff.js')>();
  return {
    ...real,
    blockerHandoffForClaim: async (
      ...args: Parameters<typeof real.blockerHandoffForClaim>
    ): ReturnType<typeof real.blockerHandoffForClaim> => {
      const result = await real.blockerHandoffForClaim(...args);
      const fn = race.fn;
      race.fn = null;
      fn?.(args[0], args[1]);
      return result;
    },
  };
});

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'x-cairn-raw-send': '1' };
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

interface World {
  s: TestServer;
  token: string;
  todoId: string;
  projectId: string;
  startBuild(withPlan?: boolean): string;
  claimRaw(): Promise<Response>;
  claim(): Promise<ClaimedStep>;
}

async function setupWorld(opts: Parameters<typeof bootServer>[0] = {}): Promise<World> {
  const s = bootServer({ claimHoldMs: 200, ...opts });
  disposables.push(() => s.dispose());
  const key = await issueApiKey(s);
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: readyMachine({
      teamId: s.team.id,
      name: 'gen-runner',
      cliVersion: '0.1.0',
      capabilities: { mcpServers: [], skills: [], claimGeneration: true },
    }),
  });
  const { token } = (await enrollRes.json()) as { token: string };
  const machineId = s.db.select({ id: machineTable.id }).from(machineTable).get()!.id;
  seedSessionRoute(s, {
    provider: 'stub-gw',
    modelId: 'm',
    machineId,
    tools: ['合并分支', '推送分支'],
  });
  const projRes = await call(s.app, 'POST', '/api/projects', {
    body: { name: 'gen-world', repoKind: 'hosted' },
  });
  expect(projRes.status).toBe(201);
  const project = (await projRes.json()) as { id: string };
  const todoRes = await call(s.app, 'POST', `/api/projects/${project.id}/todos`, {
    body: { title: '世代', spec: 'claim generation fence' },
  });
  const todoBody = (await todoRes.json()) as { id: string };
  const claimRaw = () => call(s.app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
  return {
    s,
    token,
    todoId: todoBody.id,
    projectId: project.id,
    startBuild(withPlan = true) {
      return startLegacyBuild(s, todoBody.id, { withPlan });
    },
    claimRaw,
    async claim() {
      const res = await claimRaw();
      const body = (await res.json()) as { step: ClaimedStep | null };
      if (body.step === null) throw new Error('claim returned no step');
      return claimedStepSchema.parse(body.step);
    },
  };
}

async function githubWorld(
  githubFetch: NonNullable<Parameters<typeof bootServer>[0]>['githubFetch'],
) {
  const database = join(makeTestTempDir('claim-fence-'), 'fixture.sqlite');
  const first = openDbWithHandle(database);
  const second = openDbWithHandle(database);
  disposables.push(second.close, first.close);
  const w = await setupWorld({ db: first.db, githubFetch });
  first.db
    .update(projectTable)
    .set({ repoKind: 'github', githubRepo: 'octo/alpha' })
    .where(eq(projectTable.id, w.projectId))
    .run();
  const checkedAt = Date.now();
  first.db
    .update(machineTable)
    .set({
      capabilities: {
        mcpServers: [],
        skills: [],
        claimGeneration: true,
        githubPush: {
          login: 'ok',
          checkedAt,
          repos: [{ repo: 'octo/alpha', state: 'write', checkedAt }],
        },
      },
    })
    .run();
  upsertGithubConnection(
    { db: first.db, box: w.s.secretBox },
    {
      teamId: w.s.team.id,
      login: 'octo',
      accessToken: 'fixture-read-token',
      scope: 'repo',
    },
  );
  return { ...w, writer: second.db };
}

function gate() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('claim generation is fenced and strictly increasing', () => {
  test.each(['during probe', 'after transaction'])(
    'a failed repository probe cannot overwrite a second writer (%s)',
    async (interleave) => {
      const entered = gate();
      const release = gate();
      const w = await githubWorld(async () => {
        entered.resolve();
        await release.promise;
        return Response.json({}, { status: 500 });
      });
      const buildId = w.startBuild();
      const candidate = w.writer
        .select()
        .from(stepTable)
        .where(eq(stepTable.buildId, buildId))
        .get()!;
      const generation = Date.now() + 60_000;
      const machineId = w.writer.select().from(machineTable).get()!.id;
      const claimNext = () =>
        w.writer
          .update(stepTable)
          .set({ status: 'claimed', machineId, claimedAt: generation })
          .where(and(eq(stepTable.id, candidate.id), eq(stepTable.status, 'pending')))
          .run();
      const statuses: string[] = [];
      const publish = vi.spyOn(w.s.convHub, 'publishStep').mockImplementation(() => {
        statuses.push(
          w.writer.select().from(stepTable).where(eq(stepTable.id, candidate.id)).get()!.status,
        );
      });
      const run = w.claimRaw();
      const transaction = w.s.db.transaction.bind(w.s.db);
      const boundary = vi.spyOn(w.s.db, 'transaction');
      try {
        await entered.promise;
        if (interleave === 'after transaction') {
          boundary.mockImplementationOnce((...args) => {
            const result = transaction(...args);
            claimNext();
            return result;
          });
        } else {
          expect(claimNext().changes).toBe(1);
        }
        release.resolve();
        expect((await run).status).toBe(200);
        const row = w.writer.select().from(stepTable).where(eq(stepTable.id, candidate.id)).get();
        if (interleave === 'after transaction') {
          expect(row).toMatchObject({ status: 'failed', machineId: null, claimedAt: null });
          expect(statuses).toEqual(['failed']);
        } else {
          expect(row).toMatchObject({ status: 'claimed', machineId, claimedAt: generation });
          expect(statuses).toEqual([]);
        }
      } finally {
        release.resolve();
        boundary.mockRestore();
        publish.mockRestore();
      }
    },
  );

  test('a finish report holds the generation fence through its writes and publishes after commit', async () => {
    const entered = gate();
    const release = gate();
    const w = await githubWorld(async (url) => {
      if (!String(url).includes('/pulls?'))
        return Response.json({ id: 42, full_name: 'octo/alpha' });
      entered.resolve();
      await release.promise;
      return Response.json([]);
    });
    w.startBuild(false);
    const claim = (await w.claim()).step;
    const generation = (claim.generation ?? 0) + 1;
    const wake = vi.spyOn(w.s.machineHub, 'wake').mockImplementationOnce(() => {
      w.writer
        .update(stepTable)
        .set({ claimedAt: generation })
        .where(and(eq(stepTable.id, claim.id), eq(stepTable.status, 'claimed')))
        .run();
    });
    const statusesAtTelemetry: (string | undefined)[] = [];
    const telemetry = vi.spyOn(runtimeOtel, 'emitRuntimeStepSpan').mockImplementation(() => {
      statusesAtTelemetry.push(
        w.writer.select().from(stepTable).where(eq(stepTable.id, claim.id)).get()?.status,
      );
    });
    const run = call(w.s.app, 'POST', `/api/machine/done/${claim.id}`, {
      cred: w.token,
      body: { status: 'failed', errorMessage: 'fixture failure', generation: claim.generation },
    });
    try {
      await entered.promise;
      release.resolve();
      expect((await run).status).toBe(200);
      expect(
        w.writer.select().from(stepTable).where(eq(stepTable.id, claim.id)).get(),
      ).toMatchObject({ status: 'failed', claimedAt: claim.generation });
      expect(wake).toHaveBeenCalled();
      expect(statusesAtTelemetry).toEqual(['failed']);
    } finally {
      release.resolve();
      wake.mockRestore();
      telemetry.mockRestore();
    }
  });

  test('a machine completion without a generation is rejected before it can settle the new claim', async () => {
    const w = await setupWorld();
    w.startBuild();
    const first = await w.claim();
    const stepId = first.step.id;
    const g1 = first.step.generation;
    w.s.db
      .update(stepTable)
      .set({ status: 'pending', machineId: null })
      .where(eq(stepTable.id, stepId))
      .run();
    const second = await w.claim();
    expect(second.step.id).toBe(stepId);
    const rowAfterReclaim = () =>
      w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get();
    const g2 = rowAfterReclaim()?.claimedAt;
    expect(g2).not.toBe(g1);
    issueStepGitCredential(
      { db: w.s.db, box: w.s.secretBox },
      { teamId: w.s.team.id, stepId, claimedAt: g2 ?? null },
    );
    const credentialCount = () =>
      w.s.db
        .select()
        .from(apiKeyTable)
        .where(eq(apiKeyTable.name, `git-step-${stepId}`))
        .all().length;
    expect(credentialCount()).toBe(1);
    const missing = await call(w.s.app, 'POST', `/api/machine/done/${stepId}`, {
      cred: w.token,
      body: { status: 'failed', errorMessage: 'stale runner report' },
    });
    expect(missing.status).toBe(409);
    expect(rowAfterReclaim()).toMatchObject({
      status: 'claimed',
      machineId: second.step.machineId,
      claimedAt: g2,
    });
    expect(credentialCount()).toBe(1);
    const stale = await call(w.s.app, 'POST', `/api/machine/done/${stepId}`, {
      cred: w.token,
      body: { status: 'failed', errorMessage: 'stale runner report', generation: g1 },
    });
    expect(stale.status).toBe(409);
    expect(rowAfterReclaim()).toMatchObject({
      status: 'claimed',
      machineId: second.step.machineId,
      claimedAt: g2,
    });
    expect(credentialCount()).toBe(1);
  });

  test('same-machine reclaim rejects stale heartbeat, relay, transcript and all upload grants', async () => {
    const w = await setupWorld();
    w.startBuild();
    const first = await w.claim();
    const stepId = first.step.id;
    const urls = await call(
      w.s.app,
      'POST',
      `/api/machine/upload-urls/${stepId}?generation=${first.step.generation}`,
      {
        cred: w.token,
        body: {
          files: [{ name: 'plan.md' }, { name: 'transcript.json' }, { name: 'session.jsonl' }],
        },
      },
    );
    expect(urls.status).toBe(200);
    const grants = (await urls.json()) as { uploads: { name: string; url: string }[] };
    w.s.db
      .update(stepTable)
      .set({ status: 'pending', machineId: null })
      .where(eq(stepTable.id, stepId))
      .run();
    const second = await w.claim();
    const before = w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get();
    const messages = w.s.db.select().from(messageTable).all();
    for (const [path, body] of [
      [`heartbeat/${stepId}`, { baseSha: 'a'.repeat(40) }],
      [`tool/${stepId}`, { name: 'thread_report', params: { line: 'stale' } }],
      [
        `tool/${stepId}`,
        {
          kind: 'transcript_row',
          row: { id: 'stale-row', role: 'assistant', content: 'stale', createdAt: 1 },
        },
      ],
    ] as const) {
      for (const suffix of ['', `?generation=${first.step.generation}`]) {
        const res = await call(w.s.app, 'POST', `/api/machine/${path}${suffix}`, {
          cred: w.token,
          body,
        });
        expect(res.status).toBe(409);
      }
    }
    for (const grant of grants.uploads) {
      const body =
        grant.name === 'transcript.json'
          ? JSON.stringify({
              stepId,
              messages: [{ id: 'stale-upload', role: 'assistant', content: 'stale', createdAt: 1 }],
            })
          : 'stale';
      const res = await w.s.app.request(new URL(grant.url).pathname, {
        method: 'PUT',
        headers: { authorization: `Bearer ${w.token}`, 'content-type': 'application/json' },
        body,
      });
      expect(res.status).toBe(409);
    }
    expect(w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()).toEqual(before);
    expect(w.s.db.select().from(messageTable).all()).toEqual(messages);
    expect(w.s.db.select().from(planTable).all()).toEqual([]);
    const current = await call(
      w.s.app,
      'POST',
      `/api/machine/heartbeat/${stepId}?generation=${second.step.generation}`,
      { cred: w.token, body: {} },
    );
    expect(current.status).toBe(200);
  });

  test('a relay suspended at GitHub cannot bind a repository after a same-machine reclaim', async () => {
    const release = gate();
    const github = vi.fn(async () => {
      await release.promise;
      return Response.json({ full_name: 'octo/new' });
    });
    const w = await setupWorld({ githubFetch: github });
    upsertGithubConnection(
      { db: w.s.db, box: w.s.secretBox },
      { teamId: w.s.team.id, login: 'octo', accessToken: 'fixture-binding-token', scope: 'repo' },
    );
    const machineId = w.s.db.select().from(machineTable).get()!.id;
    seedRoute(w.s, 'coordinator', { provider: 'stub-gw', modelId: 'm', machineId });
    const created = await req(w.s.app, 'POST', `/api/teams/${w.s.team.id}/chief/threads`, {
      content: 'bind the repository',
    });
    expect(created.status).toBe(201);
    const { message } = (await created.json()) as { message: { id: string } };
    w.s.db
      .update(stepTable)
      .set({ status: 'claimed', machineId, claimedAt: 1 })
      .where(eq(stepTable.id, message.id))
      .run();
    const before = w.s.db.select().from(projectTable).where(eq(projectTable.id, w.projectId)).get();
    const waiting = call(w.s.app, 'POST', `/api/machine/tool/${message.id}?generation=1`, {
      cred: w.token,
      body: { name: 'connect_repo', params: { projectId: w.projectId, githubRepo: 'octo/new' } },
    });
    try {
      await vi.waitFor(() => expect(github).toHaveBeenCalledTimes(1));
      w.s.db.update(stepTable).set({ claimedAt: 2 }).where(eq(stepTable.id, message.id)).run();
      release.resolve();
      expect((await waiting).status).toBe(409);
      expect(
        w.s.db.select().from(projectTable).where(eq(projectTable.id, w.projectId)).get(),
      ).toEqual(before);
      expect(
        w.s.db.select().from(stepTable).where(eq(stepTable.id, message.id)).get(),
      ).toMatchObject({ status: 'claimed', claimedAt: 2, machineId });
      expect(github).toHaveBeenCalledTimes(1);
    } finally {
      release.resolve();
      await waiting;
    }
  });

  test.each(['quota', 'capacity'] as const)(
    'workflow refusal wins over %s retry information',
    async (kind) => {
      const w = await setupWorld();
      w.startBuild(false);
      const claimed = await w.claim();
      const res = await call(w.s.app, 'POST', `/api/machine/done/${claimed.step.id}`, {
        cred: w.token,
        body: {
          status: 'failed',
          generation: claimed.step.generation,
          errorMessage: WORKFLOW_PUSH_REFUSAL,
          quotaBlock: { kind, providerId: 'stub-gw', reason: 'fixture limit' },
        },
      });
      expect(res.status).toBe(200);
      expect(
        w.s.db.select().from(stepTable).where(eq(stepTable.id, claimed.step.id)).get(),
      ).toMatchObject({ status: 'failed', holdReason: null });
      expect(
        w.s.db.select().from(buildTable).where(eq(buildTable.id, claimed.step.buildId)).get()
          ?.errorMessage,
      ).toContain(WORKFLOW_PUSH_REFUSAL);
    },
  );

  test('a reclaim whose candidate raced a newer released generation never mints below it', async () => {
    const w = await setupWorld();
    w.startBuild();
    const first = await w.claim();
    const released = first.step.generation ?? 0;
    w.s.db
      .update(stepTable)
      .set({ status: 'pending', machineId: null })
      .where(eq(stepTable.id, first.step.id))
      .run();
    const skewed = released + 60_000;
    race.fn = (deps: BlockerHandoffDeps, stepRow: typeof stepTable.$inferSelect) => {
      deps.db
        .update(stepTable)
        .set({ claimedAt: skewed })
        .where(eq(stepTable.id, stepRow.id))
        .run();
    };
    const second = await w.claim();
    expect(second.step.id).toBe(first.step.id);
    const generation = second.step.generation ?? 0;
    expect(generation).toBeGreaterThan(skewed);
    const stored = w.s.db
      .select({ claimedAt: stepTable.claimedAt })
      .from(stepTable)
      .where(eq(stepTable.id, first.step.id))
      .get()?.claimedAt;
    expect(stored).toBe(generation);
  });

  test('a first claim fenced against a generation written while its candidate was stale', async () => {
    const w = await setupWorld();
    w.startBuild();
    const skewed = Date.now() + 60_000;
    race.fn = (deps: BlockerHandoffDeps, stepRow: typeof stepTable.$inferSelect) => {
      deps.db
        .update(stepTable)
        .set({ claimedAt: skewed })
        .where(eq(stepTable.id, stepRow.id))
        .run();
    };
    const claimed = await w.claim();
    expect(claimed.step.generation ?? 0).toBeGreaterThan(skewed);
  });

  test('claimPendingChiefStep refuses a stale candidate and mints above the live generation', () => {
    const s = bootServer({ claimHoldMs: 200 });
    disposables.push(() => s.dispose());
    const stepId = 'chief-gen-fence';
    s.db
      .insert(stepTable)
      .values({
        id: stepId,
        buildId: 'thread-gen-fence',
        kind: 'chief',
        prompt: 'hello',
        status: 'pending',
        createdAt: Date.now(),
      })
      .run();
    const stale = s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get();
    if (stale === undefined) throw new Error('chief step missing');
    const skewed = Date.now() + 60_000;
    s.db.update(stepTable).set({ claimedAt: skewed }).where(eq(stepTable.id, stepId)).run();
    const depsDb = s.db as MachineDeps['db'];
    expect(claimPendingChiefStep(depsDb, stale, { machineId: 'm-gen' })).toBeNull();
    const fresh = s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get();
    if (fresh === undefined) throw new Error('chief step missing');
    const claimed = claimPendingChiefStep(depsDb, fresh, { machineId: 'm-gen' });
    expect(claimed?.claimedAt ?? 0).toBeGreaterThan(skewed);
  });
});
