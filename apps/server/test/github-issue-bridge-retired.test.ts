import { orchestrationSourceRef, parseLocalMergeInstruction } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  build as buildTable,
  chief as chiefTable,
  chiefThread,
  externalEffect as externalEffectTable,
  githubConnection,
  githubLabel,
  project as projectTable,
  step as stepTable,
  taskIssueClose as taskIssueCloseTable,
  todoGithubLabel,
  todo as todoTable,
} from '../src/db/schema.js';
import { systemGitOps } from '../src/lib/git.js';
import { newUuidv7, nowMs } from '../src/lib/ids.js';
import { requestMerge } from '../src/services/build-merge-request.js';
import { rewatchCreatingThread } from '../src/services/chief.js';
import {
  type ChiefToolCtx,
  executeChiefTool,
  transitionTodos,
} from '../src/services/chief-tools.js';
import {
  drainEffects,
  effectRegistry,
  reconcileEffects,
} from '../src/services/external-effects.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { executeThreadMcpTool } from '../src/services/mcp-threads.js';
import { retireGithubIssueEffects } from '../src/services/retired-effects.js';
import { deleteTodo, getTodo, setTodoArchived, updateTodo } from '../src/services/todos.js';
import {
  bootServer,
  deliverCodeStep,
  insertMachine,
  issueApiKey,
  seedRoute,
  seedSessionRoute,
  type TestServer,
} from './helpers.js';
import { ownerTodoParams } from './owner-message.js';

const REPO = 'octo/alpha';
const TOKEN = 'ghp_retired_bridge';
const AGENT_ID = 'agent-retired-1';
const LEGACY_REF = `github:${REPO}#7`;

interface GhCall {
  method: string;
  url: string;
  body: string | undefined;
}

function ghSpy() {
  const calls: GhCall[] = [];
  const impl = async (input: string | URL, init?: { method?: string; body?: string }) => {
    const url = String(input);
    const path = new URL(url).pathname;
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body });
    const probe = /^\/repos\/([^/]+\/[^/]+)$/.exec(path);
    const body: unknown =
      probe === null
        ? method === 'POST'
          ? { number: 101 }
          : []
        : {
            full_name: probe[1],
          };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  const writes = (pattern: RegExp) =>
    calls.filter((call) => call.method !== 'GET' && pattern.test(new URL(call.url).pathname));
  return { impl, calls, writes };
}

function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred !== undefined) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    }),
  );
}

function seedConnection(s: TestServer): void {
  upsertGithubConnection(
    { db: s.db, box: s.secretBox },
    { teamId: s.team.id, login: 'octo', accessToken: TOKEN, scope: 'repo' },
  );
}

let projectSeq = 0;
function insertGithubProject(s: TestServer): string {
  projectSeq += 1;
  const id = `gh-project-${projectSeq}`;
  s.db
    .insert(projectTable)
    .values({
      id,
      name: `alpha-${projectSeq}`,
      teamId: s.team.id,
      repoKind: 'github',
      githubRepo: REPO,
    })
    .run();
  return id;
}

function insertLocalProject(s: TestServer): string {
  projectSeq += 1;
  const id = `local-project-${projectSeq}`;
  s.db
    .insert(projectTable)
    .values({ id, name: `plain-${projectSeq}`, teamId: s.team.id, repoKind: 'local' })
    .run();
  return id;
}

let todoSeq = 0;
function insertLegacyTodo(
  s: TestServer,
  projectId: string,
  opts: {
    title?: string;
    phase?: 'todo' | 'building';
    sourceKind?: 'github-issue' | 'github-issue-self';
  } = {},
): string {
  todoSeq += 1;
  const id = `todo-legacy-${todoSeq}`;
  const sourceKind = opts.sourceKind ?? 'github-issue-self';
  s.db
    .insert(todoTable)
    .values({
      id,
      teamId: s.team.id,
      projectId,
      title: opts.title ?? `legacy card ${todoSeq}`,
      spec: '旧卡片正文',
      phase: opts.phase ?? 'todo',
      phaseAt: nowMs(),
      seqNum: todoSeq,
      sourceKind,
      sourceRef: LEGACY_REF,
      issueState: 'open',
    })
    .run();
  return id;
}

function issueEffects(s: TestServer) {
  return s.db
    .select()
    .from(externalEffectTable)
    .all()
    .filter((row) => row.kind === 'github-issue-create' || row.kind === 'github-issue-title');
}

function closeRows(s: TestServer) {
  return s.db.select().from(taskIssueCloseTable).all();
}

describe('retired GitHub issue bridge: routes and cards answer without touching GitHub', () => {
  test('the import, issue echo and retry routes answer 404 and no GitHub request leaves the server', async () => {
    const spy = ghSpy();
    const s = bootServer({ githubFetch: spy.impl });
    seedConnection(s);
    const projectId = insertGithubProject(s);
    const legacyId = insertLegacyTodo(s, projectId);

    const imported = await call(s.app, 'POST', `/api/projects/${projectId}/github/issues/import`, {
      body: { number: 7 },
    });
    expect(imported.status).toBe(404);
    expect((await call(s.app, 'GET', `/api/todos/${legacyId}/github-issue`)).status).toBe(404);
    expect(
      (await call(s.app, 'POST', `/api/todos/${legacyId}/github-issue/retry`, {})).status,
    ).toBe(404);
    expect(spy.calls).toEqual([]);
    s.dispose();
  });

  test('a hand-created task in a GitHub-backed project stays an ordinary card and creates nothing', async () => {
    const spy = ghSpy();
    const s = bootServer({ githubFetch: spy.impl });
    seedConnection(s);
    const projectId = insertGithubProject(s);

    const res = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      body: { title: '给登录页加图形验证码', spec: '错误 5 次后触发。' },
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as {
      id: string;
      sourceKind: string | null;
      sourceRef: string | null;
    };
    expect(created.sourceKind).toBeNull();
    expect(created.sourceRef).toBeNull();
    expect(issueEffects(s)).toEqual([]);
    expect(spy.calls).toEqual([]);
    s.dispose();
  });

  test('a Coordinator-created task in a GitHub-backed project carries the orchestration source and opens no issue', async () => {
    const spy = ghSpy();
    const s = bootServer({ githubFetch: spy.impl });
    insertMachine(s);
    seedConnection(s);
    const projectId = insertGithubProject(s);
    const chiefId = `chief-${s.user.id}-${s.team.id}`;
    const threadId = `chief-${newUuidv7()}`;
    s.db
      .insert(chiefTable)
      .values({
        id: chiefId,
        userId: s.user.id,
        teamId: s.team.id,
        watches: [],
        wakes: [],
        createdAt: nowMs(),
      })
      .run();
    s.db
      .insert(chiefThread)
      .values({
        id: threadId,
        chiefId,
        userId: s.user.id,
        teamId: s.team.id,
        title: '编排回合',
        createdAt: nowMs(),
        updatedAt: nowMs(),
        sessionRuntime: 'pi',
        sessionId: '',
        sessionOpenedAt: nowMs(),
        toolDefHashes: {},
        toolResultHashes: {},
      })
      .run();
    seedRoute(s, 'coordinator', { id: AGENT_ID, provider: 'stub-gw', modelId: 'stub-model' });
    const ctx: ChiefToolCtx = {
      teamId: s.team.id,
      userId: s.user.id,
      chiefId,
      threadId,
      chiefAgentId: AGENT_ID,
      conversationId: threadId,
    };
    const text = await executeChiefTool(
      {
        db: s.db,
        hub: s.hub,
        machineHub: s.machineHub,
        box: s.secretBox,
        user: s.user,
        reposDir: s.reposDir,
        attachmentsDir: s.attachmentsDir,
        skillsDir: s.skillsDir,
        githubFetch: spy.impl,
      },
      ctx,
      'create_todo',
      ownerTodoParams(s.db, threadId, projectId, '写贡献指南'),
    );
    const created = JSON.parse(text) as {
      id: string;
      sourceKind: string | null;
      sourceRef: string | null;
    };
    expect(created.sourceKind).toBe('orchestration');
    expect(created.sourceRef).toBe(orchestrationSourceRef(threadId));
    expect(created.sourceRef?.startsWith('chief:')).toBe(true);
    expect(issueEffects(s)).toEqual([]);
    expect(spy.calls).toEqual([]);
    s.dispose();
  });

  test('a leg that delivers code and a PR writes no issue and edits no pull request body', async () => {
    const spy = ghSpy();
    const s = bootServer({ githubFetch: spy.impl });
    seedConnection(s);
    const projectId = insertGithubProject(s);
    const res = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      body: { title: '修登录页圆角', spec: '圆角 8px。' },
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    deliverCodeStep(
      {
        ...s.svc,
        box: s.secretBox,
        reposDir: s.reposDir,
        attachmentsDir: s.attachmentsDir,
        githubFetch: spy.impl,
      },
      id,
      { hasChanges: true, attachPr: { prNumber: 12, prUrl: `https://github.com/${REPO}/pull/12` } },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(spy.writes(/\/issues/)).toEqual([]);
    expect(spy.writes(/\/pulls\/\d+$/)).toEqual([]);
    expect(issueEffects(s)).toEqual([]);
    s.dispose();
  });

  test('a leg that delivers code while GitHub throws still records the delivery and attempts no issue call', async () => {
    const calls: string[] = [];
    const s = bootServer({
      githubFetch: async (input) => {
        calls.push(String(input));
        throw new Error('ECONNRESET');
      },
    });
    seedConnection(s);
    const projectId = insertGithubProject(s);
    const res = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      body: { title: '断网也要交付', spec: '离线交付。' },
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    deliverCodeStep(
      {
        ...s.svc,
        box: s.secretBox,
        reposDir: s.reposDir,
        attachmentsDir: s.attachmentsDir,
        githubFetch: async (input) => {
          calls.push(String(input));
          throw new Error('ECONNRESET');
        },
      },
      id,
      { hasChanges: true },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const record = (await (await call(s.app, 'GET', `/api/todos/${id}`)).json()) as {
      hasChanges: boolean;
    };
    expect(record.hasChanges).toBe(true);
    expect(calls.filter((url) => /\/issues/.test(new URL(url).pathname))).toEqual([]);
    expect(calls).toEqual([]);
    s.dispose();
  });

  test('a legacy bug-labelled imported card orchestrates with no gh issue write', async () => {
    const spy = ghSpy();
    const s = bootServer({ githubFetch: spy.impl });
    seedConnection(s);
    seedRoute(s, 'coordinator', { id: AGENT_ID, provider: 'stub-gw', modelId: 'stub-model' });
    const projectId = insertGithubProject(s);
    const todoId = insertLegacyTodo(s, projectId, { sourceKind: 'github-issue' });
    s.db
      .insert(githubLabel)
      .values({
        id: 'label-bug',
        projectId,
        name: 'bug',
        color: '#b60205',
        createdAt: nowMs(),
        v: 1,
      })
      .run();
    s.db.insert(todoGithubLabel).values({ todoId, labelId: 'label-bug' }).run();

    const res = await call(s.app, 'POST', `/api/todos/${todoId}/orchestrate`, {});
    const text = await res.text();
    expect(res.status, text).toBe(201);
    const body = JSON.parse(text) as { message: { content: string } };
    expect(body.message.content).toContain('【GitHub issue 原文');
    expect(body.message.content).not.toContain('gh issue comment');
    expect(body.message.content).not.toContain('gh issue edit');
    expect(spy.calls).toEqual([]);
    s.dispose();
  });
});

describe('retired writeback: local transitions never reach GitHub', () => {
  test('done, archived, superseded, deleted and moved cards land locally with no tombstone and no call', async () => {
    const spy = ghSpy();
    const s = bootServer({ githubFetch: spy.impl });
    seedConnection(s);
    const projectId = insertGithubProject(s);
    const localProjectId = insertLocalProject(s);
    const doneId = insertLegacyTodo(s, projectId, { phase: 'building' });
    const archivedId = insertLegacyTodo(s, projectId);
    const supersededId = insertLegacyTodo(s, projectId);
    const survivorId = insertLegacyTodo(s, projectId);
    const deletedId = insertLegacyTodo(s, projectId);
    const movedId = insertLegacyTodo(s, projectId);

    transitionTodos(s.svc, s.team.id, [doneId], 'done', {
      kind: 'user',
      name: 'Owner',
      stopActor: 'person',
    });
    expect(s.db.select().from(todoTable).where(eq(todoTable.id, doneId)).get()?.phase).toBe('done');
    expect(setTodoArchived(s.svc, archivedId, true)?.archivedAt).not.toBeNull();
    transitionTodos(
      s.svc,
      s.team.id,
      [supersededId],
      'closed',
      {
        kind: 'user',
        name: 'Owner',
        stopActor: 'person',
      },
      { supersededBy: survivorId },
    );
    expect(deleteTodo(s.svc, deletedId)).toBe(true);
    const moved = updateTodo(s.svc, movedId, { projectId: localProjectId });
    expect(moved?.projectId).toBe(localProjectId);
    expect(moved?.sourceKind).toBe('github-issue-self');
    expect(moved?.sourceRef).toBe(LEGACY_REF);
    const movedRow = s.db.select().from(todoTable).where(eq(todoTable.id, movedId)).get();
    expect(movedRow?.sourceKind).toBe('github-issue-self');
    expect(movedRow?.sourceRef).toBe(LEGACY_REF);
    expect(movedRow?.issueState).toBe('open');

    expect(closeRows(s)).toEqual([]);
    expect(spy.calls).toEqual([]);
    expect(issueEffects(s)).toEqual([]);
    s.dispose();
  });

  test('a device rename of a legacy self card lands locally with no title effect and no call', async () => {
    const spy = ghSpy();
    const s = bootServer({ githubFetch: spy.impl, claimHoldMs: 250 });
    seedConnection(s);
    seedSessionRoute(s, { provider: 'stub-gw', modelId: 'stub-model' });
    const projectId = insertGithubProject(s);
    const todoId = insertLegacyTodo(s, projectId, { phase: 'building', title: '旧标题' });

    const key = await issueApiKey(s);
    const enroll = await call(s.app, 'POST', '/api/machine/enroll', {
      cred: key,
      body: readyMachine({ teamId: s.team.id, name: 'retired-rename', cliVersion: '0.1.0' }),
    });
    const { machineId, token } = (await enroll.json()) as { machineId: string; token: string };
    const buildId = newUuidv7();
    const stepId = `step-rename-${todoSeq}`;
    const claimedAt = nowMs();
    s.db
      .insert(buildTable)
      .values({ id: buildId, todoId, withPlan: false, triggerSource: 'user', createdAt: claimedAt })
      .run();
    s.db
      .insert(stepTable)
      .values({
        id: stepId,
        buildId,
        kind: 'build',
        machineId,
        status: 'claimed',
        claimedAt,
        createdAt: claimedAt,
      })
      .run();
    s.db.update(todoTable).set({ latestBuildId: buildId }).where(eq(todoTable.id, todoId)).run();

    const res = await call(s.app, 'POST', `/api/machine/tool/${stepId}`, {
      cred: token,
      body: { name: 'set_task_meta', params: { title: '登录页改成邮箱登录' } },
    });
    expect(res.status).toBe(200);
    const relayed = (await res.json()) as { text: string };
    expect(JSON.parse(relayed.text) as { title: string }).toMatchObject({
      title: '登录页改成邮箱登录',
    });
    const record = getTodo(s.svc, todoId);
    expect(record?.title).toBe('登录页改成邮箱登录');
    expect(record?.sourceKind).toBe('github-issue-self');
    expect(record?.sourceRef).toBe(LEGACY_REF);
    expect(issueEffects(s)).toEqual([]);
    expect(spy.calls).toEqual([]);
    s.dispose();
  });

  test('a legacy self card from a Coordinator conversation still lists its pull requests and is re-watched', async () => {
    const spy = ghSpy();
    const s = bootServer({ githubFetch: spy.impl });
    seedConnection(s);
    const projectId = insertGithubProject(s);
    const chiefId = `chief-${s.user.id}-${s.team.id}`;
    const threadId = `chief-${newUuidv7()}`;
    const todoId = insertLegacyTodo(s, projectId, { phase: 'building' });
    s.db
      .insert(chiefTable)
      .values({
        id: chiefId,
        userId: s.user.id,
        teamId: s.team.id,
        watches: [],
        wakes: [],
        createdAt: nowMs(),
      })
      .run();
    s.db
      .insert(chiefThread)
      .values({
        id: threadId,
        chiefId,
        userId: s.user.id,
        teamId: s.team.id,
        title: '编排回合',
        createdAt: nowMs(),
        updatedAt: nowMs(),
        sessionRuntime: 'pi',
        sessionId: '',
        sessionOpenedAt: nowMs(),
        toolDefHashes: {},
        toolResultHashes: {},
      })
      .run();
    s.db
      .update(todoTable)
      .set({
        sourceKind: 'github-issue-self',
        sourceRef: LEGACY_REF,
        request: {
          segments: [
            {
              source: { kind: 'chat', threadId, messageId: 'msg-legacy-request', span: 'whole' },
              author: 'owner',
              sourceRef: null,
              text: '修复自开发着陆',
            },
          ],
          siblings: [],
          difficulty: null,
          titleSource: 'owner',
          titleSourceRef: null,
          model: { provider: 'stub-gw', modelId: 'stub-model', thinkingLevel: null },
        },
      })
      .where(eq(todoTable.id, todoId))
      .run();
    s.db
      .insert(buildTable)
      .values({
        id: 'build-legacy-thread',
        todoId,
        withPlan: false,
        triggerSource: 'user',
        createdAt: nowMs(),
        prNumber: 77,
        prUrl: `https://github.com/${REPO}/pull/77`,
      })
      .run();

    const prs = await executeThreadMcpTool(
      {
        db: s.db,
        hub: s.hub,
        convHub: s.convHub,
        machineHub: s.machineHub,
        box: s.secretBox,
        user: s.user,
        reposDir: s.reposDir,
        attachmentsDir: s.attachmentsDir,
        skillsDir: s.skillsDir,
      },
      s.team.id,
      'thread_pull_requests',
      { threadId },
    );
    expect(prs).toEqual([
      {
        threadId: todoId,
        buildId: 'build-legacy-thread',
        prUrl: `https://github.com/${REPO}/pull/77`,
        prNumber: 77,
      },
    ]);

    const record = getTodo(s.svc, todoId);
    rewatchCreatingThread(
      { db: s.db, hub: s.hub, machineHub: s.machineHub, user: s.user },
      record!,
    );
    const watches = s.db.select().from(chiefTable).where(eq(chiefTable.id, chiefId)).get()?.watches;
    expect(watches?.map((watch) => [watch.todoId, watch.threadId])).toEqual([[todoId, threadId]]);
    s.dispose();
  });

  test('a merge for a task with a legacy issue ref commits with the plain title and no Closes line', async () => {
    const s = bootServer();
    const projectId = insertLocalProject(s);
    s.db
      .update(projectTable)
      .set({ localPath: '/repo', autonomy: { localChecks: [] } })
      .where(eq(projectTable.id, projectId))
      .run();
    seedSessionRoute(s, {
      provider: 'stub-gw',
      modelId: 'stub-gw',
      tools: ['合并分支', '推送分支'],
    });
    const todoId = insertLegacyTodo(s, projectId, { phase: 'building', title: 'Deliver me' });
    s.db
      .update(todoTable)
      .set({ phase: 'done', hasChanges: true })
      .where(eq(todoTable.id, todoId))
      .run();
    const buildId = newUuidv7();
    s.db
      .insert(buildTable)
      .values({ id: buildId, todoId, withPlan: false, triggerSource: 'user', createdAt: nowMs() })
      .run();
    s.db.update(todoTable).set({ latestBuildId: buildId }).where(eq(todoTable.id, todoId)).run();
    s.db
      .insert(stepTable)
      .values({
        id: 'delivery-legacy-merge',
        buildId,
        kind: 'session',
        status: 'done',
        createdAt: nowMs(),
        checkpointCommit: 'a'.repeat(40),
      })
      .run();

    await requestMerge(
      {
        ...s.svc,
        box: s.secretBox,
        reposDir: s.reposDir,
        attachmentsDir: s.attachmentsDir,
        gitOps: {
          ...systemGitOps,
          listBranches: async () => ({ defaultBranch: 'main', branches: [] }),
          resolveCommit: async () => 'b'.repeat(40),
          localCompareFiles: async () => [
            {
              status: 'modified' as const,
              filename: 'src/local.ts',
              previousFilename: null,
              sha: 'd'.repeat(40),
              additions: 1,
              deletions: 0,
              patchSha: 'd'.repeat(64),
            },
          ],
        },
      },
      buildId,
    );

    const mergeStep = s.db
      .select()
      .from(stepTable)
      .all()
      .find((row) => row.kind === 'merge');
    const command = parseLocalMergeInstruction(mergeStep?.prompt ?? null);
    expect(command?.message).toBe('Deliver me');
    expect(command?.message).not.toContain('Closes');
    s.dispose();
  });

  test('a previously minted webhook URL answers 404 and no token row changes', async () => {
    const spy = ghSpy();
    const s = bootServer({ githubFetch: spy.impl });
    seedConnection(s);
    s.db
      .update(githubConnection)
      .set({
        webhookTokenHash: 'a'.repeat(64),
        webhookMasked: 'ghwh_old…',
        webhookDeliveries: ['delivery-1'],
        webhookLastUsedAt: 1_700_000_000_000,
      })
      .where(eq(githubConnection.teamId, s.team.id))
      .run();
    const before = s.db
      .select()
      .from(githubConnection)
      .where(eq(githubConnection.teamId, s.team.id))
      .get();

    const res = await call(s.app, 'POST', '/api/webhook/github/whatever-token', {
      body: { action: 'opened' },
    });
    expect(res.status).toBe(404);

    const after = s.db
      .select()
      .from(githubConnection)
      .where(eq(githubConnection.teamId, s.team.id))
      .get();
    expect(after).toMatchObject({
      webhookTokenHash: before?.webhookTokenHash,
      webhookMasked: before?.webhookMasked,
      webhookDeliveries: before?.webhookDeliveries,
      webhookLastUsedAt: before?.webhookLastUsedAt,
    });
    expect(spy.calls).toEqual([]);
    s.dispose();
  });

  test('an old database holding imported rows, a self card, a tombstone and label links boots, lists them and writes nothing', async () => {
    const spy = ghSpy();
    const s = bootServer({ githubFetch: spy.impl });
    seedConnection(s);
    const projectId = insertGithubProject(s);
    const importedId = insertLegacyTodo(s, projectId, {
      sourceKind: 'github-issue',
      title: '导入的 issue 卡',
    });
    const selfId = insertLegacyTodo(s, projectId, { title: '自建 issue 卡' });
    s.db
      .insert(githubLabel)
      .values({ id: 'label-bug', projectId, name: 'bug', color: '#b60205' })
      .run();
    s.db.insert(todoGithubLabel).values({ todoId: selfId, labelId: 'label-bug' }).run();
    s.db
      .insert(taskIssueCloseTable)
      .values({
        id: 'tombstone-1',
        teamId: s.team.id,
        sourceRef: LEGACY_REF,
        comment: 'Cairn：这个任务已删除，这里的 issue 关闭（未计划）。',
        createdAt: nowMs(),
      })
      .run();

    const list = await call(s.app, 'GET', '/api/todos');
    expect(list.status).toBe(200);
    const rows = (await list.json()) as {
      id: string;
      sourceKind: string | null;
      sourceRef: string | null;
      githubLabelIds?: string[];
    }[];
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(importedId)).toMatchObject({
      sourceKind: 'github-issue',
      sourceRef: LEGACY_REF,
    });
    expect(byId.get(selfId)).toMatchObject({
      sourceKind: 'github-issue-self',
      sourceRef: LEGACY_REF,
    });
    expect(byId.get(selfId)?.githubLabelIds).toEqual(['label-bug']);
    const detail = await call(s.app, 'GET', `/api/todos/${importedId}`);
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { title: string }).title).toBe('导入的 issue 卡');
    expect(closeRows(s)).toHaveLength(1);
    expect(spy.calls).toEqual([]);
    s.dispose();
  });
});

describe('retired effect kinds settle without a network call', () => {
  test('50 pending plus interrupted retired rows ahead of a live push effect settle and the push still drains', async () => {
    const spy = ghSpy();
    const s = bootServer({ githubFetch: spy.impl });
    const base = nowMs() - 60_000;
    const insertEffect = (id: string, kind: string, state: string, createdAt: number): void => {
      s.db
        .insert(externalEffectTable)
        .values({
          id,
          teamId: s.team.id,
          scopeKind: 'todo',
          scopeId: 'todo-scope',
          kind,
          dedupeKey: `dedupe-${id}`,
          payload: {},
          state: state as 'pending' | 'interrupted',
          dueAt: base,
          claimedAt: state === 'interrupted' ? base : null,
          claimFence: state === 'interrupted' ? 1 : null,
          attempts: 0,
          createdAt,
          updatedAt: createdAt,
        })
        .run();
    };
    for (let index = 0; index < 50; index += 1)
      insertEffect(`effect-create-${index}`, 'github-issue-create', 'pending', base + index);
    insertEffect('effect-interrupted-create', 'github-issue-create', 'interrupted', base + 60);
    insertEffect('effect-interrupted-title', 'github-issue-title', 'interrupted', base + 61);
    insertEffect('effect-live-push', 'web-push', 'pending', base + 120);

    const pushed: string[] = [];
    effectRegistry.set('web-push', {
      policy: 'replay-safe',
      send: async (row) => {
        pushed.push(row.id);
        return { status: 'delivered' };
      },
    });

    retireGithubIssueEffects(s.db, effectRegistry);
    await reconcileEffects(s.db, effectRegistry);
    await drainEffects(s.db, effectRegistry);

    const rows = s.db.select().from(externalEffectTable).all();
    const retired = rows.filter((row) => row.kind.startsWith('github-issue'));
    expect(retired).toHaveLength(52);
    expect(retired.every((row) => row.state === 'delivered')).toBe(true);
    expect(
      retired.every(
        (row) => JSON.stringify(row.receipt) === JSON.stringify({ retired: 'github-issue-bridge' }),
      ),
    ).toBe(true);
    expect(pushed).toEqual(['effect-live-push']);
    expect(rows.find((row) => row.id === 'effect-live-push')?.state).toBe('delivered');
    expect(spy.calls).toEqual([]);
    s.dispose();
  });
});
