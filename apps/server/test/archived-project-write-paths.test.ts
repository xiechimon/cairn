import { describe, expect, test } from 'vitest';
import { build, project, todo } from '../src/db/schema.js';
import type { ChiefToolDeps } from '../src/services/chief-tools.js';
import { executeThreadMcpTool } from '../src/services/mcp-threads.js';
import { bootServer, req } from './helpers.js';

const PROJECT = 'project-readonly';
const CARD = 'todo-readonly';
const ARCHIVED = `project ${PROJECT} is archived; unarchive it before changing it`;

function world() {
  const s = bootServer();
  s.db.insert(project).values({ id: PROJECT, teamId: s.team.id, name: 'Read only' }).run();
  s.db
    .insert(todo)
    .values({
      id: CARD,
      teamId: s.team.id,
      projectId: PROJECT,
      title: 'Read only',
      spec: 'spec',
      phase: 'todo',
      phaseAt: Date.now(),
      seqNum: 1,
      latestBuildId: 'build-readonly',
    })
    .run();
  s.db
    .insert(build)
    .values({
      id: 'build-readonly',
      todoId: CARD,
      withPlan: false,
      prevPhase: 'todo',
      triggerSource: 'user',
      createdAt: Date.now(),
      changes: [],
    })
    .run();
  return s;
}

async function archive(s: ReturnType<typeof bootServer>) {
  expect((await req(s.app, 'POST', `/api/projects/${PROJECT}/archive`)).status).toBe(200);
}

describe('an archived project refuses every todo write path', () => {
  test('start, steer, edit and create answer 409 with the archived message', async () => {
    const s = world();
    await archive(s);
    const start = await req(s.app, 'POST', `/api/todos/${CARD}/orchestrate`);
    expect(start.status).toBe(409);
    expect(((await start.json()) as { error: string }).error).toBe(ARCHIVED);
    const steer = await req(s.app, 'POST', `/api/todos/${CARD}/messages`, {
      content: 'go',
      clientMessageId: 'client-1',
    });
    expect(steer.status).toBe(409);
    expect(((await steer.json()) as { error: string }).error).toBe(ARCHIVED);
    const edit = await req(s.app, 'PATCH', `/api/todos/${CARD}`, { title: 'renamed' });
    expect(edit.status).toBe(409);
    expect(((await edit.json()) as { error: string }).error).toBe(ARCHIVED);
    const create = await req(s.app, 'POST', `/api/projects/${PROJECT}/todos`, {
      title: 'new',
      spec: 'spec',
    });
    expect(create.status).toBe(409);
    expect(((await create.json()) as { error: string }).error).toBe(ARCHIVED);
    s.dispose();
  });

  test('reads stay allowed and unarchive restores the writes', async () => {
    const s = world();
    await archive(s);
    const read = await req(s.app, 'GET', `/api/todos/${CARD}`);
    expect(read.status).toBe(200);
    expect((await req(s.app, 'POST', `/api/projects/${PROJECT}/unarchive`)).status).toBe(200);
    const edit = await req(s.app, 'PATCH', `/api/todos/${CARD}`, { title: 'renamed' });
    expect(edit.status).toBe(200);
    expect(((await edit.json()) as { title: string }).title).toBe('renamed');
    s.dispose();
  });

  test('the project, its tasks and its todo lists stay readable while archived', async () => {
    const s = world();
    await archive(s);
    const projects = (await (await req(s.app, 'GET', '/api/projects')).json()) as {
      id: string;
      archivedAt: number | null;
    }[];
    expect(projects.find((row) => row.id === PROJECT)?.archivedAt).toEqual(expect.any(Number));
    const own = (await (await req(s.app, 'GET', `/api/projects/${PROJECT}/todos`)).json()) as {
      id: string;
    }[];
    expect(own.map((row) => row.id)).toEqual([CARD]);
    const team = (await (await req(s.app, 'GET', '/api/todos')).json()) as { id: string }[];
    expect(team.map((row) => row.id)).toContain(CARD);
    const tasks = (await (await req(s.app, 'GET', '/api/tasks')).json()) as {
      entries: { kind: string; id?: string }[];
    };
    expect(tasks.entries.some((entry) => entry.kind === 'todo' && entry.id === CARD)).toBe(true);
    s.dispose();
  });

  test('moving a todo into an archived project is refused', async () => {
    const s = world();
    s.db.insert(project).values({ id: 'project-archived', teamId: s.team.id, name: 'A' }).run();
    expect((await req(s.app, 'POST', '/api/projects/project-archived/archive')).status).toBe(200);
    const move = await req(s.app, 'PATCH', `/api/todos/${CARD}`, { projectId: 'project-archived' });
    expect(move.status).toBe(409);
    s.dispose();
  });

  test('the MCP reply_thread tool refuses a work thread in an archived project', async () => {
    const s = world();
    await archive(s);
    const deps = { ...s.svc, box: s.secretBox } as unknown as ChiefToolDeps;
    for (const mode of [undefined, 'steer'] as const) {
      await expect(
        executeThreadMcpTool(deps, s.team.id, 'reply_thread', {
          threadId: CARD,
          content: 'keep going',
          ...(mode === undefined ? {} : { mode }),
        }),
      ).rejects.toThrow(ARCHIVED);
    }
    s.dispose();
  });

  test('the MCP start_thread tool refuses an archived project', async () => {
    const s = world();
    await archive(s);
    const deps = { ...s.svc, box: s.secretBox } as unknown as ChiefToolDeps;
    await expect(
      executeThreadMcpTool(deps, s.team.id, 'start_thread', {
        projectId: PROJECT,
        content: 'do the thing',
      }),
    ).rejects.toThrow(ARCHIVED);
    s.dispose();
  });
});
