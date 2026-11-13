import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  claimedStepSchema,
  parseVerifyPromptMeta,
  VERIFY_ANNOUNCEMENT,
  VERIFY_VERDICT_KIND,
} from '@cairn/shared';
import { eq, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterEach, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  build as buildTable,
  gateVerdict,
  message as messageTable,
  project as projectTable,
  provider as providerTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import { flushVerdictDigests } from '../src/services/build-gate-verdict.js';
import { maybeEnqueueVerifyStep } from '../src/services/builds.js';
import { bootServer, issueApiKey, postProject, seedRoute, seedSessionRoute } from './helpers.js';
import { rejectingGithubFetch } from './network-guard.js';

const HEAD = 'ab'.repeat(20);
const FIX_HEAD = 'cd'.repeat(20);

async function call(
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

const noOpenBranchPulls: FetchLike = async (input, init) => {
  const url = new URL(String(input));
  if ((init?.method ?? 'GET') === 'GET' && url.pathname === '/repos/acme/widgets/pulls/7')
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ state: 'open', merged: false }),
      text: async () => '{"state":"open","merged":false}',
    };
  if ((init?.method ?? 'GET') === 'GET' && url.pathname === '/repos/acme/widgets/pulls')
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => [],
      text: async () => '[]',
    };
  return rejectingGithubFetch(input, init);
};

async function setup(opts: { withVerifierRoute?: boolean } = {}) {
  const s = bootServer({
    claimHoldMs: 200,
    pingIntervalMs: 3_600_000,
    githubFetch: noOpenBranchPulls,
  });
  const key = await issueApiKey(s);
  s.db
    .insert(providerTable)
    .values({
      id: 'prov-verify-dispatch',
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
  if (opts.withVerifierRoute !== false) {
    seedSessionRoute(s, { provider: 'stub-gw', modelId: 'stub-model' });
    seedRoute(s, 'review', { provider: 'stub-gw', modelId: 'stub-model' });
  }
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: readyMachine({ teamId: s.team.id, name: 'verify-mbp', cliVersion: '0.1.0' }),
  });
  expect(enrollRes.status).toBe(200);
  const { token: machineToken } = (await enrollRes.json()) as { token: string };
  const projectId = await postProject(s.app);
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: 'verify dispatch probe', spec: 'S1' },
  });
  const { id: todoId } = (await todoRes.json()) as { id: string };
  return {
    s,
    todoId,
    async startBuild() {
      const res = await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
        body: { todoIds: [todoId] },
      });
      expect(res.status).toBe(201);
      const buildId = ((await res.json()) as { builds: { id: string }[] }).builds[0]!.id;
      s.db
        .update(projectTable)
        .set({ repoKind: 'github', githubRepo: 'acme/widgets' })
        .where(eq(projectTable.id, projectId))
        .run();
      s.db
        .update(buildTable)
        .set({ prNumber: 7, prUrl: 'https://github.com/acme/widgets/pull/7' })
        .where(eq(buildTable.id, buildId))
        .run();
      return buildId;
    },
    enqueueVerify(buildId: string) {
      maybeEnqueueVerifyStep(s.svc, this.todoRow(), buildId);
    },
    async tryClaim(supportsAttachmentVerify = true) {
      const res = await call(s.app, 'POST', '/api/machine/tasks/claim', {
        cred: machineToken,
        body: supportsAttachmentVerify ? { verifyAttachments: true } : {},
      });
      const body = (await res.json()) as { step?: unknown };
      if (!body.step) return null;
      const parsed = claimedStepSchema.parse(body.step);
      return { stepId: parsed.step.id, kind: parsed.step.kind };
    },
    async claim() {
      const claimed = await this.tryClaim();
      if (claimed === null) throw new Error('claim returned no step');
      return claimed;
    },
    async done(stepId: string, body: Record<string, unknown>) {
      const res = await call(s.app, 'POST', `/api/machine/done/${stepId}`, {
        cred: machineToken,
        body,
      });
      expect(res.status).toBe(200);
    },
    stepsOf: (buildId: string) =>
      s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all(),
    todoRow: () => s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!,
  };
}

type World = Awaited<ReturnType<typeof setup>>;

let world: World | undefined;
afterEach(async () => {
  await flushVerdictDigests();
  world?.s.dispose();
  world = undefined;
});

describe('verification dispatch driven by the routing rules', () => {
  test('a delivered build queues one verify step bound to its head; the verifier claims it and the verdict lands', async () => {
    world = await setup();
    const w = world;
    const buildId = await w.startBuild();
    const author = await w.claim();
    expect(author.kind).toBe('session');
    await w.done(author.stepId, { status: 'success', hasChanges: true, commit: HEAD });
    w.enqueueVerify(buildId);

    const queued = w.stepsOf(buildId).filter((row) => row.kind === 'verify');
    expect(queued).toHaveLength(1);
    expect(queued[0]?.status).toBe('pending');
    expect(parseVerifyPromptMeta(queued[0]?.prompt ?? null)?.expectedHeadSha).toBe(HEAD);
    expect(
      w.s.db
        .select()
        .from(messageTable)
        .where(eq(messageTable.conversationId, buildId))
        .all()
        .some((row) => row.content === VERIFY_ANNOUNCEMENT),
    ).toBe(true);

    const verifier = await w.claim();
    expect(verifier.kind).toBe('verify');
    await w.done(verifier.stepId, {
      status: 'success',
      verifyVerdict: { passed: true, conclusion: 'all green', evidence: [] },
    });

    const verdict = w.s.db
      .select()
      .from(gateVerdict)
      .where(eq(gateVerdict.stepId, verifier.stepId))
      .get();
    expect(verdict?.kind).toBe('verify');
    expect(verdict?.outcome).toBe('pass');
    expect(verdict?.expectedHeadSha).toBe(HEAD);
    expect(
      w.s.db
        .select()
        .from(messageTable)
        .where(eq(messageTable.conversationId, buildId))
        .all()
        .some(
          (row) => typeof row.content === 'string' && row.content.includes(VERIFY_VERDICT_KIND),
        ),
    ).toBe(true);
    expect(w.stepsOf(buildId).filter((row) => row.kind === 'verify')).toHaveLength(1);
  });

  test('a delivery without a code head queues no verify step', async () => {
    world = await setup();
    const w = world;
    const buildId = await w.startBuild();
    const author = await w.claim();
    await w.done(author.stepId, { status: 'success', hasChanges: true });
    w.enqueueVerify(buildId);
    expect(w.stepsOf(buildId).filter((row) => row.kind === 'verify')).toHaveLength(0);
  });

  test('a team with no session rule queues no verify step', async () => {
    world = await setup({ withVerifierRoute: false });
    const w = world;
    const buildId = 'build-no-route';
    w.s.db
      .insert(buildTable)
      .values({
        id: buildId,
        todoId: w.todoId,
        withPlan: false,
        triggerSource: 'user',
        prNumber: 8,
        prUrl: 'https://github.com/acme/widgets/pull/8',
        createdAt: Date.now(),
      })
      .run();
    w.s.db.update(projectTable).set({ repoKind: 'github', githubRepo: 'acme/widgets' }).run();
    w.s.db
      .insert(stepTable)
      .values({
        id: 'step-no-route',
        buildId,
        kind: 'session',
        status: 'claimed',
        checkpointCommit: HEAD,
        createdAt: Date.now(),
      })
      .run();
    w.s.db
      .update(todoTable)
      .set({ latestBuildId: buildId })
      .where(eq(todoTable.id, w.todoId))
      .run();
    w.enqueueVerify(buildId);
    expect(w.stepsOf(buildId).filter((row) => row.kind === 'verify')).toHaveLength(0);
  });

  test('a later delivery in a new round is verified again on its own head', async () => {
    world = await setup();
    const w = world;
    const buildId = await w.startBuild();
    const first = await w.claim();
    await w.done(first.stepId, { status: 'success', hasChanges: true, commit: HEAD });
    w.enqueueVerify(buildId);
    const verifier = await w.claim();
    await w.done(verifier.stepId, {
      status: 'success',
      verifyVerdict: { passed: true, conclusion: 'ok', evidence: [] },
    });

    const fixId = 'step-second-round';
    w.s.db
      .insert(stepTable)
      .values({
        id: fixId,
        buildId,
        kind: 'session',
        status: 'claimed',
        checkpointCommit: FIX_HEAD,
        createdAt: Date.now() + 5_000,
      })
      .run();
    w.s.db
      .update(stepTable)
      .set({ status: 'done', finishedAt: Date.now() + 6_000 })
      .where(eq(stepTable.id, fixId))
      .run();
    w.enqueueVerify(buildId);
    const verifies = w.stepsOf(buildId).filter((row) => row.kind === 'verify');
    expect(verifies).toHaveLength(2);
    const heads = verifies.map((row) => parseVerifyPromptMeta(row.prompt)?.expectedHeadSha);
    expect(heads).toEqual(expect.arrayContaining([HEAD, FIX_HEAD]));
  });
});

test.each(['attachments', 'repository'] as const)(
  'first verify snapshots %s once; later enqueues retain it and new builds pick up edits',
  async (evidenceStore) => {
    world = await setup();
    const w = world;
    const buildId = await w.startBuild();
    const projectId = w.todoRow().projectId;
    w.s.db.update(projectTable).set({ evidenceStore }).where(eq(projectTable.id, projectId)).run();
    const author = await w.claim();
    await w.done(author.stepId, { status: 'success', hasChanges: true, commit: HEAD });
    w.enqueueVerify(buildId);
    const firstSnapshot = w.s.db
      .select()
      .from(buildTable)
      .where(eq(buildTable.id, buildId))
      .get()?.evidenceStore;
    expect(firstSnapshot).toBe(evidenceStore);
    const firstVerify = w.stepsOf(buildId).find((row) => row.kind === 'verify');
    const firstMeta = parseVerifyPromptMeta(firstVerify?.prompt ?? null);
    if (evidenceStore === 'attachments')
      expect(firstMeta).toHaveProperty('evidence', 'attachments');
    else expect(firstVerify?.prompt).toContain('docs/verify/');

    const nextMode = evidenceStore === 'attachments' ? 'repository' : 'attachments';
    w.s.db
      .update(projectTable)
      .set({ evidenceStore: nextMode })
      .where(eq(projectTable.id, projectId))
      .run();
    w.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.buildId, buildId)).run();
    maybeEnqueueVerifyStep(w.s.svc, w.todoRow(), buildId, { reverify: true });
    const pending = w
      .stepsOf(buildId)
      .find((row) => row.kind === 'verify' && row.status === 'pending');
    expect(pending).toBeDefined();
    expect(parseVerifyPromptMeta(pending?.prompt ?? null)).toEqual(firstMeta);
    const laterSnapshot = w.s.db
      .select()
      .from(buildTable)
      .where(eq(buildTable.id, buildId))
      .get()?.evidenceStore;
    expect(laterSnapshot).toBe(evidenceStore);

    w.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.buildId, buildId)).run();
    w.s.db.update(todoTable).set({ phase: 'review' }).where(eq(todoTable.id, w.todoId)).run();
    const nextBuild = await w.startBuild();
    expect(
      w.s.db.select().from(buildTable).where(eq(buildTable.id, nextBuild)).get()?.evidenceStore,
    ).toBeNull();
    const nextAuthor = await w.claim();
    await w.done(nextAuthor.stepId, { status: 'success', hasChanges: true, commit: FIX_HEAD });
    w.enqueueVerify(nextBuild);
    expect(
      w.s.db.select().from(buildTable).where(eq(buildTable.id, nextBuild)).get()?.evidenceStore,
    ).toBe(nextMode);
    const evidenceDirectory = process.env.VERIFY_EVIDENCE_DIR;
    if (evidenceDirectory !== undefined) {
      mkdirSync(evidenceDirectory, { recursive: true });
      writeFileSync(
        join(evidenceDirectory, `snapshot-${evidenceStore}.json`),
        JSON.stringify(
          {
            firstSnapshot,
            firstPromptMeta: firstMeta,
            laterSnapshot,
            laterPromptMeta: parseVerifyPromptMeta(pending?.prompt ?? null),
            editedProjectMode: w.s.db
              .select()
              .from(projectTable)
              .where(eq(projectTable.id, projectId))
              .get()?.evidenceStore,
            newBuildSnapshot: w.s.db
              .select()
              .from(buildTable)
              .where(eq(buildTable.id, nextBuild))
              .get()?.evidenceStore,
          },
          null,
          2,
        ),
      );
    }
  },
);

test('a failed verify enqueue rolls back its evidence snapshot and announcement', async () => {
  world = await setup();
  const w = world;
  const buildId = await w.startBuild();
  const author = await w.claim();
  await w.done(author.stepId, { status: 'success', hasChanges: true, commit: HEAD });
  w.s.db.run(
    sql`CREATE TRIGGER reject_verify BEFORE INSERT ON step WHEN NEW.kind = 'verify' BEGIN SELECT RAISE(ABORT, 'verify enqueue rejected'); END;`,
  );
  expect(() => w.enqueueVerify(buildId)).toThrow('verify enqueue rejected');
  expect(
    w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()?.evidenceStore,
  ).toBeNull();
  expect(w.stepsOf(buildId).filter((row) => row.kind === 'verify')).toHaveLength(0);
  expect(
    w.s.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, buildId))
      .all()
      .some((row) => row.content === VERIFY_ANNOUNCEMENT),
  ).toBe(false);
});

test.each(['attachments', 'repository'] as const)(
  'legacy claim cannot take %s attachment-only work without a current-request capability',
  async (evidenceStore) => {
    world = await setup();
    const w = world;
    const buildId = await w.startBuild();
    w.s.db
      .update(projectTable)
      .set({ evidenceStore })
      .where(eq(projectTable.id, w.todoRow().projectId))
      .run();
    const author = await w.claim();
    await w.done(author.stepId, { status: 'success', hasChanges: true, commit: HEAD });
    w.enqueueVerify(buildId);
    if (evidenceStore === 'repository') {
      expect((await w.tryClaim(false))?.kind).toBe('verify');
      return;
    }
    expect(await w.tryClaim(false)).toBeNull();
    expect(w.stepsOf(buildId).find((row) => row.kind === 'verify')?.status).toBe('pending');
    const verifier = await w.claim();
    expect(verifier.kind).toBe('verify');
    await w.done(verifier.stepId, {
      status: 'success',
      commit: HEAD,
      verifyVerdict: { passed: true, conclusion: 'checked', evidence: [] },
    });
    maybeEnqueueVerifyStep(w.s.svc, w.todoRow(), buildId, { reverify: true });
    expect(await w.tryClaim(false)).toBeNull();
    expect((await w.claim()).kind).toBe('verify');
  },
);
