// #1473 回报只对当前这次领取生效（verify-step-claim F2 / P2 的 server 半）。
// 失败方式（先于实现固化）：
//   1. 重领后旧回报叠写：步被扫尾放回 pending、同机重领，在飞那份的 done 落
//      账后，再来一份 done（重放 / 第二个执行者）又把步和卡片改一遍
//      （review → failed）。
//   2. 迟到回报复活已停的步：卡已关、扫尾把失联步停掉（stopped），原执行者
//      迟到的 done 仍把步写成 done / failed。
//   3. 迟到回报不回收凭证：上一条拒写时连 per-step git 凭证也留着（XMON-59
//      重放契约：重报答 ok，凭证随步收尾回收）。
//   4. await 窗口内换了领取：success 回报过了所有权校验后在 GitHub 探测里
//      等待，期间步被放回 pending 又被领走，await 回来照写 done——新领取
//      被旧回报收掉。

import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  apiKey as apiKeyTable,
  build as buildTable,
  machine as machineTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { HttpError } from '../src/lib/errors.js';
import type { FetchLike } from '../src/lib/github.js';
import { nowMs } from '../src/lib/ids.js';
import { BUILD_ABANDONED_STEP_MS, sweepAbandonedBuildSteps } from '../src/services/builds.js';
import { issueStepGitCredential } from '../src/services/credentials.js';
import { claimStep, finishStep, type MachineDeps } from '../src/services/machines.js';
import { bootServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

const MACHINE = 'machine-m1';
const STEP = 'step-1473';
const CARD_ID = 'todo-1473';
const PRIOR_PR = 777;

interface WorldOpts {
  githubFetch?: FetchLike;
  /** 同 todo 带一张更早的 PR（finishStep 回填新 PR 时会去 GitHub 探测它）。 */
  priorPr?: boolean;
}

function makeWorld(opts: WorldOpts = {}) {
  const s = bootServer(opts.githubFetch !== undefined ? { githubFetch: opts.githubFetch } : {});
  disposables.push(() => s.dispose());
  const teamId = s.team.id;
  const base = nowMs();
  s.db
    .insert(projectTable)
    .values({
      id: 'proj-1473',
      name: 'p1473',
      teamId,
      repoKind: 'github',
      githubRepo: 'demo-owner/demo-repo',
    })
    .run();
  s.db
    .insert(machineTable)
    .values({ id: MACHINE, teamId, name: 'm1', online: true, enabledRuntimes: ['pi'] })
    .run();
  s.db
    .insert(agentTable)
    .values({
      id: 'agent-1473',
      teamId,
      displayName: 'p1473',
      modelId: 'stub-model',
      machineId: MACHINE,
    })
    .run();
  s.db
    .insert(todoTable)
    .values({
      id: CARD_ID,
      teamId,
      projectId: 'proj-1473',
      title: 'p1473',
      phase: 'building',
      phaseAt: base,
      seqNum: 1,
      assignment: { plan: null, build: { agentId: 'agent-1473' } },
    })
    .run();
  if (opts.priorPr) {
    s.db
      .insert(buildTable)
      .values({
        id: 'build-1473-prior',
        todoId: CARD_ID,
        withPlan: false,
        triggerSource: 'user',
        prUrl: `https://github.com/demo-owner/demo-repo/pull/${PRIOR_PR}`,
        prNumber: PRIOR_PR,
        createdAt: base - 60_000,
      })
      .run();
  }
  s.db
    .insert(buildTable)
    .values({
      id: 'build-1473',
      todoId: CARD_ID,
      withPlan: false,
      triggerSource: 'user',
      createdAt: base,
    })
    .run();
  s.db
    .insert(stepTable)
    .values({
      id: STEP,
      buildId: 'build-1473',
      kind: 'build',
      status: 'pending',
      machineId: null,
      createdAt: base,
    })
    .run();
  const deps: MachineDeps = {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    ...(opts.githubFetch !== undefined ? { githubFetch: opts.githubFetch } : {}),
  };
  const stepRow = () => s.db.select().from(stepTable).where(eq(stepTable.id, STEP)).get()!;
  const todoRow = () => s.db.select().from(todoTable).where(eq(todoTable.id, CARD_ID)).get()!;
  const claim = () => claimStep(deps, MACHINE, teamId, 10, 'http://localhost');
  // 扫尾时刻取「领取后 120s+」：在线机器、心跳从未推进 → 放回 pending。
  const sweep = () =>
    sweepAbandonedBuildSteps(
      s.svc,
      (stepRow().claimedAt ?? nowMs()) + BUILD_ABANDONED_STEP_MS + 1_000,
    );
  const credentialCount = () =>
    s.db
      .select()
      .from(apiKeyTable)
      .where(eq(apiKeyTable.name, `git-step-${STEP}`))
      .all().length;
  return { s, deps, teamId, stepRow, todoRow, claim, sweep, credentialCount };
}

/** claimedAt 是毫秒粒度：重领前让时钟走一格，两次领取可分辨。 */
const tick = () => new Promise((r) => setTimeout(r, 5));

describe('#1473 回报只对当前这次领取生效', () => {
  test('放回后同机重领：在飞那份的回报落账，之后的回报不再改动', async () => {
    const w = makeWorld();
    expect((await w.claim())?.step.id).toBe(STEP);
    w.sweep();
    expect(w.stepRow()).toMatchObject({ status: 'pending', machineId: null });
    await tick();
    expect((await w.claim())?.step.id).toBe(STEP);
    await finishStep(w.deps, MACHINE, STEP, { status: 'success', hasChanges: true });
    expect(w.stepRow().status).toBe('done');
    expect(w.todoRow().phase).toBe('review');
    const before = w.todoRow();
    await finishStep(w.deps, MACHINE, STEP, { status: 'failed', errorMessage: 'second report' });
    expect(w.stepRow().status).toBe('done');
    expect(w.todoRow().phase).toBe('review');
    expect(w.todoRow().v).toBe(before.v);
    const buildRow = w.s.db.select().from(buildTable).where(eq(buildTable.id, 'build-1473')).get();
    expect(buildRow?.errorMessage ?? null).toBeNull();
  });

  test('卡已关、扫尾停掉的步：迟到回报不改步，git 凭证被回收', async () => {
    const w = makeWorld();
    await w.claim();
    issueStepGitCredential(w.deps, { teamId: w.teamId, stepId: STEP });
    expect(w.credentialCount()).toBe(1);
    w.s.db.update(todoTable).set({ phase: 'closed' }).where(eq(todoTable.id, CARD_ID)).run();
    w.sweep();
    expect(w.stepRow().status).toBe('stopped');
    await finishStep(w.deps, MACHINE, STEP, {
      status: 'success',
      hasChanges: true,
      sessionId: 'late-session',
    });
    expect(w.stepRow().status).toBe('stopped');
    expect(w.stepRow().sessionId).toBeNull();
    expect(w.todoRow().phase).toBe('closed');
    expect(w.credentialCount()).toBe(0);
  });

  test('GitHub 探测期间步被放回又被领走：回报 409，新领取保持 claimed', async () => {
    let gateProbe = false;
    let probeEntered!: () => void;
    const entered = new Promise<void>((r) => {
      probeEntered = r;
    });
    let releaseProbe!: () => void;
    const released = new Promise<void>((r) => {
      releaseProbe = r;
    });
    const githubFetch = (async () => {
      if (gateProbe) {
        gateProbe = false;
        probeEntered();
        await released;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ state: 'open', merged: false }),
        text: async () => '',
        headers: { get: () => null },
      };
    }) as unknown as FetchLike;
    const w = makeWorld({ githubFetch, priorPr: true });
    await w.claim();
    gateProbe = true;
    const report = finishStep(w.deps, MACHINE, STEP, {
      status: 'success',
      hasChanges: true,
      prUrl: 'https://github.com/demo-owner/demo-repo/pull/778',
      prNumber: 778,
    });
    await entered;
    w.sweep();
    expect(w.stepRow().status).toBe('pending');
    await tick();
    expect((await w.claim())?.step.id).toBe(STEP);
    const reclaimedAt = w.stepRow().claimedAt;
    releaseProbe();
    const err = await report.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(409);
    expect(w.stepRow()).toMatchObject({
      status: 'claimed',
      machineId: MACHINE,
      claimedAt: reclaimedAt,
    });
    expect(w.todoRow().phase).toBe('building');
    const buildRow = w.s.db.select().from(buildTable).where(eq(buildTable.id, 'build-1473')).get();
    expect(buildRow?.prNumber ?? null).toBeNull();
  });
});
