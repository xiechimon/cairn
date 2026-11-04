import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  build as buildTable,
  chief as chiefTable,
  project as projectTable,
  team as teamTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { HttpError } from '../src/lib/errors.js';
import { nowMs } from '../src/lib/ids.js';
import { executeMcpTool } from '../src/services/mcp-face.js';
import { AGENT_ID, H, registerChiefHarness, relay, toolDeps } from './chief-harness.js';

registerChiefHarness();

const TEAM_B = 'team-b-1466';
const PROJ_B = 'proj-b-1466';
const TASK_B = 'todo-b-1466';
const MISSING = 'proj-missing-1466';
const CROSS = 'todo-cross-1466';

beforeEach(() => {
  const now = nowMs();
  H.s.db.insert(teamTable).values({ id: TEAM_B, name: 'B', createdAt: now }).run();
  H.s.db
    .insert(projectTable)
    .values({ id: PROJ_B, name: 'beta', teamId: TEAM_B, repoKind: 'github', githubRepo: 'b/beta' })
    .run();
  H.s.db
    .insert(todoTable)
    .values({
      id: TASK_B,
      teamId: TEAM_B,
      projectId: PROJ_B,
      title: '他队任务',
      spec: '',
      phase: 'todo',
      phaseAt: now,
      seqNum: 1,
    })
    .run();
});

async function chiefError(name: string, params: Record<string, unknown>): Promise<HttpError> {
  const err = await relay(name, params).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, name).toBeInstanceOf(HttpError);
  return err as HttpError;
}

async function mcp(name: string, args: Record<string, unknown>): Promise<unknown> {
  return JSON.parse(
    await executeMcpTool(
      toolDeps(),
      { teamId: H.teamId, user: H.s.user, grants: new Set(['Todos', 'Create Todo']) },
      name,
      args,
    ),
  );
}

async function mcpError(name: string, args: Record<string, unknown>): Promise<HttpError> {
  const err = await mcp(name, args).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, name).toBeInstanceOf(HttpError);
  return err as HttpError;
}

function projectB() {
  return H.s.db.select().from(projectTable).where(eq(projectTable.id, PROJ_B)).get();
}

function todosInProject(projectId: string) {
  return H.s.db.select().from(todoTable).where(eq(todoTable.projectId, projectId)).all();
}

function chiefWatchIds(): string[] {
  const row = H.s.db.select().from(chiefTable).where(eq(chiefTable.id, H.chiefId)).get();
  return (row?.watches ?? []).map((w) => w.todoId);
}

function insertCrossTodo(): void {
  H.s.db
    .insert(todoTable)
    .values({
      id: CROSS,
      teamId: H.teamId,
      projectId: PROJ_B,
      title: '本队任务、他队项目',
      spec: '',
      phase: 'todo',
      phaseAt: nowMs(),
      seqNum: 900,
    })
    .run();
}

async function createOwnTodo(): Promise<string> {
  const created = (await relay('create_todo', {
    projectId: H.projectId,
    title: '本队任务',
    spec: 's',
  })) as { id: string };
  return created.id;
}

function todoState(todoId: string) {
  const row = H.s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get();
  const builds = H.s.db.select().from(buildTable).where(eq(buildTable.todoId, todoId)).all();
  return { phase: row?.phase, builds: builds.length };
}

describe('#1466 the chief tool surface: a cross-team project id = 404 (same shape as nonexistent)', () => {
  const projectFaces: [string, (projectId: string) => Record<string, unknown>][] = [
    ['docs', (projectId) => ({ projectId, paths: [] })],
    ['create_todo', (projectId) => ({ projectId, title: '越权任务', spec: 's' })],
    ['update_project', (projectId) => ({ projectId, name: 'hijacked' })],
    ['connect_repo', (projectId) => ({ projectId, githubRepo: 'evil/repo' })],
  ];

  test.each(projectFaces)(
    'T1-T4/T7 %s：他队项目 404，文案与不存在 id 同形',
    async (name, params) => {
      const cross = await chiefError(name, params(PROJ_B));
      const missing = await chiefError(name, params(MISSING));
      expect(cross.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(cross.message).toBe(missing.message.replace(MISSING, PROJ_B));
    },
  );

  test('T2-T4 unauthorized calls have no side effects: the other team project name / repo / task set unchanged', async () => {
    for (const [name, params] of projectFaces) await chiefError(name, params(PROJ_B));
    expect(projectB()?.name).toBe('beta');
    expect(projectB()?.githubRepo).toBe('b/beta');
    expect(todosInProject(PROJ_B).map((t) => t.id)).toEqual([TASK_B]);
  });

  test('T5 todos: a cross-team projectId and a nonexistent id both return []', async () => {
    expect(await relay('todos', { projectId: PROJ_B })).toEqual({
      todos: [],
      total: 0,
      nextOffset: null,
    });
    expect(await relay('todos', { projectId: MISSING })).toEqual({
      todos: [],
      total: 0,
      nextOffset: null,
    });
  });

  test('T6 watch_todos: cross-team and nonexistent todos are skipped alike, none enters this team watch', async () => {
    await relay('watch_todos', { todoIds: [TASK_B, 'todo-missing-1466'] });
    expect(chiefWatchIds()).toEqual([]);
  });

  test('T9 run_builds: an own-team todo pointing at another team project -> 404, no build created, the phase unchanged, no watch added', async () => {
    insertCrossTodo();
    const own = await createOwnTodo();
    const runBuilds = (todoIds: string[]) =>
      chiefError('run_builds', { todoIds, assignment: { build: { agentId: AGENT_ID } } });
    const single = await runBuilds([CROSS]);
    expect(single.status).toBe(404);
    expect(single.message).toBe(`project ${PROJ_B}`);
    expect(todoState(CROSS)).toEqual({ phase: 'todo', builds: 0 });
    const mixed = await runBuilds([own, CROSS]);
    expect(mixed.status).toBe(404);
    expect(todoState(own)).toEqual({ phase: 'todo', builds: 0 });
    expect(todoState(CROSS)).toEqual({ phase: 'todo', builds: 0 });
    expect(chiefWatchIds()).toEqual([]);
  });

  test('T10 a mixed watch_todos list containing an own-team todo pointing at another team project -> 404, nothing watched', async () => {
    insertCrossTodo();
    const own = await createOwnTodo();
    const err = await chiefError('watch_todos', { todoIds: [own, CROSS] });
    expect(err.status).toBe(404);
    expect(err.message).toBe(`project ${PROJ_B}`);
    expect(chiefWatchIds()).toEqual([]);
  });

  test('T8 same-team paths unchanged: docs / create_todo / update_project / connect_repo / todos / watch_todos', async () => {
    const docs = (await relay('docs', { projectId: H.projectId, paths: [] })) as { name: string };
    expect(docs.name).toBe('demo');
    const created = (await relay('create_todo', {
      projectId: H.projectId,
      title: '本队任务',
      spec: 's',
    })) as { id: string; projectId: string };
    expect(created.projectId).toBe(H.projectId);
    const listed = (await relay('todos', { projectId: H.projectId })) as {
      todos: { id: string }[];
    };
    expect(listed.todos.map((t) => t.id)).toContain(created.id);
    await relay('watch_todos', { todoIds: [created.id] });
    expect(chiefWatchIds()).toEqual([created.id]);
    expect(await relay('update_project', { projectId: H.projectId, name: 'renamed' })).toEqual({
      id: H.projectId,
      name: 'renamed',
    });
    expect(
      await relay('connect_repo', { projectId: H.projectId, githubRepo: 'octo/alpha' }),
    ).toEqual({ id: H.projectId, repoKind: 'github', githubRepo: 'octo/alpha' });
  });
});

describe('#1466 the MCP tool surface: a cross-team project id = 404 (same shape as nonexistent)', () => {
  test('T2/T7 create_todo: another team project 404, no todo created', async () => {
    const cross = await mcpError('create_todo', { projectId: PROJ_B, title: 't', spec: 's' });
    const missing = await mcpError('create_todo', { projectId: MISSING, title: 't', spec: 's' });
    expect(cross.status).toBe(404);
    expect(cross.message).toBe(missing.message.replace(MISSING, PROJ_B));
    expect(todosInProject(PROJ_B).map((t) => t.id)).toEqual([TASK_B]);
  });

  test('T5 todos: a cross-team projectId and a nonexistent id both return []', async () => {
    expect(await mcp('todos', { projectId: PROJ_B })).toEqual([]);
    expect(await mcp('todos', { projectId: MISSING })).toEqual([]);
  });

  test('T8 same-team paths unchanged: create_todo + todos', async () => {
    const created = (await mcp('create_todo', {
      projectId: H.projectId,
      title: 'MCP 本队任务',
      spec: 's',
    })) as { id: string; projectId: string };
    expect(created.projectId).toBe(H.projectId);
    const listed = (await mcp('todos', { projectId: H.projectId })) as { id: string }[];
    expect(listed.map((t) => t.id)).toContain(created.id);
  });
});
