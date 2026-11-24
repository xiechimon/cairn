import { SESSION_BRIEF } from '@cairn/shared';
import { desc, eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { build, step, todo } from '../src/db/schema.js';
import { restartFailedBuild } from '../src/services/build-restart.js';
import { startBuilds } from '../src/services/build-start.js';
import { getTodo } from '../src/services/todos.js';
import { bootServer, insertMachine, req, type TestServer } from './helpers.js';

const servers: TestServer[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.dispose();
});

async function setupServer(output: 'code' | 'info') {
  const s = bootServer({ githubFetch: async () => new Response('[]') });
  servers.push(s);
  insertMachine(s, { name: 'runner' });
  const projectRes = await req(s.app, 'POST', '/api/projects', { name: 'export-prompt' });
  const projectId = ((await projectRes.json()) as { id: string }).id;
  const created = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: output === 'info' ? '导出简历为 PNG 图片' : '实现功能',
    spec: output === 'info' ? '导出成图片发给我。' : '写代码并测试。',
    output,
  });
  const todoId = ((await created.json()) as { id: string }).id;
  return { s, projectId, todoId };
}

describe('info task step prompt brief', () => {
  test('info tasks omit coding SESSION_BRIEF on start and restart while code tasks keep it', async () => {
    const info = await setupServer('info');
    const [infoBuild] = startBuilds(
      { db: info.s.db, hub: info.s.hub, machineHub: info.s.machineHub, user: info.s.user },
      { projectId: info.projectId, todoIds: [info.todoId] },
    );
    const firstStep = info.s.db.select().from(step).where(eq(step.buildId, infoBuild!.id)).get();
    expect(firstStep?.prompt ?? '').not.toContain('1. Plan');
    expect(firstStep?.prompt ?? '').not.toContain('Write tests first');
    expect(firstStep?.prompt ?? '').not.toContain(SESSION_BRIEF);

    info.s.db.update(step).set({ status: 'failed' }).where(eq(step.id, firstStep!.id)).run();
    info.s.db.update(todo).set({ phase: 'failed' }).where(eq(todo.id, info.todoId)).run();
    const buildRow = info.s.db.select().from(build).where(eq(build.id, infoBuild!.id)).get()!;
    const deps = {
      db: info.s.db,
      hub: info.s.hub,
      machineHub: info.s.machineHub,
      user: info.s.user,
      convHub: info.s.convHub,
    };
    const failedTodo = getTodo(deps, info.todoId)!;
    await restartFailedBuild(
      deps,
      buildRow,
      failedTodo,
      { feedback: '重新导出高清图', clientMessageId: 'cm-restart-1' },
      info.s.user.displayName,
      'person',
      undefined,
    );
    const restartedTodo = info.s.db.select().from(todo).where(eq(todo.id, info.todoId)).get();
    const restartStep = info.s.db
      .select()
      .from(step)
      .where(eq(step.buildId, restartedTodo!.latestBuildId!))
      .orderBy(desc(step.createdAt))
      .get();
    expect(restartStep?.prompt ?? '').toContain('重新导出高清图');
    expect(restartStep?.prompt ?? '').not.toContain(SESSION_BRIEF);

    const code = await setupServer('code');
    const [codeBuild] = startBuilds(
      { db: code.s.db, hub: code.s.hub, machineHub: code.s.machineHub, user: code.s.user },
      { projectId: code.projectId, todoIds: [code.todoId] },
    );
    const codeStep = code.s.db.select().from(step).where(eq(step.buildId, codeBuild!.id)).get();
    expect(codeStep?.prompt).toContain(SESSION_BRIEF);
  });
});
