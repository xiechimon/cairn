import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { build, chief, chiefMessage, chiefThread, project, step, todo } from '../src/db/schema.js';
import { HttpError } from '../src/lib/errors.js';
import { systemGitOps } from '../src/lib/git.js';
import { settleAutonomousMerge } from '../src/services/autonomous-merge.js';
import { requestMerge } from '../src/services/build-merge-request.js';
import { chiefMessageStored, upsertChiefMessage } from '../src/services/chief.js';
import { executeChiefTool } from '../src/services/chief-tools.js';
import { reportTranscriptDelta, reportTranscriptRow } from '../src/services/machines.js';
import { announceMergeStepOutcome } from '../src/services/merge-announcement.js';
import { bootServer, seedSessionRoute, type TestServer } from './helpers.js';

const disposals: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  vi.restoreAllMocks();
});

function stubLocalGit(): void {
  vi.spyOn(systemGitOps, 'listBranches').mockResolvedValue({
    defaultBranch: 'main',
    branches: [],
  });
  vi.spyOn(systemGitOps, 'resolveCommit').mockResolvedValue(BASE);
  vi.spyOn(systemGitOps, 'localCompareFiles').mockResolvedValue([
    {
      status: 'modified',
      filename: 'src/save.ts',
      previousFilename: null,
      sha: 'd'.repeat(40),
      additions: 1,
      deletions: 0,
      patchSha: 'd'.repeat(64),
    },
  ]);
}

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);

interface World {
  s: TestServer;
  teamId: string;
  threadId: string;
  chiefId: string;
  todoId: string;
  buildId: string;
  tool(name: string, params: Record<string, unknown>, turnPrompt?: string): Promise<unknown>;
  mergeStep(): { id: string; status: string };
  settleMergeStep(): void;
  chiefRows(): { id: string; role: string; content: unknown }[];
}

function world(): World {
  stubLocalGit();
  const s = bootServer();
  disposals.push(() => s.dispose());
  const teamId = s.team.id;
  const chiefId = `chief-${s.user.id}-${teamId}`;
  const threadId = 'chief-0199a1fb-0000-7000-8000-000000000001';
  const todoId = 'todo-merge-claim';
  const buildId = 'build-merge-claim';
  const now = Date.now();
  s.db
    .insert(chief)
    .values({ id: chiefId, userId: s.user.id, teamId, watches: [], wakes: [], createdAt: now })
    .run();
  s.db
    .insert(chiefThread)
    .values({
      id: threadId,
      chiefId,
      userId: s.user.id,
      teamId,
      title: 'fix the save button',
      createdAt: now,
      updatedAt: now,
      sessionRuntime: 'pi',
      sessionId: '',
      sessionOpenedAt: now,
      toolDefHashes: {},
      toolResultHashes: {},
    })
    .run();
  s.db
    .insert(project)
    .values({
      id: 'project',
      teamId,
      name: 'Local',
      repoKind: 'local',
      localPath: '/repo',
      autonomy: { localChecks: ['true'] },
    })
    .run();
  seedSessionRoute(s, { provider: 'stub-gw', modelId: 'stub', tools: ['合并分支', '推送分支'] });
  s.db
    .insert(todo)
    .values({
      id: todoId,
      teamId,
      projectId: 'project',
      title: '修复项目设置保存按钮无效',
      phase: 'done',
      phaseAt: now,
      seqNum: 3,
      latestBuildId: buildId,
      hasChanges: true,
    })
    .run();
  s.db
    .insert(build)
    .values({ id: buildId, todoId, withPlan: false, triggerSource: 'user', createdAt: now })
    .run();
  s.db
    .insert(step)
    .values({
      id: 'delivery',
      buildId,
      kind: 'session',
      status: 'done',
      createdAt: now,
      checkpointCommit: HEAD,
    })
    .run();
  const deps = {
    db: s.db,
    hub: s.hub,
    machineHub: s.machineHub,
    user: s.user,
    convHub: s.convHub,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
  };
  const mergeStepRow = () =>
    s.db
      .select()
      .from(step)
      .all()
      .find((row) => row.kind === 'merge')!;
  return {
    s,
    teamId,
    threadId,
    chiefId,
    todoId,
    buildId,
    tool: async (name, params, turnPrompt = '[user] 看起来没问题，合并吧。') =>
      JSON.parse(
        await executeChiefTool(
          deps as never,
          {
            teamId,
            userId: s.user.id,
            chiefId,
            threadId,
            chiefAgentId: null,
            conversationId: threadId,
            turnPrompt,
          },
          name,
          params,
        ),
      ) as unknown,
    mergeStep: () => ({ id: mergeStepRow().id, status: mergeStepRow().status }),
    settleMergeStep: () => {
      s.db
        .update(step)
        .set({ status: 'done', finishedAt: Date.now() })
        .where(eq(step.id, mergeStepRow().id))
        .run();
      settleAutonomousMerge(s.db, buildId, 'merged');
    },
    chiefRows: () => s.db.select().from(chiefMessage).all(),
  };
}

const incidentReply = (w: World): string =>
  `已合并。xmon，[修复项目设置「想做什么」保存按钮无效](todo:${w.todoId})的改动已经进了主线。`;

describe('the 06:32 premature merge claim', () => {
  test('merge_builds reports the queued merge step, not a merge', async () => {
    const w = world();
    const result = (await w.tool('merge_builds', { buildIds: [w.buildId] })) as {
      merges: { buildId: string; state: string; stepId: string }[];
    };
    expect(result.merges).toEqual([
      { buildId: w.buildId, state: 'requested', stepId: w.mergeStep().id },
    ]);
    expect(w.mergeStep().status).toBe('pending');
    expect(JSON.stringify(result)).not.toMatch(/"merged":\[/);
  });

  test('the Coordinator cannot tell the owner the change landed while the step is pending', async () => {
    const w = world();
    await w.tool('merge_builds', { buildIds: [w.buildId] });
    const failure = await w
      .tool('notify_user', {
        message: incidentReply(w),
        provenance: '',
      })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HttpError);
    expect((failure as HttpError).status).toBe(409);
    expect((failure as HttpError).message).toContain('尚未记录合并完成');
    expect((failure as HttpError).message).toContain('已合并');
    expect(w.chiefRows().filter((row) => row.role === 'system')).toHaveLength(0);
  });

  test('a stored assistant reply carries the recorded state instead of the claim', async () => {
    const w = world();
    await w.tool('merge_builds', { buildIds: [w.buildId] });
    const row = {
      id: 'assistant-incident',
      threadId: w.threadId,
      role: 'assistant' as const,
      content: [{ type: 'text', text: incidentReply(w) }],
      createdAt: Date.now(),
    };
    const stored = upsertChiefMessage(w.s.db, row);
    expect(JSON.stringify(stored.content)).not.toContain('已合并');
    expect(JSON.stringify(stored.content)).toContain('还在合并');
    expect(chiefMessageStored(w.s.db, row)).toBe(true);
    upsertChiefMessage(w.s.db, row);
    expect(w.s.db.select().from(chiefMessage).all()).toHaveLength(1);
  });

  test('once the merge step reports done the same reply passes', async () => {
    const w = world();
    await w.tool('merge_builds', { buildIds: [w.buildId] });
    w.settleMergeStep();
    const result = (await w.tool('notify_user', {
      message: incidentReply(w),
      provenance: '',
    })) as { notified: boolean };
    expect(result.notified).toBe(true);
  });

  test('the merge transition itself announces the outcome to the owner', async () => {
    const w = world();
    await w.tool('merge_builds', { buildIds: [w.buildId] });
    announceMergeStepOutcome(
      { db: w.s.db, hub: w.s.hub, user: w.s.user, convHub: w.s.convHub } as never,
      { stepId: w.mergeStep().id, buildId: w.buildId, text: '合并完成' },
    );
    const notice = w.chiefRows().find((row) => String(row.content).includes('合并完成'));
    expect(notice?.role).toBe('system');
    expect(String(notice?.content)).toContain('修复项目设置保存按钮无效');
  });

  test('the live delta stream never shows a pending merge as done', async () => {
    const w = world();
    await w.tool('merge_builds', { buildIds: [w.buildId] });
    w.s.db
      .insert(step)
      .values({
        id: 'chief-step',
        buildId: w.threadId,
        kind: 'chief',
        status: 'claimed',
        machineId: null,
        createdAt: Date.now(),
        claimedAt: Date.now(),
        prompt: `[user] 合并吧。[修复](todo:${w.todoId})`,
      })
      .run();
    const publish = vi.spyOn(w.s.convHub, 'publishTextDelta');
    const deps = { ...w.s.svc, convHub: w.s.convHub } as never;
    reportTranscriptDelta(deps, null, 'chief-step', incidentReply(w));
    reportTranscriptRow(deps, null, 'chief-step', {
      id: 'assistant-delta-row',
      role: 'assistant',
      content: [{ type: 'text', text: incidentReply(w) }],
      createdAt: Date.now(),
    } as never);
    const painted = publish.mock.calls.map((call) => call[1]).join('');
    expect(painted).not.toContain('已合并');
    expect(painted).toContain('还在合并');
  });

  test('a push claim needs a recorded checked-out commit', async () => {
    const w = world();
    const refused = await w
      .tool('notify_user', { message: '改动已推送到远程分支。', provenance: '' })
      .catch((error: unknown) => error);
    expect((refused as HttpError).status).toBe(409);
    expect((refused as HttpError).message).toContain('推送');
  });

  test('a finished local-merge step the machine refused is not a merge to claim', async () => {
    const w = world();
    w.s.db
      .insert(step)
      .values({
        id: 'local-merge-step',
        buildId: w.buildId,
        kind: 'merge',
        status: 'done',
        createdAt: Date.now(),
        finishedAt: Date.now(),
        prompt: JSON.stringify({
          kind: 'local-merge',
          command: {
            projectId: 'project',
            buildId: w.buildId,
            defaultBranch: 'main',
            workBranch: 'cairn/build-merge-claim',
            judgedBase: BASE,
            judgedHead: HEAD,
            judgedPatchDigest: `pd2:${'e'.repeat(64)}`,
            localChecks: [],
            message: '修复项目设置保存按钮无效',
            identity: { name: 'cairn', email: 'cairn@local' },
          },
        }),
      })
      .run();
    const failure = await w
      .tool('notify_user', { message: incidentReply(w), provenance: '' })
      .catch((error: unknown) => error);
    expect((failure as HttpError).status).toBe(409);
    expect((failure as HttpError).message).toContain('合并没有成功');
  });

  test('a merge step done on a PR-backed build still cannot back a merged claim', async () => {
    const w = world();
    w.s.db
      .update(project)
      .set({ repoKind: 'github', githubRepo: 'octo/demo' })
      .where(eq(project.id, 'project'))
      .run();
    w.s.db.update(build).set({ prNumber: 201 }).where(eq(build.id, w.buildId)).run();
    w.s.db
      .insert(step)
      .values({
        id: 'hosted-merge-step',
        buildId: w.buildId,
        kind: 'merge',
        status: 'done',
        createdAt: Date.now(),
        finishedAt: Date.now(),
        prompt: 'merge into the default branch',
      })
      .run();
    const failure = await w
      .tool('notify_user', { message: incidentReply(w), provenance: '' })
      .catch((error: unknown) => error);
    expect((failure as HttpError).status).toBe(409);
    expect((failure as HttpError).message).toContain('尚未记录合并完成');
  });

  test('requestMerge itself only ever says requested for a queued merge', async () => {
    const w = world();
    const outcome = await requestMerge(
      {
        db: w.s.db,
        hub: w.s.hub,
        user: w.s.user,
        reposDir: w.s.reposDir,
        box: w.s.secretBox,
        gitOps: {
          ...systemGitOps,
          listBranches: async () => ({ defaultBranch: 'main', branches: [] }),
          resolveCommit: async () => BASE,
          localCompareFiles: async () => [
            {
              status: 'modified' as const,
              filename: 'src/save.ts',
              previousFilename: null,
              sha: 'd'.repeat(40),
              additions: 1,
              deletions: 0,
              patchSha: 'd'.repeat(64),
            },
          ],
        },
      } as never,
      w.buildId,
    );
    expect(outcome).toEqual({ state: 'requested', stepId: expect.any(String) });
  });
});
