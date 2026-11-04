import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  agentMemory,
  agent as agentTable,
  build as buildTable,
  chiefMessage,
  chiefThread,
  message as messageTable,
  project as projectTable,
  schedule as scheduleTable,
  team as teamTable,
  todo as todoTable,
  tokenUsage,
} from '../src/db/schema.js';
import { HttpError } from '../src/lib/errors.js';
import { newUuidv7, nowMs } from '../src/lib/ids.js';
import { getChiefEnvelope } from '../src/services/chief.js';
import { executeWorkerMemoryTool } from '../src/services/chief-tools.js';
import { hasRepoBinding, projectRepoRef, toProjectRecord } from '../src/services/git.js';
import { executeMcpTool } from '../src/services/mcp-face.js';
import { AGENT_ID, H, registerChiefHarness, relay, toolDeps } from './chief-harness.js';

registerChiefHarness();

const TEAM_B = 'team-b-1470';
const PROJ_B = 'proj-b-1470';
const TASK_B = 'todo-b-1470';
const BUILD_B = 'build-b-1470';
const THREAD_B = 'chief-b-1470';
const MISSING = 'missing-1470';
const CROSS = 'todo-cross-1470';
const OWN_TASK = 'todo-own-1470';
const OWN_BUILD = 'build-own-1470';

function insertTodo(id: string, teamId: string, projectId: string, seqNum: number): void {
  H.s.db
    .insert(todoTable)
    .values({ id, teamId, projectId, title: id, spec: '', phase: 'todo', phaseAt: nowMs(), seqNum })
    .run();
}

function insertBuild(id: string, todoId: string): void {
  H.s.db
    .insert(buildTable)
    .values({ id, todoId, withPlan: false, triggerSource: 'user', createdAt: nowMs() })
    .run();
}

function insertUsage(buildId: string, input: number): void {
  H.s.db.insert(tokenUsage).values({ buildId, model: 'stub/m', input }).run();
}

beforeEach(() => {
  const now = nowMs();
  H.s.db.insert(teamTable).values({ id: TEAM_B, name: 'B', createdAt: now }).run();
  H.s.db
    .insert(projectTable)
    .values({ id: PROJ_B, name: 'beta', teamId: TEAM_B, repoKind: 'github', githubRepo: 'b/beta' })
    .run();
  insertTodo(TASK_B, TEAM_B, PROJ_B, 1);
  insertTodo(CROSS, H.teamId, PROJ_B, 900);
  insertTodo(OWN_TASK, H.teamId, H.projectId, 901);
  insertBuild(BUILD_B, TASK_B);
  insertBuild(OWN_BUILD, OWN_TASK);
  H.s.db
    .insert(messageTable)
    .values({
      id: 'msg-b',
      conversationId: BUILD_B,
      role: 'user',
      content: '他队对话',
      createdAt: now,
    })
    .run();
  H.s.db
    .insert(messageTable)
    .values({
      id: 'msg-a',
      conversationId: OWN_BUILD,
      role: 'user',
      content: '本队对话',
      createdAt: now,
    })
    .run();
  H.s.db
    .insert(chiefThread)
    .values({
      id: THREAD_B,
      chiefId: `chief-u-${TEAM_B}`,
      userId: H.userId,
      teamId: TEAM_B,
      title: '他队 chief',
      createdAt: now,
      updatedAt: now,
      sessionId: '',
      sessionOpenedAt: now,
    })
    .run();
  H.s.db
    .insert(chiefMessage)
    .values({
      id: 'cmsg-b',
      threadId: THREAD_B,
      role: 'user',
      content: '他队 chief 对话',
      createdAt: now,
    })
    .run();
  H.s.db
    .insert(chiefMessage)
    .values({
      id: 'cmsg-a',
      threadId: H.threadId,
      role: 'user',
      content: '本队 chief 对话',
      createdAt: now,
    })
    .run();
  insertUsage(OWN_BUILD, 1);
  insertUsage(H.threadId, 2);
  insertUsage(BUILD_B, 100);
  insertUsage(THREAD_B, 200);
});

const ALL_GRANTS = new Set(['Run Builds', 'Schedule Todo', 'Conversation']);

async function mcp(name: string, args: Record<string, unknown>): Promise<unknown> {
  return JSON.parse(
    await executeMcpTool(
      toolDeps(),
      { teamId: H.teamId, user: H.s.user, grants: ALL_GRANTS },
      name,
      args,
    ),
  );
}

async function rejection(p: Promise<unknown>): Promise<HttpError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpError);
  return err as HttpError;
}

function nextQuarter(): number {
  return Math.ceil((nowMs() + 3_600_000) / 900_000) * 900_000;
}

function buildsOf(todoId: string): number {
  return H.s.db.select().from(buildTable).where(eq(buildTable.todoId, todoId)).all().length;
}

function schedulesOf(todoId: string): number {
  return H.s.db.select().from(scheduleTable).where(eq(scheduleTable.todoId, todoId)).all().length;
}

function memoryCount(): number {
  return H.s.db.select().from(agentMemory).all().length;
}

describe('#1470 MCP run_builds / schedule_todo: the project a todo points at is team-checked too', () => {
  const assignment = { build: { agentId: AGENT_ID } };

  test('U1 run_builds: an own-team todo pointing at another team project -> 404 project, not one build created', async () => {
    const err = await rejection(mcp('run_builds', { todoIds: [CROSS], assignment }));
    expect(err.status).toBe(404);
    expect(err.message).toBe(`project ${PROJ_B}`);
    expect(buildsOf(CROSS)).toBe(0);
  });

  test('U1 run_builds mixed list: the own-team todo at the front is not dispatched first either', async () => {
    const own = H.s.db.select().from(todoTable).where(eq(todoTable.id, OWN_TASK)).get();
    const before = buildsOf(OWN_TASK);
    const err = await rejection(mcp('run_builds', { todoIds: [OWN_TASK, CROSS], assignment }));
    expect(err.status).toBe(404);
    expect(buildsOf(OWN_TASK)).toBe(before);
    expect(H.s.db.select().from(todoTable).where(eq(todoTable.id, OWN_TASK)).get()?.phase).toBe(
      own?.phase,
    );
  });

  test('U8 run_builds: assigning another team agent -> 404 agent, not one build created', async () => {
    H.s.db
      .insert(agentTable)
      .values({ id: 'agent-b-1470', teamId: TEAM_B, displayName: 'b', provider: 'p', modelId: 'm' })
      .run();
    const before = buildsOf(OWN_TASK);
    const err = await rejection(
      mcp('run_builds', {
        todoIds: [OWN_TASK],
        assignment: { build: { agentId: 'agent-b-1470' } },
      }),
    );
    expect(err.status).toBe(404);
    expect(err.message).toBe('agent agent-b-1470');
    expect(buildsOf(OWN_TASK)).toBe(before);
  });

  test('U2 schedule_todo: an own-team todo pointing at another team project -> 404 project, no schedule created', async () => {
    const err = await rejection(
      mcp('schedule_todo', { todoId: CROSS, kind: 'once', at: nextQuarter() }),
    );
    expect(err.status).toBe(404);
    expect(err.message).toBe(`project ${PROJ_B}`);
    expect(schedulesOf(CROSS)).toBe(0);
  });

  test('U7 same-team paths unchanged: run_builds and schedule_todo work as usual', async () => {
    const res = (await mcp('run_builds', { todoIds: [OWN_TASK], assignment })) as {
      builds: unknown[];
    };
    expect(res.builds.length).toBe(1);
    await mcp('schedule_todo', { todoId: OWN_TASK, kind: 'once', at: nextQuarter() });
    expect(schedulesOf(OWN_TASK)).toBe(1);
  });
});

describe('#1470 MCP conversation: cross-team and nonexistent are both 404', () => {
  test.each([
    ['build 对话', BUILD_B],
    ['chief 对话', THREAD_B],
  ])('U3 %s：他队 id 404，文案与不存在 id 同形', async (_label, id) => {
    const cross = await rejection(mcp('conversation', { conversationId: id }));
    const missingId = id.startsWith('chief-') ? `chief-${MISSING}` : MISSING;
    const missing = await rejection(mcp('conversation', { conversationId: missingId }));
    expect(cross.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(cross.message).toBe(missing.message.replace(missingId, id));
  });

  test('U7 own-team build / chief conversations read as usual', async () => {
    const own = (await mcp('conversation', { conversationId: OWN_BUILD })) as {
      messages: { content: string }[];
    };
    expect(own.messages.map((m) => m.content)).toEqual(['本队对话']);
    const chief = (await mcp('conversation', { conversationId: H.threadId })) as {
      messages: { content: string }[];
    };
    expect(chief.messages.map((m) => m.content)).toEqual(['本队 chief 对话']);
  });
});

describe('#1470 chief usage: only own-team builds and own-team chief turns are returned', () => {
  test('U4 full listing: no other-team builds / other-team chief turns', async () => {
    const rows = (await relay('usage', {})) as { buildId: string }[];
    expect(rows.map((r) => r.buildId).sort()).toEqual([OWN_BUILD, H.threadId].sort());
  });

  test('U4 by buildId: another team build returns [], an own-team build returns as usual', async () => {
    expect(await relay('usage', { buildId: BUILD_B })).toEqual([]);
    expect(await relay('usage', { buildId: THREAD_B })).toEqual([]);
    const own = (await relay('usage', { buildId: OWN_BUILD })) as { input: number }[];
    expect(own.map((r) => r.input)).toEqual([1]);
  });
});

describe('#1470 the chief envelope context.tokens: only this chief own threads are counted', () => {
  test('U9 another team chief turns do not enter the reading', () => {
    const svc = { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user };
    expect(getChiefEnvelope(svc, H.teamId).context?.tokens).toBe(2);
  });
});

describe('#1470 save_memory: projectId / sourceTodoId are team-checked', () => {
  test.each([
    ['projectId 他队', { projectId: PROJ_B }, `project ${PROJ_B}`],
    ['projectId 不存在', { projectId: MISSING }, `project ${MISSING}`],
    ['sourceTodoId 他队', { sourceTodoId: TASK_B }, `todo ${TASK_B}`],
  ])('U5 chief %s → 404，不落库', async (_label, extra, message) => {
    const before = memoryCount();
    const err = await rejection(relay('save_memory', { title: 't', content: 'c', ...extra }));
    expect(err.status).toBe(404);
    expect(err.message).toBe(message);
    expect(memoryCount()).toBe(before);
  });

  const workerCtx = () => ({
    teamId: H.teamId,
    agentId: AGENT_ID,
    todoId: OWN_TASK,
    projectId: H.projectId,
    buildId: OWN_BUILD,
    attachmentsDir: H.s.attachmentsDir,
  });

  test.each([
    ['projectId 他队', { projectId: PROJ_B }, `project ${PROJ_B}`],
    ['sourceTodoId 他队', { sourceTodoId: TASK_B }, `todo ${TASK_B}`],
  ])('U5 worker %s → 404，不落库', async (_label, extra, message) => {
    const before = memoryCount();
    const err = await rejection(
      executeWorkerMemoryTool(H.s.db, workerCtx(), 'save_memory', {
        title: 't',
        content: 'c',
        ...extra,
      }),
    );
    expect(err.status).toBe(404);
    expect(err.message).toBe(message);
    expect(memoryCount()).toBe(before);
  });

  test('U7 own-team projects store as usual (chief explicit projectId, worker default context)', async () => {
    const chief = (await relay('save_memory', {
      title: 't',
      content: 'c',
      projectId: H.projectId,
      sourceTodoId: OWN_TASK,
    })) as { projectId: string };
    expect(chief.projectId).toBe(H.projectId);
    const worker = JSON.parse(
      await executeWorkerMemoryTool(H.s.db, workerCtx(), 'save_memory', {
        title: 'w',
        content: 'worker-owned',
      }),
    ) as { projectId: string; sourceTodoId: string };
    expect(worker).toMatchObject({ projectId: H.projectId, sourceTodoId: OWN_TASK });
  });
});

describe('#1470 clone URL: legacy githubRepo goes through the same githubRepoOfProject gate', () => {
  function githubRow(githubRepo: string) {
    return {
      id: `proj-${newUuidv7()}`,
      name: 'g',
      teamId: H.teamId,
      description: null,
      repoKind: 'github' as const,
      repoName: null,
      githubRepo,
      localPath: '/abs/checkout',
    };
  }

  test.each(['../user', 'a/..', 'no-slash'])('U6 %s: no clone URL, no repo binding', (value) => {
    const row = githubRow(value) as Parameters<typeof projectRepoRef>[0] & object;
    expect(projectRepoRef(row, 'http://h')).toBeNull();
    expect(hasRepoBinding(row)).toBe(false);
    expect(toProjectRecord(row, 'http://h').cloneUrl).toBeUndefined();
    expect(toProjectRecord(row, 'http://h').githubRepo).toBe(value);
  });

  test('U7 a legal owner/repo: the clone URL and the accelerator unchanged', () => {
    const row = githubRow('octo/alpha') as Parameters<typeof projectRepoRef>[0] & object;
    expect(projectRepoRef(row, 'http://h')).toEqual({
      kind: 'github',
      cloneUrl: 'https://github.com/octo/alpha.git',
      localPath: '/abs/checkout',
    });
    expect(toProjectRecord(row, 'http://h').cloneUrl).toBe('https://github.com/octo/alpha.git');
  });
});
