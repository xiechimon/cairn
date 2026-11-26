import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import { build as buildTable, designVersion, todo as todoTable } from '../src/db/schema.js';
import { artifactOfAttachment } from '../src/services/design.js';
import { backfillInfoReportVersions, storeInfoReport } from '../src/services/info-handoff.js';
import { bootServer, req } from './helpers.js';

const servers: Array<ReturnType<typeof bootServer>> = [];
afterAll(() => {
  for (const server of servers) server.dispose();
});

describe('info report design versioning', () => {
  test('storeInfoReport records a document design_version and increments on changed reports', async () => {
    const server = bootServer();
    servers.push(server);
    const project = await req(server.app, 'POST', '/api/projects', { name: 'reports' });
    const projectId = ((await project.json()) as { id: string }).id;
    const createdTodo = await req(server.app, 'POST', `/api/projects/${projectId}/todos`, {
      title: 'Research cache',
      spec: 'Write report',
      output: 'info',
    });
    const todoId = ((await createdTodo.json()) as { id: string }).id;
    const buildId = 'info-version-build-1';
    server.db
      .insert(buildTable)
      .values({
        id: buildId,
        todoId,
        withPlan: false,
        triggerSource: 'user',
        changes: null,
        createdAt: 1000,
      })
      .run();
    server.db
      .update(todoTable)
      .set({ phase: 'review', latestBuildId: buildId })
      .where(eq(todoTable.id, todoId))
      .run();

    const firstId = storeInfoReport(
      { db: server.db, attachmentsDir: server.attachmentsDir },
      { buildId, teamId: server.team.id, createdBy: server.user.id, report: '# v1\n\nInitial\n' },
    );
    const firstArtifact = artifactOfAttachment(server.db, server.team.id, firstId);
    expect(firstArtifact.todoId).toBe(todoId);
    expect(firstArtifact.fileName).toBe('report.md');
    expect(firstArtifact.kind).toBe('document');
    expect(firstArtifact.versionSeq).toBe(1);
    expect(firstArtifact.versionCount).toBe(1);

    storeInfoReport(
      { db: server.db, attachmentsDir: server.attachmentsDir },
      { buildId, teamId: server.team.id, createdBy: server.user.id, report: '# v1\n\nInitial\n' },
    );
    expect(artifactOfAttachment(server.db, server.team.id, firstId).versionCount).toBe(1);

    const build2Id = 'info-version-build-2';
    server.db
      .insert(buildTable)
      .values({
        id: build2Id,
        todoId,
        withPlan: false,
        triggerSource: 'user',
        changes: null,
        createdAt: 2000,
      })
      .run();
    const secondId = storeInfoReport(
      { db: server.db, attachmentsDir: server.attachmentsDir },
      {
        buildId: build2Id,
        teamId: server.team.id,
        createdBy: server.user.id,
        report: '# v2\n\nUpdated\n',
      },
    );
    const secondArtifact = artifactOfAttachment(server.db, server.team.id, secondId);
    expect(secondArtifact.versionSeq).toBe(2);
    expect(secondArtifact.versionCount).toBe(2);
  });

  test('backfillInfoReportVersions backfills legacy info reports idempotently in build order', async () => {
    const server = bootServer();
    servers.push(server);
    const project = await req(server.app, 'POST', '/api/projects', { name: 'legacy-reports' });
    const projectId = ((await project.json()) as { id: string }).id;
    const createdTodo = await req(server.app, 'POST', `/api/projects/${projectId}/todos`, {
      title: 'Legacy research',
      spec: 'Write report',
      output: 'info',
    });
    const todoId = ((await createdTodo.json()) as { id: string }).id;
    server.db
      .insert(buildTable)
      .values([
        {
          id: 'legacy-build-1',
          todoId,
          withPlan: false,
          triggerSource: 'user',
          changes: null,
          createdAt: 1000,
        },
        {
          id: 'legacy-build-2',
          todoId,
          withPlan: false,
          triggerSource: 'user',
          changes: null,
          createdAt: 2000,
        },
      ])
      .run();

    const att1 = storeInfoReport(
      { db: server.db, attachmentsDir: server.attachmentsDir },
      {
        buildId: 'legacy-build-1',
        teamId: server.team.id,
        createdBy: server.user.id,
        report: '# Legacy 1\n',
      },
    );
    const att2 = storeInfoReport(
      { db: server.db, attachmentsDir: server.attachmentsDir },
      {
        buildId: 'legacy-build-2',
        teamId: server.team.id,
        createdBy: server.user.id,
        report: '# Legacy 2\n',
      },
    );
    server.db.delete(designVersion).where(eq(designVersion.todoId, todoId)).run();

    const backfilled = backfillInfoReportVersions(server.db, server.attachmentsDir);
    expect(backfilled).toBe(2);

    expect(artifactOfAttachment(server.db, server.team.id, att1)).toMatchObject({
      todoId,
      fileName: 'report.md',
      kind: 'document',
      versionSeq: 1,
      versionCount: 2,
    });
    expect(artifactOfAttachment(server.db, server.team.id, att2)).toMatchObject({
      todoId,
      fileName: 'report.md',
      kind: 'document',
      versionSeq: 2,
      versionCount: 2,
    });

    expect(backfillInfoReportVersions(server.db, server.attachmentsDir)).toBe(0);
  });
});
