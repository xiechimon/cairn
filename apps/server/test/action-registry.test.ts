import { existsSync } from 'node:fs';
import { type ActionEntry, projectRecordSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  actionJournal,
  project as projectTable,
  step,
  team as teamTable,
} from '../src/db/schema.js';
import { HttpError } from '../src/lib/errors.js';
import { executeAction } from '../src/services/action-registry.js';
import { type ChiefToolCtx, executeChiefTool } from '../src/services/chief-tools.js';
import { repoDirFor } from '../src/services/git.js';
import { bootServer, req } from './helpers.js';

const ownerOnly: ActionEntry = {
  id: 'test.owner-only',
  toolName: 'test_owner_only',
  inputSchema: z.object({ projectId: z.string().min(1) }).strict(),
  outputSchema: z.object({ projectId: z.string() }).strict(),
  scope: 'project',
  class: 'owner-only',
  standingGrant: false,
  inverse: null,
  surfaces: ['web'],
  targetOf: (input) => (input as { projectId: string }).projectId,
};

function world() {
  const s = bootServer();
  s.db.insert(projectTable).values({ id: 'project-a', teamId: s.team.id, name: 'Alpha' }).run();
  return s;
}

function journals(s: ReturnType<typeof world>) {
  return s.db.select().from(actionJournal).all();
}

function chiefCtx(s: ReturnType<typeof world>): ChiefToolCtx {
  return {
    teamId: s.team.id,
    userId: s.user.id,
    chiefId: 'chief-a',
    threadId: 'thread-a',
    chiefAgentId: 'agent-a',
    conversationId: 'thread-a',
  };
}

async function chiefAction(s: ReturnType<typeof world>, name: string, projectId: string) {
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
    },
    chiefCtx(s),
    name,
    { projectId },
  );
  return JSON.parse(text) as { status: string; journalId?: string; output?: unknown };
}

function expectStatus(run: () => void, status: number): void {
  try {
    run();
    expect.fail('expected execute to throw');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(status);
  }
}

describe('action registry execute', () => {
  test('unknown id or bad input writes nothing', () => {
    const s = world();
    const deps = { db: s.db, reposDir: s.reposDir };
    expectStatus(
      () =>
        executeAction(deps, {
          id: 'project.missing',
          input: { projectId: 'project-a' },
          actor: 'user',
          surface: 'web',
          teamId: s.team.id,
        }),
      400,
    );
    expectStatus(
      () =>
        executeAction(deps, {
          id: 'project.archive',
          input: { projectId: '' },
          actor: 'user',
          surface: 'web',
          teamId: s.team.id,
        }),
      400,
    );
    expect(journals(s)).toEqual([]);
    expect(s.db.select().from(projectTable).get()?.archivedAt ?? null).toBeNull();
    s.dispose();
  });

  test('owner-only id writes nothing', () => {
    const s = world();
    expectStatus(
      () =>
        executeAction(
          { db: s.db, reposDir: s.reposDir },
          {
            id: ownerOnly.id,
            input: { projectId: 'project-a' },
            actor: 'user',
            surface: 'web',
            teamId: s.team.id,
            registry: [ownerOnly],
          },
        ),
      403,
    );
    expect(journals(s)).toEqual([]);
    s.dispose();
  });

  test('missing target or another team writes nothing', () => {
    const s = world();
    s.db.insert(teamTable).values({ id: 'team-other', name: 'Other', createdAt: 0 }).run();
    s.db
      .insert(projectTable)
      .values({ id: 'project-other', teamId: 'team-other', name: 'Elsewhere' })
      .run();
    const deps = { db: s.db, reposDir: s.reposDir };
    for (const projectId of ['missing', 'project-other']) {
      expectStatus(
        () =>
          executeAction(deps, {
            id: 'project.archive',
            input: { projectId },
            actor: 'user',
            surface: 'web',
            teamId: s.team.id,
          }),
        404,
      );
      expectStatus(
        () =>
          executeAction(deps, {
            id: 'project.delete',
            input: { projectId },
            actor: 'user',
            surface: 'web',
            teamId: s.team.id,
          }),
        404,
      );
    }
    expect(journals(s)).toEqual([]);
    expect(
      s.db.select().from(projectTable).where(eq(projectTable.id, 'project-other')).get()?.id,
    ).toBe('project-other');
    s.dispose();
  });

  test('a surface that is not listed writes nothing', () => {
    const s = world();
    expectStatus(
      () =>
        executeAction(
          { db: s.db, reposDir: s.reposDir },
          {
            id: 'project.delete',
            input: { projectId: 'project-a' },
            actor: 'user',
            surface: 'mcp',
            teamId: s.team.id,
          },
        ),
      403,
    );
    expect(journals(s)).toEqual([]);
    expect(s.db.select().from(projectTable).get()?.id).toBe('project-a');
    s.dispose();
  });

  test('user archive, unarchive, and delete journal one row in the same transaction', async () => {
    const s = world();
    const archived = await req(s.app, 'POST', '/api/projects/project-a/archive');
    expect(archived.status).toBe(200);
    expect(((await archived.json()) as { archivedAt: number | null }).archivedAt).toEqual(
      expect.any(Number),
    );
    expect(journals(s)).toHaveLength(1);
    const restored = await req(s.app, 'POST', '/api/projects/project-a/unarchive');
    expect(restored.status).toBe(200);
    expect(((await restored.json()) as { archivedAt: number | null }).archivedAt).toBeNull();
    expect(journals(s).map((row) => row.actionId)).toEqual([
      'project.archive',
      'project.unarchive',
    ]);
    expect((await req(s.app, 'DELETE', '/api/projects/project-a')).status).toBe(204);
    expect(s.db.select().from(projectTable).all()).toEqual([]);
    expect(journals(s).map((row) => row.kind)).toEqual(['run', 'run', 'run']);
    s.dispose();
  });

  test('a handler error rolls the delete back and does not remove the hosted directory', async () => {
    const s = bootServer();
    const created = projectRecordSchema.parse(
      await (
        await req(s.app, 'POST', '/api/projects', { name: 'Hosted Repo', repoKind: 'hosted' })
      ).json(),
    );
    const dir = repoDirFor(s.reposDir, s.team.id, created.repoName ?? '');
    expect(existsSync(dir)).toBe(true);
    s.db
      .insert(step)
      .values({
        id: 'running',
        buildId: 'build',
        kind: 'chief',
        status: 'pending',
        scopeProjectId: created.id,
        createdAt: 1,
      })
      .run();
    const response = await req(s.app, 'DELETE', `/api/projects/${created.id}`);
    expect(response.status).toBe(409);
    expect(existsSync(dir)).toBe(true);
    expect(s.db.select().from(projectTable).where(eq(projectTable.id, created.id)).get()?.id).toBe(
      created.id,
    );
    expect(journals(s)).toEqual([]);
    s.dispose();
  });

  test('a journal row has no value, token, secret, or password field', () => {
    const names = getTableConfig(actionJournal).columns.map((column) => column.name);
    for (const forbidden of ['value', 'token', 'secret', 'password']) {
      expect(names).not.toContain(forbidden);
    }
  });

  test('coordinator archive and unarchive run through execute and journal the actor', async () => {
    const s = world();
    await expect(chiefAction(s, 'archive_project', 'missing')).rejects.toMatchObject({
      status: 404,
    });
    expect(journals(s)).toEqual([]);
    const archived = await chiefAction(s, 'archive_project', 'project-a');
    expect(archived).toMatchObject({
      status: 'executed',
      output: { projectId: 'project-a' },
    });
    expect(s.db.select().from(projectTable).get()?.archivedAt).toEqual(expect.any(Number));
    const unarchived = await chiefAction(s, 'unarchive_project', 'project-a');
    expect(unarchived).toMatchObject({
      status: 'executed',
      output: { projectId: 'project-a', archivedAt: null },
    });
    expect(s.db.select().from(projectTable).get()?.archivedAt).toBeNull();
    expect(journals(s).map((row) => [row.actionId, row.actor, row.surface, row.kind])).toEqual([
      ['project.archive', 'coordinator', 'coordinator', 'run'],
      ['project.unarchive', 'coordinator', 'coordinator', 'run'],
    ]);
    s.dispose();
  });
});
