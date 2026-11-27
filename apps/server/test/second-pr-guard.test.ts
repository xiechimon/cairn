import type { ClaimedStep, MachineDoneBody } from '@cairn/shared';
import {
  buildMergedPrGuardInstruction,
  buildMergedPrGuardNote,
  buildRestartPrompt,
  buildSecondPrWarningNote,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  build as buildTable,
  machine as machineTable,
  message as messageTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { HttpError } from '../src/lib/errors.js';
import { newUuidv7, nowMs } from '../src/lib/ids.js';
import { requestMerge } from '../src/services/build-merge-request.js';
import type { BuildDeps } from '../src/services/builds.js';
import { claimStep, type MachineDeps } from '../src/services/machines.js';
import { githubFake } from './fakes/github.js';
import { stubGithubApp } from './github-identity-fixture.js';
import { bootServer, finishStepForClaim, seedSessionRoute } from './helpers.js';

const PR1_URL = 'https://github.com/demo-owner/demo-repo/pull/888';
const PR1_NUMBER = 888;
const PR2_URL = 'https://github.com/demo-owner/demo-repo/pull/999';
const PR2_NUMBER = 999;
const REPO = 'demo-owner/demo-repo';
const REPO_PATH = `/repos/${REPO}`;

afterEach(() => vi.restoreAllMocks());

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

interface WorldOpts {
  pulls?: Record<number, { state: 'open' | 'closed'; merged: boolean }>;
  b1PrFields?: boolean;
  b2PrFields?: boolean;
  todoPhase?: (typeof todoTable.$inferSelect)['phase'];
  stepKind?: 'plan' | 'build';
  stepCount?: number;
}

function makeWorld(opts: WorldOpts = {}) {
  const github = githubFake(REPO, { repositoryId: 4242 });
  for (const [number, state] of Object.entries(opts.pulls ?? {})) {
    github.state.pulls.set(Number(number), state);
  }
  const githubFetch = github.impl;
  const s = bootServer({ githubFetch });
  stubGithubApp(null);
  disposables.push(() => s.dispose());
  const base = nowMs();
  const suffix = Math.random().toString(36).slice(2);
  const projectId = `proj-${suffix}`;
  const todoId = `todo-${suffix}`;
  const b1Id = newUuidv7();
  const b2Id = newUuidv7();
  const machineAId = `machine-a-${suffix}`;
  const machineBId = `machine-b-${suffix}`;
  s.db
    .insert(projectTable)
    .values({
      id: projectId,
      name: `second-pr-${suffix}`,
      teamId: s.team.id,
      repoKind: 'github',
      githubRepo: REPO,
    })
    .run();
  for (const [id, name] of [
    [machineAId, `guard-a-${suffix}`],
    [machineBId, `guard-b-${suffix}`],
  ] as const) {
    s.db
      .insert(machineTable)
      .values(
        readyMachine({
          id,
          teamId: s.team.id,
          name,
          online: true,
          capabilities: {
            mcpServers: [],
            skills: [],
            githubPush: {
              login: 'ok',
              checkedAt: base,
              repos: [{ repo: REPO, state: 'write', checkedAt: base }],
            },
          },
        }),
      )
      .run();
  }
  seedSessionRoute(s, {
    provider: 'stub-gw',
    modelId: 'stub-model',
    machineId: machineBId,
    tools: ['合并分支', '推送分支'],
  });
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: s.team.id,
      projectId,
      title: '守卫探针',
      spec: '首 PR 合并后重跑，不得开出第二张 PR。',
      phase: opts.todoPhase ?? 'queued',
      phaseAt: base,
      seqNum: 30,
      hasPlan: true,
      latestBuildId: b2Id,
      v: 1,
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: b1Id,
      todoId,
      withPlan: true,
      prevPhase: 'review',
      triggerSource: 'user',
      planDocId: null,
      errorMessage: null,
      prUrl: opts.b1PrFields === false ? null : PR1_URL,
      prNumber: opts.b1PrFields === false ? null : PR1_NUMBER,
      changes: null,
      diffHash: null,
      createdAt: base - 120_000,
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: b2Id,
      todoId,
      withPlan: true,
      prevPhase: 'done',
      triggerSource: 'schedule',
      planDocId: null,
      errorMessage: null,
      prUrl: opts.b2PrFields ? PR2_URL : null,
      prNumber: opts.b2PrFields ? PR2_NUMBER : null,
      changes: null,
      diffHash: null,
      createdAt: base - 60_000,
    })
    .run();
  const stepCount = opts.stepCount ?? 1;
  for (let i = 0; i < stepCount; i += 1) {
    s.db
      .insert(stepTable)
      .values({
        id: `step-1217-${suffix}-${i}`,
        buildId: b2Id,
        kind: opts.stepKind ?? 'build',
        status: opts.todoPhase === 'review' ? 'done' : 'pending',
        machineId: null,
        createdAt: base - 50_000 + i,
      })
      .run();
  }
  const deps: BuildDeps = {
    ...s.svc,
    reposDir: s.reposDir,
    box: s.secretBox,
    githubFetch,
  };
  const machineDeps: MachineDeps = {
    ...s.svc,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    box: s.secretBox,
    githubFetch,
  };
  return { s, deps, machineDeps, github, teamId: s.team.id, todoId, b1Id, b2Id, machineBId };
}

function messagesOf(w: ReturnType<typeof makeWorld>, conversationId: string) {
  return w.s.db
    .select()
    .from(messageTable)
    .where(eq(messageTable.conversationId, conversationId))
    .all();
}

function stepsOf(w: ReturnType<typeof makeWorld>, buildId: string) {
  return w.s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
}

describe('#1217 the second-PR-per-todo guard (claim surface + merge surface + backfill surface)', () => {
  test('failure mode 1: the first PR merged -> the next build first-step claim carries the guard + the conv gets a guard note', async () => {
    const w = makeWorld({
      pulls: { [PR1_NUMBER]: { state: 'closed', merged: true } },
    });
    const got = (await claimStep(
      w.machineDeps,
      w.machineBId,
      w.teamId,
      10,
      'http://localhost',
    )) as ClaimedStep | null;
    expect(got).not.toBeNull();
    expect(got!.instruction).toBe(
      buildMergedPrGuardInstruction({ prNumber: PR1_NUMBER, prUrl: PR1_URL }),
    );
    expect(String(got!.instruction)).toContain(`PR #${PR1_NUMBER}`);
    expect(String(got!.instruction)).toContain('gh pr create');
    const notes = messagesOf(w, w.b2Id).filter(
      (m) =>
        m.role === 'system' &&
        m.content === buildMergedPrGuardNote({ prNumber: PR1_NUMBER, prUrl: PR1_URL }),
    );
    expect(notes).toHaveLength(1);
  });

  test('failure mode 2: a restart-merged new-branch round -> the guard is appended as the last line (the original instruction not swallowed)', async () => {
    const w = makeWorld({
      todoPhase: 'queued',
      stepKind: 'plan',
      pulls: { [PR1_NUMBER]: { state: 'closed', merged: true } },
    });
    const restartPrompt = buildRestartPrompt('合并后再补一步');
    w.s.db
      .update(stepTable)
      .set({ prompt: restartPrompt })
      .where(eq(stepTable.buildId, w.b2Id))
      .run();
    const got = (await claimStep(
      w.machineDeps,
      w.machineBId,
      w.teamId,
      10,
      'http://localhost',
    )) as ClaimedStep | null;
    expect(got).not.toBeNull();
    expect(got!.instruction).toBe(
      `${restartPrompt}\n${buildMergedPrGuardInstruction({ prNumber: PR1_NUMBER, prUrl: PR1_URL })}`,
    );
  });

  test('failure mode 3: the first PR merged + this build opened a second PR -> requestMerge 409 naming the double PR', async () => {
    const w = makeWorld({
      todoPhase: 'review',
      b2PrFields: true,
      pulls: { [PR1_NUMBER]: { state: 'closed', merged: true } },
    });
    let refused: unknown;
    try {
      await requestMerge(w.deps, w.b2Id, 'tester');
      throw new Error('expected requestMerge to refuse');
    } catch (err) {
      refused = err;
    }
    expect(refused).toBeInstanceOf(HttpError);
    expect((refused as HttpError).status).toBe(409);
    expect((refused as HttpError).message).toContain(`#${PR1_NUMBER}`);
    expect((refused as HttpError).message).toContain(`#${PR2_NUMBER}`);
    expect(messagesOf(w, w.b2Id).some((m) => m.content === '发起了合并')).toBe(false);
    expect(stepsOf(w, w.b2Id).some((st) => st.kind === 'merge')).toBe(false);
  });

  test('failure mode 4: this build own PR merged (the only PR build) -> the guard does not block (self excluded), reaching the next gate', async () => {
    const w = makeWorld({
      todoPhase: 'review',
      b1PrFields: false,
      b2PrFields: true,
      pulls: { [PR2_NUMBER]: { state: 'closed', merged: true } },
    });
    const refused = await requestMerge(w.deps, w.b2Id, 'tester').then(
      () => null,
      (err: unknown) => err,
    );
    expect(refused).toBeInstanceOf(HttpError);
    expect((refused as HttpError).status).toBe(409);
    expect((refused as HttpError).message).toContain('连接 GitHub');
    expect((refused as HttpError).message).not.toContain(`#${PR1_NUMBER}`);
    expect(messagesOf(w, w.b2Id).some((m) => m.content === '发起了合并')).toBe(false);
    expect(stepsOf(w, w.b2Id).some((st) => st.kind === 'merge')).toBe(false);
  });

  test('failure mode 5: the first PR closed-unmerged -> no guard on claim, the merge-surface guard does not block (a legitimate rework re-submission)', async () => {
    const w = makeWorld({
      pulls: { [PR1_NUMBER]: { state: 'closed', merged: false } },
    });
    const got = (await claimStep(
      w.machineDeps,
      w.machineBId,
      w.teamId,
      10,
      'http://localhost',
    )) as ClaimedStep | null;
    expect(got).not.toBeNull();
    expect(got!.instruction).toBeUndefined();
    expect(messagesOf(w, w.b2Id)).toHaveLength(0);
    w.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.buildId, w.b2Id)).run();
    w.s.db
      .update(todoTable)
      .set({ phase: 'review', phaseAt: nowMs() })
      .where(eq(todoTable.id, w.todoId))
      .run();
    w.s.db
      .update(buildTable)
      .set({ prUrl: PR2_URL, prNumber: PR2_NUMBER })
      .where(eq(buildTable.id, w.b2Id))
      .run();
    const refused = await requestMerge(w.deps, w.b2Id, 'tester').then(
      () => null,
      (err: unknown) => err,
    );
    expect(refused).toBeInstanceOf(HttpError);
    expect((refused as HttpError).message).toContain('连接 GitHub');
    expect((refused as HttpError).message).not.toContain(`#${PR1_NUMBER}`);
  });

  test('failure mode 6: the PR probe fails -> no guard on claim', async () => {
    const w = makeWorld();
    const prPath = `${REPO_PATH}/pulls/${PR1_NUMBER}`;
    w.github.overrides.set(prPath, () => ({ status: 503 }));
    const got = (await claimStep(
      w.machineDeps,
      w.machineBId,
      w.teamId,
      10,
      'http://localhost',
    )) as ClaimedStep | null;
    expect(got).not.toBeNull();
    expect(w.github.calls.map(({ path, status }) => [path, status])).toEqual([
      [prPath, 503],
      [REPO_PATH, 200],
    ]);
    expect(got!.instruction).toBeUndefined();
    expect(messagesOf(w, w.b2Id)).toHaveLength(0);
  });

  test('failure mode 7: no earlier PR build -> claim only probes the repository, instruction default', async () => {
    const w = makeWorld({ b1PrFields: false });
    const got = (await claimStep(
      w.machineDeps,
      w.machineBId,
      w.teamId,
      10,
      'http://localhost',
    )) as ClaimedStep | null;
    expect(got).not.toBeNull();
    expect(w.github.calls.map((call) => call.path)).toEqual([REPO_PATH]);
    expect(got!.instruction).toBeUndefined();
    expect(messagesOf(w, w.b2Id)).toHaveLength(0);
  });

  test('failure mode 8: two steps of one build claim in turn -> the guard note does not stack (idempotent)', async () => {
    const w = makeWorld({
      stepCount: 2,
      pulls: { [PR1_NUMBER]: { state: 'closed', merged: true } },
    });
    const first = await claimStep(w.machineDeps, w.machineBId, w.teamId, 10, 'http://localhost');
    expect(first).not.toBeNull();
    const second = await claimStep(w.machineDeps, w.machineBId, w.teamId, 10, 'http://localhost');
    expect(second).not.toBeNull();
    const guardNotes = messagesOf(w, w.b2Id).filter(
      (m) =>
        m.role === 'system' &&
        m.content === buildMergedPrGuardNote({ prNumber: PR1_NUMBER, prUrl: PR1_URL }),
    );
    expect(guardNotes).toHaveLength(1);
  });

  test('failure mode 8b: the agent ignores the guard and opens a second PR -> the done backfill surface writes a warning note', async () => {
    const w = makeWorld({
      todoPhase: 'building',
      pulls: { [PR1_NUMBER]: { state: 'closed', merged: true } },
    });
    const stepId = stepsOf(w, w.b2Id)[0]!.id;
    w.s.db
      .update(stepTable)
      .set({
        status: 'claimed',
        machineId: w.machineBId,
        claimedAt: nowMs(),
        lastHeartbeatAt: nowMs(),
      })
      .where(eq(stepTable.id, stepId))
      .run();
    const body: MachineDoneBody = {
      status: 'success',
      hasChanges: true,
      prUrl: PR2_URL,
      prNumber: PR2_NUMBER,
    };
    await finishStepForClaim(w.machineDeps, w.machineBId, stepId, body);
    const warnings = messagesOf(w, w.b2Id).filter(
      (m) =>
        m.role === 'system' &&
        m.content ===
          buildSecondPrWarningNote({
            prNumber: PR2_NUMBER,
            mergedPrNumber: PR1_NUMBER,
            mergedPrUrl: PR1_URL,
          }),
    );
    expect(warnings).toHaveLength(1);
  });
});
