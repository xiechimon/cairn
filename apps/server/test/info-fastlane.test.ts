import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import { build as buildTable, todo as todoTable } from '../src/db/schema.js';
import { storeInfoReport } from '../src/services/info-handoff.js';
import { bootServer, req } from './helpers.js';

const servers: Array<ReturnType<typeof bootServer>> = [];
afterAll(() => {
  for (const server of servers) server.dispose();
});

describe('#1626 信息类卡', () => {
  test('报告存成可取回附件，卡的合并入口拒绝', async () => {
    const server = bootServer();
    servers.push(server);
    const project = await req(server.app, 'POST', '/api/projects', { name: 'info' });
    const projectId = ((await project.json()) as { id: string }).id;
    const todo = await req(server.app, 'POST', `/api/projects/${projectId}/todos`, {
      title: '调研',
      spec: '写报告',
    });
    const todoId = ((await todo.json()) as { id: string }).id;
    const buildId = 'info-build-1';
    server.db
      .insert(buildTable)
      .values({
        id: buildId,
        todoId,
        withPlan: false,
        triggerSource: 'user',
        changes: null,
        createdAt: Date.now(),
      })
      .run();
    server.db
      .update(todoTable)
      .set({ output: 'info', phase: 'review', latestBuildId: buildId })
      .where(eq(todoTable.id, todoId))
      .run();
    const attachmentId = storeInfoReport(
      { db: server.db, attachmentsDir: server.attachmentsDir },
      { buildId, teamId: server.team.id, createdBy: server.user.id, report: '# 结论\n' },
    );

    const fetched = await req(server.app, 'GET', `/api/attachments/${attachmentId}`);
    expect(fetched.status).toBe(200);
    expect(await fetched.text()).toContain('# 结论');

    const merged = await req(server.app, 'POST', `/api/builds/${buildId}/merge`, {});
    expect(merged.status).toBe(409);
    expect(await merged.text()).toContain('报告附件');
  });
});
