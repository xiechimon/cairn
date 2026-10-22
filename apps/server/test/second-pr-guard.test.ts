// #1217 同 todo 第二张 PR 守卫（server 面）：todo 的首张 PR 已在 GitHub 合并
// 后，后续 build 不得再开新 PR——claim 面给 plan/build 步的 instruction 尾部
// 追加守卫指令（agent 侧预防），新 conv 落 system note（板面可见）；合并面
// （requestMerge）拒收「同 todo 已有 merged PR 且本 build 自己开了 PR」的合并
// 请求（409 点名双 PR）；agent 无视守卫仍开出第二张 PR 时，done 回填面落警告
// note（PR 面可见）。判据 = GitHub merged 真值（githubPullState 探测，fail-open
// ——探测不到不拦，与 #931 restart 判定同思路），不信本地 git 祖先。
// 实锤：卡 #25 首 PR #1202 合并后，重跑轮又从 conv 分支开了第二张 PR #1205
// 并被合并——同一 todo 两张 PR 先后落地。
// 失败方式（先于实现固化，AGENTS.md 测试规则 3）：
//  1. 第二 PR 无声落地（本票 bug 现状）：首 PR merged 后的后续 build 首步
//     claim → instruction 必须带守卫（点名已合并 PR），conv 必须落守卫 note
//  2. 守卫与既有指令叠加坏形：restart-merged 新分支轮（instruction =
//     restartPrompt）→ 守卫以尾行拼接（不吞噬原指令、不双注）
//  3. 合并面照放行：首 PR merged + 本 build 自己开了 PR → requestMerge 必须
//     409 点名双 PR，且不落 MERGE_ANNOUNCEMENT、不入队 merge 步
//  4. 正常落地路被误拦：本 build 自己的 PR merged（唯一 PR build）→
//     守卫排除自身 PR、不按双 PR 拒（#1403 段 2b 起 GitHub 形态有 PR 的合并经
//     GitHub API，未连接 GitHub 时由下一道闸 409 请连接）
//  5. 合法返工重投被误拦：首 PR closed-unmerged → claim 无守卫无 note、
//     合并面守卫不拦（返工重开 PR 是正当路径）
//  6. 探测失败误拦：GitHub 不可达 → fail-open（claim 无守卫、merge 202）
//  7. 常规首 PR 流程被误改：无更早 PR build → claim 不出站探测（mock 被调
//     即测试红）、instruction 缺省、无 note
//  8. note 叠行：同 build 两步先后 claim / done 回填 → 守卫与警告 note 各至
//     多一行（deterministic id 幂等）
//  9. 守卫行冒充用户话语：guard 形指令行（裸守卫 / restartPrompt+守卫 / 任务
//     文本+守卫组合行）classifyUserText 必须判 synthetic（呈现面退场，可见
//     性由 system note 承担——#612 词表纪律）

import type { ClaimedStep, MachineDoneBody } from '@pacman/shared';
import {
  buildMergedPrGuardInstruction,
  buildMergedPrGuardNote,
  buildRestartPrompt,
  buildSecondPrWarningNote,
  classifyUserText,
  composeTaskPromptWithInstruction,
} from '@pacman/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  machine as machineTable,
  message as messageTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { HttpError } from '../src/lib/errors.js';
import type { FetchLike } from '../src/lib/github.js';
import { newUuidv7, nowMs } from '../src/lib/ids.js';
import { type BuildDeps, requestMerge } from '../src/services/builds.js';
import { claimStep, finishStep, type MachineDeps } from '../src/services/machines.js';
import { bootServer, type TestServer } from './helpers.js';

const AGENT_ID = 'agent-1217-1';
const PR1_URL = 'https://github.com/demo-owner/demo-repo/pull/888';
const PR1_NUMBER = 888;
const PR2_URL = 'https://github.com/demo-owner/demo-repo/pull/999';
const PR2_NUMBER = 999;

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

interface World {
  s: TestServer;
  deps: BuildDeps;
  machineDeps: MachineDeps;
  teamId: string;
  todoId: string;
  /** 首 build（带 PR 字段——直插模拟 daemon 回填）。 */
  b1Id: string;
  /** 后续 build（守卫的目标轮）。 */
  b2Id: string;
  machineAId: string;
  machineBId: string;
}

interface WorldOpts {
  /** github 探测 mock（githubFetch 注入位；缺省 = 被调即红的哨兵——守卫不该
   * 在无先前 PR build 的世界上出站）。 */
  githubFetch?: FetchLike;
  /** 首 build 的 PR 字段；缺省带（本票语义面）。 */
  b1PrFields?: boolean;
  /** B2 的 PR 字段（合并面场景：本 build 自己开了第二张 PR）；缺省不带。 */
  b2PrFields?: boolean;
  /** todo 相位；缺省 queued（claim 面）。 */
  todoPhase?: (typeof todoTable.$inferSelect)['phase'];
  /** B2 待领步的 kind；缺省 build。 */
  stepKind?: 'plan' | 'build';
  /** B2 待领步条数；缺省 1。 */
  stepCount?: number;
}

function makeWorld(opts: WorldOpts = {}): World {
  const s = bootServer(opts.githubFetch !== undefined ? { githubFetch: opts.githubFetch } : {});
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
      githubRepo: 'demo-owner/demo-repo',
    })
    .run();
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId: s.team.id,
      displayName: 'second-pr-builder',
      provider: 'stub-gw',
      modelId: 'stub-model',
      tools: ['合并分支', '推送分支'],
    })
    .onConflictDoNothing()
    .run();
  for (const [id, name] of [
    [machineAId, `guard-a-${suffix}`],
    [machineBId, `guard-b-${suffix}`],
  ] as const) {
    s.db
      .insert(machineTable)
      .values({ id, teamId: s.team.id, name, online: true, enabledRuntimes: ['pi'] })
      .run();
  }
  // #1259：认领面在 B——agent 显式绑 B（agent 插在机器前，FK 故绑放机器后）。
  s.db.update(agentTable).set({ machineId: machineBId }).where(eq(agentTable.id, AGENT_ID)).run();
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
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
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
        status: 'pending',
        machineId: null,
        createdAt: base - 50_000 + i,
      })
      .run();
  }
  const deps: BuildDeps = {
    ...s.svc,
    reposDir: s.reposDir,
    box: s.secretBox,
    ...(opts.githubFetch !== undefined ? { githubFetch: opts.githubFetch } : {}),
  };
  const machineDeps = {
    ...s.svc,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    box: s.secretBox,
    ...(opts.githubFetch !== undefined ? { githubFetch: opts.githubFetch } : {}),
  };
  return { s, deps, machineDeps, teamId: s.team.id, todoId, b1Id, b2Id, machineAId, machineBId };
}

/** github 探测 mock：按 PR 号给状态（merged / closed / open / 不可达）。 */
function prFetchMock(
  states: Record<number, { state: 'open' | 'closed'; merged: boolean }>,
): FetchLike {
  return (async (url: string) => {
    for (const [num, st] of Object.entries(states)) {
      if (String(url).endsWith(`/pulls/${num}`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ state: st.state, merged: st.merged }),
          headers: { get: () => null },
        };
      }
    }
    return { ok: false, status: 404, json: async () => ({}), headers: { get: () => null } };
  }) as unknown as FetchLike;
}

function messagesOf(w: World, conversationId: string) {
  return w.s.db
    .select()
    .from(messageTable)
    .where(eq(messageTable.conversationId, conversationId))
    .all();
}

function stepsOf(w: World, buildId: string) {
  return w.s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
}

describe('#1217 同 todo 第二张 PR 守卫（claim 面 + 合并面 + 回填面）', () => {
  test('失败方式 1：首 PR merged → 后续 build 首步 claim 带守卫 + conv 落守卫 note', async () => {
    const w = makeWorld({
      githubFetch: prFetchMock({ [PR1_NUMBER]: { state: 'closed', merged: true } }),
    });
    const got = (await claimStep(
      w.machineDeps,
      w.machineBId,
      w.teamId,
      10,
      'http://localhost',
    )) as ClaimedStep | null;
    expect(got).not.toBeNull();
    // 守卫指令：裸守卫形（原 prompt null → 守卫独占 instruction），点名 PR #888。
    expect(got!.instruction).toBe(
      buildMergedPrGuardInstruction({ prNumber: PR1_NUMBER, prUrl: PR1_URL }),
    );
    expect(String(got!.instruction)).toContain(`PR #${PR1_NUMBER}`);
    expect(String(got!.instruction)).toContain('gh pr create');
    // 板面可见：B2 conv 落 system note（不冒充用户话语）。
    const notes = messagesOf(w, w.b2Id).filter(
      (m) =>
        m.role === 'system' &&
        m.content === buildMergedPrGuardNote({ prNumber: PR1_NUMBER, prUrl: PR1_URL }),
    );
    expect(notes).toHaveLength(1);
  });

  test('失败方式 2：restart-merged 新分支轮 → 守卫以尾行拼接（不吞噬原指令）', async () => {
    const w = makeWorld({
      todoPhase: 'queued',
      stepKind: 'plan',
      githubFetch: prFetchMock({ [PR1_NUMBER]: { state: 'closed', merged: true } }),
    });
    // 模拟 restart 落下的 prompt（#931 新分支轮 = restartPrompt）。
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
    // 原指令在前、守卫以尾行拼接（单换行，appendPlanLocationNote 同律）。
    expect(got!.instruction).toBe(
      `${restartPrompt}\n${buildMergedPrGuardInstruction({ prNumber: PR1_NUMBER, prUrl: PR1_URL })}`,
    );
  });

  test('失败方式 3：首 PR merged + 本 build 开了第二张 PR → requestMerge 409 点名双 PR', async () => {
    const w = makeWorld({
      todoPhase: 'review',
      b2PrFields: true,
      githubFetch: prFetchMock({ [PR1_NUMBER]: { state: 'closed', merged: true } }),
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
    // 拒收即无痕：不落 MERGE_ANNOUNCEMENT、不入队 merge 步。
    expect(messagesOf(w, w.b2Id).some((m) => m.content === '发起了合并')).toBe(false);
    expect(stepsOf(w, w.b2Id).some((st) => st.kind === 'merge')).toBe(false);
  });

  test('失败方式 4：本 build 自己的 PR merged（唯一 PR build）→ 守卫不拦（排除自身），走到下一道闸', async () => {
    const w = makeWorld({
      todoPhase: 'review',
      b1PrFields: false,
      b2PrFields: true,
      githubFetch: prFetchMock({ [PR2_NUMBER]: { state: 'closed', merged: true } }),
    });
    // B2 自身 PR 已合并（人在 GitHub 合的）→ 守卫排除自身，不按双 PR 拒。#1403 段 2b：
    // GitHub 形态、build 有 PR 的合并由 server 经 GitHub API 发起，本世界没连 GitHub →
    // 下一道闸 409 请连接（不落行、不入队合并步；PR 已合并时对账会收尾）。
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

  test('失败方式 5：首 PR closed-unmerged → claim 无守卫、合并面守卫不拦（合法返工重投）', async () => {
    const w = makeWorld({
      githubFetch: prFetchMock({ [PR1_NUMBER]: { state: 'closed', merged: false } }),
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
    // 返工重投（B2 自己开新 PR 后请求合并）不受守卫拦。
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
    // 守卫不拦；#1403 段 2b：下一道闸是 GitHub 连接（未连接 = 409 请连接，不是双 PR 拒）。
    const refused = await requestMerge(w.deps, w.b2Id, 'tester').then(
      () => null,
      (err: unknown) => err,
    );
    expect(refused).toBeInstanceOf(HttpError);
    expect((refused as HttpError).message).toContain('连接 GitHub');
    expect((refused as HttpError).message).not.toContain(`#${PR1_NUMBER}`);
  });

  test('失败方式 6：探测失败 → fail-open（claim 无守卫、merge 202）', async () => {
    const fetchMock: FetchLike = (async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
      headers: { get: () => null },
    })) as unknown as FetchLike;
    const w = makeWorld({ githubFetch: fetchMock });
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
  });

  test('失败方式 7：无更早 PR build → claim 不出站探测（哨兵 mock 被调即红）、instruction 缺省', async () => {
    let probed = false;
    const sentinel: FetchLike = (async () => {
      probed = true;
      throw new Error('guard probed github with no prior PR build');
    }) as unknown as FetchLike;
    const w = makeWorld({ b1PrFields: false, githubFetch: sentinel });
    const got = (await claimStep(
      w.machineDeps,
      w.machineBId,
      w.teamId,
      10,
      'http://localhost',
    )) as ClaimedStep | null;
    expect(got).not.toBeNull();
    expect(probed).toBe(false);
    expect(got!.instruction).toBeUndefined();
    expect(messagesOf(w, w.b2Id)).toHaveLength(0);
  });

  test('失败方式 8：同 build 两步先后 claim → 守卫 note 不叠行（幂等）', async () => {
    const w = makeWorld({
      stepCount: 2,
      githubFetch: prFetchMock({ [PR1_NUMBER]: { state: 'closed', merged: true } }),
    });
    // #1259：同 agent 两步恒同机（归属机 B）——第二步也走 B 领。
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

  test('失败方式 8b：agent 无视守卫开出第二张 PR → done 回填面落警告 note', async () => {
    const w = makeWorld({
      todoPhase: 'building',
      githubFetch: prFetchMock({ [PR1_NUMBER]: { state: 'closed', merged: true } }),
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
    await finishStep(w.machineDeps, w.machineBId, stepId, body);
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

  test('失败方式 9：guard 形指令行不冒充用户话语（classifyUserText 全判 synthetic）', () => {
    const task = { title: '守卫探针', spec: '首 PR 合并后重跑，不得开出第二张 PR。' };
    const guard = buildMergedPrGuardInstruction({ prNumber: PR1_NUMBER, prUrl: PR1_URL });
    // 裸守卫（原 prompt null 的 claim 形，daemon 续轮投递）。
    expect(classifyUserText(guard, task)).toBe('synthetic');
    // restartPrompt + 守卫尾行。
    expect(classifyUserText(`${buildRestartPrompt('合并后再补一步')}\n${guard}`, task)).toBe(
      'synthetic',
    );
    // 任务文本 + 守卫（新会话首轮组合行，#720 形）。
    expect(
      classifyUserText(
        composeTaskPromptWithInstruction(`${task.title}\n\n${task.spec}`, guard),
        task,
      ),
    ).toBe('synthetic');
  });
});
