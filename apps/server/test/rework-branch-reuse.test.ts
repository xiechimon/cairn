// #931 返工回原分支（server 面）：failed 重启不再必另起新 conversationId——
// todo 已有产过 PR 的 build 时，restart 复用该 build（buildId ≡ conversationId
// ≡ 分支 cairn/conv-<id>，复用即「原分支 + 原 PR」），强制新会话（用户裁定
// 「只复用分支、上下文真空」）；原 PR 已合并/已关闭时才允许新分支，且判定
// 可见（新 conv 落 system note 点名旧 PR 与新分支——「为什么这次是新 PR」
// 用户可辨）。
// 失败方式（先于实现固化，AGENTS.md 测试规则 3）：
//  1. 复用判定缺席（本 bug 现状）：restart 无脑 newUuidv7 → 有 PR build 时必须
//     不建新 build、反馈行落旧 conv、latestBuildId 不漂移
//  2. 复用轮续接了旧会话：claim 必须强制 new session（freshSession），且会话
//     亲和闸不得把他机挡在返工步之外（新会话无会话文件依赖）
//  3. 失败原因蒸发：errorMessage 清空必须由轮界 note 承接原文
//  4. merged 判定不可见：原 PR 已合并/已关闭仍复用或盲建 → 必须新建 + note
//  5. 探测失败误闭复用路：fail-open 必须落复用（盲开新分支 = 本票 bug 复发）
//  6. 无 PR build 的常规重启被误改：无 PR 字段 → 现行新 build 行为保持
//  7. 存量多 PR build 选错目标：必须落最新 PR build（更旧 = 被取代分支）
//  8. 复用路钉语义漂移：pin 不继承失败轮，回落 todo.machineId
//  9. revision 打回路与 restart 路不同源：复用轮上打回仍不换 build/conv
//     （#701 已钉的边；本票验收要求两路收敛）
// 10. 复用轮纯重启（空白反馈）语义漂移：无反馈行、无 instruction、note 照落

import type { ClaimedStep } from '@cairn/shared';
import {
  buildRestartPrompt,
  buildReviewRejectPrompt,
  buildReworkNewBranchNote,
  buildReworkReuseNote,
  conversationBranch,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  machine as machineTable,
  message as messageTable,
  plan as planTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import { newRecordId, newUuidv7, nowMs } from '../src/lib/ids.js';
import { applyBuildStepAction, type BuildDeps, completeStep } from '../src/services/builds.js';
import { claimStep } from '../src/services/machines.js';
import { setTodoPhase } from '../src/services/todos.js';
import { bindAllAgents, bootServer, type TestServer } from './helpers.js';

const AGENT_ID = 'agent-rework-1';
const PR_URL = 'https://github.com/demo-owner/demo-repo/pull/888';
const PR_NUMBER = 888;

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

interface World {
  s: TestServer;
  deps: BuildDeps;
  teamId: string;
  projectId: string;
  todoId: string;
  /** 已产 PR 的失败 build（restart 的 POST 目标位）。 */
  buildId: string;
  /** 上一轮会话持有机器（prior step 的 machineId）。 */
  machineAId: string;
  /** 他机（返工步的观察领取者）。 */
  machineBId: string;
}

interface WorldOpts {
  /** 项目形态：none（无 repo）/ github（探测路需要）；缺省 none。 */
  repoKind?: 'none' | 'github';
  /** PR 字段（daemon 探测回填的落库形，直插模拟）；缺省 true。 */
  prFields?: boolean;
  /** todo 钉选机器（#682 回落链）；缺省不钉。 */
  /** 复用前的旧会话（prior done 步）；缺省无。 */
  priorSession?: { sessionId: string; machineId: string } | null;
  /** github 探测 mock（githubFetch 注入位）。 */
  githubFetch?: FetchLike;
}

/** 直插 world（machine-session-affinity 同律）：失败 todo + 已产 PR 的 build +
 * 双机 + 可选 prior 会话步。build.errorMessage 带「无人认领」原文（失败方式 3
 * 的承接面）。 */
function makeWorld(opts: WorldOpts = {}): World {
  const s = bootServer(opts.githubFetch !== undefined ? { githubFetch: opts.githubFetch } : {});
  disposables.push(() => s.dispose());
  const base = nowMs();
  const suffix = Math.random().toString(36).slice(2);
  const projectId = `proj-${suffix}`;
  const todoId = `todo-${suffix}`;
  const buildId = newUuidv7();
  const machineAId = `machine-a-${suffix}`;
  const machineBId = `machine-b-${suffix}`;
  s.db
    .insert(projectTable)
    .values({
      id: projectId,
      name: `rework-${suffix}`,
      teamId: s.team.id,
      ...(opts.repoKind === 'github'
        ? { repoKind: 'github', githubRepo: 'demo-owner/demo-repo' }
        : {}),
    })
    .run();
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId: s.team.id,
      displayName: 'rework-builder',
      provider: 'stub-gw',
      modelId: 'stub-model',
    })
    .onConflictDoNothing()
    .run();
  s.db
    .insert(machineTable)
    .values({
      id: machineAId,
      teamId: s.team.id,
      name: `owner-${suffix}`,
      online: true,
      enabledRuntimes: ['pi'],
    })
    .run();
  s.db
    .insert(machineTable)
    .values({
      id: machineBId,
      teamId: s.team.id,
      name: `other-${suffix}`,
      online: true,
      enabledRuntimes: ['pi'],
    })
    .run();
  bindAllAgents(s, machineAId); // #1259：双机世界显式绑 A（会话机 = A）
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: s.team.id,
      projectId,
      title: 'SVG 图标',
      spec: 'README 页首加 SVG 应用图标。',
      phase: 'failed',
      phaseAt: base,
      seqNum: 18,
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      hasPlan: true,
      latestBuildId: buildId,
      v: 1,
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: true,
      prevPhase: 'review',
      triggerSource: 'user',
      planDocId: null,
      errorMessage: '本轮无人认领：团队当前没有在线机器',
      prUrl: opts.prFields === false ? null : PR_URL,
      prNumber: opts.prFields === false ? null : PR_NUMBER,
      changes: null,
      diffHash: null,
      createdAt: base - 60_000,
    })
    .run();
  if (opts.priorSession) {
    s.db
      .insert(stepTable)
      .values({
        id: `step-prior-${suffix}`,
        buildId,
        kind: 'build',
        status: 'done',
        machineId: opts.priorSession.machineId,
        sessionId: opts.priorSession.sessionId,
        createdAt: base - 50_000,
      })
      .run();
  }
  const deps: BuildDeps = {
    ...s.svc,
    reposDir: s.reposDir,
    box: s.secretBox,
    ...(opts.githubFetch !== undefined ? { githubFetch: opts.githubFetch } : {}),
  };
  return { s, deps, teamId: s.team.id, projectId, todoId, buildId, machineAId, machineBId };
}

async function restart(w: World, feedback: string): Promise<void> {
  await applyBuildStepAction(w.deps, w.buildId, {
    action: 'restart',
    feedback,
    clientMessageId: 'cm-931',
  });
}

function buildsOf(w: World) {
  return w.s.db.select().from(buildTable).where(eq(buildTable.todoId, w.todoId)).all();
}

function stepsOf(w: World, buildId: string) {
  return w.s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
}

function messagesOf(w: World, conversationId: string) {
  return w.s.db
    .select()
    .from(messageTable)
    .where(eq(messageTable.conversationId, conversationId))
    .all();
}

function todoRowOf(w: World) {
  return w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
}

describe('#931 失败重启返工回原分支：复用判定（server 面）', () => {
  test('失败方式 1/3：有 PR build → 不建新 build、反馈与轮界 note 落旧 conv、失败原因承接', async () => {
    const w = makeWorld({ priorSession: { sessionId: 'sess-old', machineId: 'm-ghost' } });
    await restart(w, '我要的是svg样式的');

    // 失败方式 1：build 数不变、latestBuildId 不漂移。
    const builds = buildsOf(w);
    expect(builds).toHaveLength(1);
    const todoRow = todoRowOf(w);
    expect(todoRow.latestBuildId).toBe(w.buildId);
    expect(todoRow.phase).toBe('queued');

    // 反馈行 + 轮界 note 落旧 conv（不存在新 conv）。
    const rows = messagesOf(w, w.buildId);
    expect(rows.some((m) => m.role === 'user' && m.content === '我要的是svg样式的')).toBe(true);
    const reuseNote = buildReworkReuseNote({
      prNumber: PR_NUMBER,
      prUrl: PR_URL,
      failureReason: '本轮无人认领：团队当前没有在线机器',
    });
    const note = rows.find((m) => m.role === 'system' && m.content === reuseNote);
    // 失败方式 3：note 承接失败原因原文（errorMessage 清空的承接面）。
    expect(note).toBeDefined();
    expect(reuseNote).toContain('本轮无人认领');
    expect(reuseNote).toContain(`PR #${PR_NUMBER}`);

    // 复用 build 行收尾：errorMessage 清空、prevPhase=failed。
    const buildRow = builds[0]!;
    expect(buildRow.errorMessage).toBeNull();
    expect(buildRow.prevPhase).toBe('failed');

    // 首步：kind=plan（withPlan 承接）、prompt 携反馈模板、freshSession 置位。
    const fresh = stepsOf(w, w.buildId).filter((st) => st.kind === 'plan');
    expect(fresh).toHaveLength(1);
    expect(fresh[0]!.prompt).toBe(buildRestartPrompt('我要的是svg样式的'));
    expect(fresh[0]!.freshSession).toBe(true);
  });

  test('失败方式 2：复用步 claim 强制 new session；亲和闸不把他机挡在返工步外', async () => {
    const w = makeWorld();
    // 直插 prior 会话步（machineId = 会话机 A，在线；无 claimed 步 = 空闲让行位）。
    w.s.db
      .insert(stepTable)
      .values({
        id: 'step-prior-live',
        buildId: w.buildId,
        kind: 'build',
        status: 'done',
        machineId: w.machineAId,
        sessionId: 'sess-live',
        createdAt: nowMs() - 50_000,
      })
      .run();
    await restart(w, '换个思路再来');

    // #1259：亲和闸已退役，去处 = agent 归属机——别机（B）恒空手，归属机
    // （A）领到且 freshSession 恒新会话。
    const machineDeps = {
      ...w.s.svc,
      box: w.s.secretBox,
      reposDir: w.s.reposDir,
      attachmentsDir: w.s.attachmentsDir,
    };
    const foreign = (await claimStep(
      machineDeps,
      w.machineBId,
      w.teamId,
      10,
      'http://localhost',
    )) as ClaimedStep | null;
    expect(foreign).toBeNull();
    const got = (await claimStep(
      machineDeps,
      w.machineAId,
      w.teamId,
      10,
      'http://localhost',
    )) as ClaimedStep | null;
    expect(got).not.toBeNull();
    expect(got!.conversationId).toBe(w.buildId);
    expect(got!.session.action).toBe('new');
    expect(got!.session.sessionId).toBeNull();
    expect(got!.instruction).toBe(buildRestartPrompt('换个思路再来'));
  });

  test('失败方式 4：PR 已合并 → 新 build + 新分支说明 note 落新 conv（判定可见）', async () => {
    const fetchMock: FetchLike = (async (url: string) => {
      expect(String(url)).toBe(
        `https://api.github.com/repos/demo-owner/demo-repo/pulls/${PR_NUMBER}`,
      );
      return {
        ok: true,
        status: 200,
        json: async () => ({ state: 'closed', merged: true }),
        headers: { get: () => null },
      };
    }) as unknown as FetchLike;
    const w = makeWorld({ repoKind: 'github', githubFetch: fetchMock });
    await restart(w, '合并后再补一步');

    const builds = buildsOf(w);
    expect(builds).toHaveLength(2);
    const todoRow = todoRowOf(w);
    const newId = todoRow.latestBuildId!;
    expect(newId).not.toBe(w.buildId);
    expect(todoRow.phase).toBe('queued');

    // 新 conv：反馈行 + 「为何是新分支」note（点名旧 PR 与新分支名）。
    const rows = messagesOf(w, newId);
    expect(rows.some((m) => m.role === 'user' && m.content === '合并后再补一步')).toBe(true);
    expect(
      rows.some(
        (m) =>
          m.role === 'system' &&
          m.content ===
            buildReworkNewBranchNote({
              prNumber: PR_NUMBER,
              prUrl: PR_URL,
              branch: conversationBranch(newId),
              outcome: 'merged',
            }),
      ),
    ).toBe(true);
    // 新轮首步：现行 restart 形（无需 freshSession——新 build 无旧会话可续）。
    const steps = stepsOf(w, newId);
    expect(steps[0]!.prompt).toBe(buildRestartPrompt('合并后再补一步'));
    expect(steps[0]!.freshSession).toBe(false);
  });

  test('失败方式 4（关闭未合并）：PR 已关闭 → 新 build + 已关闭 note', async () => {
    const fetchMock: FetchLike = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ state: 'closed', merged: false }),
      headers: { get: () => null },
    })) as unknown as FetchLike;
    const w = makeWorld({ repoKind: 'github', githubFetch: fetchMock });
    await restart(w, '重开一版');
    expect(buildsOf(w)).toHaveLength(2);
    const newId = todoRowOf(w).latestBuildId!;
    const rows = messagesOf(w, newId);
    expect(
      rows.some(
        (m) =>
          m.role === 'system' &&
          m.content ===
            buildReworkNewBranchNote({
              prNumber: PR_NUMBER,
              prUrl: PR_URL,
              branch: conversationBranch(newId),
              outcome: 'closed',
            }),
      ),
    ).toBe(true);
  });

  test('失败方式 5：探测失败 → fail-open 复用（不盲开新分支）', async () => {
    const fetchMock: FetchLike = (async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
      headers: { get: () => null },
    })) as unknown as FetchLike;
    const w = makeWorld({ repoKind: 'github', githubFetch: fetchMock });
    await restart(w, '再试一次');
    expect(buildsOf(w)).toHaveLength(1);
    const fresh = stepsOf(w, w.buildId).filter((st) => st.kind === 'plan');
    expect(fresh[0]!.freshSession).toBe(true);
  });

  test('失败方式 6：无 PR build → 现行新 build 行为保持（回归钉）', async () => {
    const w = makeWorld({ prFields: false });
    await restart(w, '普通重启');
    const builds = buildsOf(w);
    expect(builds).toHaveLength(2);
    const newId = todoRowOf(w).latestBuildId!;
    expect(newId).not.toBe(w.buildId);
    expect(messagesOf(w, newId).some((m) => m.role === 'user' && m.content === '普通重启')).toBe(
      true,
    );
    const steps = stepsOf(w, newId);
    expect(steps[0]!.prompt).toBe(buildRestartPrompt('普通重启'));
    expect(steps[0]!.freshSession).toBe(false);
  });

  test('失败方式 7：存量多 PR build → 返工落最新 PR build', async () => {
    const w = makeWorld();
    // 更旧的 PR build（v1，#777）；当前失败 build 是最新 PR build（#888）。
    const older = newUuidv7();
    w.s.db
      .insert(buildTable)
      .values({
        id: older,
        todoId: w.todoId,
        withPlan: true,
        prevPhase: 'review',
        triggerSource: 'chief',
        planDocId: null,
        errorMessage: null,
        prUrl: 'https://github.com/demo-owner/demo-repo/pull/777',
        prNumber: 777,
        changes: null,
        diffHash: null,
        createdAt: nowMs() - 120_000,
      })
      .run();
    await restart(w, '回最新那版改');
    // 仍两 build（older + 最新 PR build），无第三个；轮落在最新 PR build。
    expect(buildsOf(w)).toHaveLength(2);
    expect(todoRowOf(w).latestBuildId).toBe(w.buildId);
    expect(stepsOf(w, w.buildId).some((st) => st.kind === 'plan')).toBe(true);
    // 更旧 PR build 不入轮（无新步）。
    expect(stepsOf(w, older)).toHaveLength(0);
  });

  test('失败方式 10：空白反馈 → 纯重启轮语义保持（无反馈行、无 instruction、note 照落）', async () => {
    const w = makeWorld();
    await restart(w, '   ');
    expect(buildsOf(w)).toHaveLength(1);
    const rows = messagesOf(w, w.buildId);
    expect(rows.filter((m) => m.role === 'user')).toHaveLength(0);
    expect(
      rows.some((m) => m.role === 'system' && String(m.content).includes(`PR #${PR_NUMBER}`)),
    ).toBe(true);
    const fresh = stepsOf(w, w.buildId).filter((st) => st.kind === 'plan');
    expect(fresh[0]!.prompt).toBeNull();
    expect(fresh[0]!.freshSession).toBe(true);
  });

  test('失败方式 9：复用轮上 revision 打回 → 仍不换 build/conv（两路收敛）', async () => {
    const w = makeWorld();
    await restart(w, '先改方案');
    // 驱到 review：plan 步成（plan 行过闸）→ confirm 动作 → build 步成 → review。
    const planId = newRecordId();
    w.s.db
      .insert(planTable)
      .values({ id: planId, buildId: w.buildId, version: 1, content: '# v1', createdAt: nowMs() })
      .run();
    w.s.db.update(buildTable).set({ planDocId: planId }).where(eq(buildTable.id, w.buildId)).run();
    const planStep = stepsOf(w, w.buildId).find((st) => st.kind === 'plan')!;
    // claim 相位推进等价直驱（机器领取后 planning；wire.test 同口径）。
    setTodoPhase(w.deps, w.todoId, 'planning');
    completeStep(w.deps, planStep.id);
    expect(todoRowOf(w).phase).toBe('confirm');
    await applyBuildStepAction(w.deps, w.buildId, { action: 'confirm' });
    const buildStep = stepsOf(w, w.buildId).find((st) => st.kind === 'build')!;
    completeStep(w.deps, buildStep.id, { hasChanges: true });
    // #1150 磨绿面 = github 项目（本世界无 repoKind）：PR 字段直插的 hosted 形态
    // 无 GitHub checks 可磨 → 执行步成仍直进 review（既有行为）。
    expect(todoRowOf(w).phase).toBe('review');

    // review 关口人肉打回：仍同一 build、同一 conv。
    await applyBuildStepAction(w.deps, w.buildId, {
      action: 'revision',
      side: 'plan',
      feedback: '图标再小一点',
      clientMessageId: 'cm-931-rev',
    });
    expect(buildsOf(w)).toHaveLength(1);
    const replan = stepsOf(w, w.buildId)
      .filter((st) => st.kind === 'plan')
      .at(-1)!;
    expect(replan.prompt).toBe(buildReviewRejectPrompt('图标再小一点'));
    expect(
      messagesOf(w, w.buildId).some((m) => m.role === 'user' && m.content === '图标再小一点'),
    ).toBe(true);
  });
});
