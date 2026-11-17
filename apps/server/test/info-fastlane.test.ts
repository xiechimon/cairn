import { INFO_OUTPUT_KINDS, todoRecordSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import { build as buildTable, todo as todoTable } from '../src/db/schema.js';
import { storeInfoReport } from '../src/services/info-handoff.js';
import { bootServer, req } from './helpers.js';

const servers: Array<ReturnType<typeof bootServer>> = [];
afterAll(() => {
  for (const server of servers) server.dispose();
});

describe('#1626 info cards', () => {
  test('report stored as a retrievable attachment, the card merge entry refuses', async () => {
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

  test('the finer non-code kinds round-trip through the todo API and refuse merge', async () => {
    const server = bootServer();
    servers.push(server);
    const project = await req(server.app, 'POST', '/api/projects', { name: 'kinds' });
    const projectId = ((await project.json()) as { id: string }).id;
    for (const output of INFO_OUTPUT_KINDS) {
      const created = await req(server.app, 'POST', `/api/projects/${projectId}/todos`, {
        title: `${output} card`,
        spec: 'deliverable',
        output,
      });
      expect(created.status).toBe(201);
      const todoId = ((await created.json()) as { id: string }).id;
      const fetched = await req(server.app, 'GET', `/api/todos/${todoId}`);
      expect(fetched.status).toBe(200);
      expect(todoRecordSchema.parse(await fetched.json()).output).toBe(output);

      const buildId = `${output}-build-1`;
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
        .set({ phase: 'review', latestBuildId: buildId })
        .where(eq(todoTable.id, todoId))
        .run();
      const merged = await req(server.app, 'POST', `/api/builds/${buildId}/merge`, {});
      expect(merged.status).toBe(409);
      expect(await merged.text()).toContain('报告附件');
    }
  });

  test('an unknown output kind is rejected at create', async () => {
    const server = bootServer();
    servers.push(server);
    const project = await req(server.app, 'POST', '/api/projects', { name: 'bad-kind' });
    const projectId = ((await project.json()) as { id: string }).id;
    const created = await req(server.app, 'POST', `/api/projects/${projectId}/todos`, {
      title: 'media card',
      spec: 'deliverable',
      output: 'media',
    });
    expect(created.status).toBe(400);
  });
});
