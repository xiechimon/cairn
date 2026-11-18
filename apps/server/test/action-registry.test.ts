import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { type ActionEntry, projectRecordSchema } from '@cairn/shared';
import { eq, sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  actionJournal,
  chief,
  chiefThread,
  project as projectTable,
  step,
  team as teamTable,
} from '../src/db/schema.js';
import { HttpError } from '../src/lib/errors.js';
import { executeAction, undoJournalEntry } from '../src/services/action-registry.js';
import { type ChiefToolCtx, executeChiefTool } from '../src/services/chief-tools.js';
import { repoDirFor } from '../src/services/git.js';
import { createPairedDevice } from '../src/services/paired-devices.js';
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

function httpError(run: () => void): HttpError {
  try {
    run();
    expect.fail('expected a thrown HttpError');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    return error as HttpError;
  }
}

function runAction(
  s: ReturnType<typeof world>,
  id = 'project.archive',
  projectId = 'project-a',
): string {
  const result = executeAction(
    { db: s.db, reposDir: s.reposDir },
    {
      id,
      input: { projectId },
      actor: 'user',
      surface: 'web',
      teamId: s.team.id,
    },
  );
  if (result.status !== 'executed') throw new Error('expected the action to execute');
  return result.journalId;
}

function undo(s: ReturnType<typeof world>, journalId: string) {
  return undoJournalEntry(
    { db: s.db },
    { journalId, teamId: s.team.id, actor: 'user', surface: 'web' },
  );
}

function archivedAt(s: ReturnType<typeof world>): number | null | undefined {
  return s.db.select().from(projectTable).where(eq(projectTable.id, 'project-a')).get()?.archivedAt;
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

describe('journal undo', () => {
  const inputHashOf = (input: unknown) =>
    createHash('sha256').update(JSON.stringify(input)).digest('hex');

  test('undoing an archive run unarchives the project and journals an undo row', () => {
    const s = world();
    const runId = runAction(s);
    const undone = undo(s, runId);
    expect(archivedAt(s)).toBeNull();
    expect(journals(s)).toEqual([
      expect.objectContaining({ id: runId, actionId: 'project.archive', kind: 'run' }),
      expect.objectContaining({
        id: undone.journalId,
        actionId: 'project.unarchive',
        targetId: 'project-a',
        actor: 'user',
        surface: 'web',
        kind: 'undo',
        inputHash: inputHashOf({ projectId: 'project-a' }),
      }),
    ]);
    s.dispose();
  });

  test('undoing the undo row re-applies the original action', () => {
    const s = world();
    const undone = undo(s, runAction(s));
    const redone = undo(s, undone.journalId);
    expect(archivedAt(s)).toEqual(expect.any(Number));
    expect(journals(s).map((row) => [row.actionId, row.kind])).toEqual([
      ['project.archive', 'run'],
      ['project.unarchive', 'undo'],
      ['project.archive', 'undo'],
    ]);
    expect(journals(s)[2]?.id).toBe(redone.journalId);
    s.dispose();
  });

  test('a run whose action has no inverse refuses with no-inverse and writes nothing', () => {
    const s = world();
    const deleteId = runAction(s, 'project.delete');
    const error = httpError(() => undo(s, deleteId));
    expect(error.status).toBe(409);
    expect(error.reason).toBe('no-inverse');
    expect(journals(s)).toHaveLength(1);
    s.dispose();
  });

  test('a later run on the same target refuses the undo, journals undo-refused and names that row', () => {
    const s = world();
    const first = runAction(s, 'project.archive');
    const second = runAction(s, 'project.unarchive');
    const error = httpError(() => undo(s, first));
    expect(error.status).toBe(409);
    expect(error.fields?.conflictJournalId).toBe(second);
    expect(archivedAt(s)).toBeNull();
    expect(journals(s)).toEqual([
      expect.objectContaining({ id: first, kind: 'run' }),
      expect.objectContaining({ id: second, kind: 'run' }),
      expect.objectContaining({
        actionId: 'project.archive',
        targetId: 'project-a',
        kind: 'undo-refused',
        inputHash: inputHashOf({ undoOf: first }),
      }),
    ]);
    s.dispose();
  });

  test('a missing or foreign journal row is 404', () => {
    const s = world();
    s.db.insert(teamTable).values({ id: 'team-other', name: 'Other', createdAt: 0 }).run();
    s.db
      .insert(actionJournal)
      .values({
        id: 'foreign',
        teamId: 'team-other',
        actionId: 'project.archive',
        targetId: 'project-a',
        actor: 'user',
        surface: 'web',
        kind: 'run',
        inputHash: 'x',
        createdAt: 1,
      })
      .run();
    expect(httpError(() => undo(s, 'missing')).status).toBe(404);
    expect(httpError(() => undo(s, 'foreign')).status).toBe(404);
    s.dispose();
  });

  test.each(['error', 'undo-refused'] as const)('a %s journal row is not undoable', (kind) => {
    const s = world();
    s.db
      .insert(actionJournal)
      .values({
        id: `row-${kind}`,
        teamId: s.team.id,
        actionId: 'project.archive',
        targetId: 'project-a',
        actor: 'user',
        surface: 'web',
        kind,
        inputHash: 'x',
        createdAt: 1,
      })
      .run();
    const error = httpError(() => undo(s, `row-${kind}`));
    expect(error.status).toBe(409);
    expect(error.reason).toBe('not-undoable');
    expect(journals(s)).toHaveLength(1);
    s.dispose();
  });

  test('a journal insert failure rolls the inverse write back', () => {
    const s = world();
    const runId = runAction(s);
    s.db.run(
      sql`CREATE TRIGGER refuse_undo_journal BEFORE INSERT ON action_journal BEGIN SELECT RAISE(ROLLBACK, 'journal refused'); END`,
    );
    expect(() => undo(s, runId)).toThrow();
    expect(archivedAt(s)).toEqual(expect.any(Number));
    expect(journals(s).map((row) => row.id)).toEqual([runId]);
    s.dispose();
  });

  test('an inverse write failure writes no journal row', () => {
    const s = world();
    const runId = runAction(s);
    s.db.run(
      sql`CREATE TRIGGER refuse_project_update BEFORE UPDATE ON project BEGIN SELECT RAISE(ROLLBACK, 'project update refused'); END`,
    );
    expect(() => undo(s, runId)).toThrow();
    expect(archivedAt(s)).toEqual(expect.any(Number));
    expect(journals(s).map((row) => row.id)).toEqual([runId]);
    s.dispose();
  });
});

describe('owner journal and proposal routes', () => {
  const TOKEN = 'cairn-actions-owner-route-test';

  function bearerReq(
    s: ReturnType<typeof bootServer>,
    token: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    return Promise.resolve(
      s.app.request(path, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  }

  test('a paired device token gets 403 on the journal, proposals and undo routes; the owner token passes', async () => {
    const s = bootServer({ authToken: TOKEN });
    const device = createPairedDevice(s.db, { teamId: s.team.id, name: 'phone' });
    for (const [method, path] of [
      ['GET', '/api/actions/journal'],
      ['GET', '/api/actions/proposals'],
      ['POST', '/api/actions/journal/j1/undo'],
    ] as const) {
      expect((await bearerReq(s, device.token, method, path)).status).toBe(403);
    }
    expect((await bearerReq(s, TOKEN, 'GET', '/api/actions/journal')).status).toBe(200);
    expect((await bearerReq(s, TOKEN, 'GET', '/api/actions/proposals')).status).toBe(200);
    s.dispose();
  });

  test('GET /api/actions/journal lists the team journal newest first with a bounded limit', async () => {
    const s = world();
    const first = runAction(s, 'project.archive');
    const second = runAction(s, 'project.unarchive');
    const res = await req(s.app, 'GET', '/api/actions/journal');
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string }[];
    expect(rows.map((row) => row.id)).toEqual([second, first]);
    const limited = await req(s.app, 'GET', '/api/actions/journal?limit=1');
    const limitedRows = (await limited.json()) as { id: string }[];
    expect(limitedRows.map((row) => row.id)).toEqual([second]);
    s.dispose();
  });

  test('GET /api/actions/proposals lists pending proposals only', async () => {
    const s = world();
    s.db
      .insert(chief)
      .values({ id: 'chief-a', userId: s.user.id, teamId: s.team.id, createdAt: 1 })
      .run();
    s.db
      .insert(chiefThread)
      .values({
        id: 'thread-a',
        chiefId: 'chief-a',
        userId: s.user.id,
        teamId: s.team.id,
        title: 'thread-a',
        createdAt: 1,
        updatedAt: 1,
        sessionId: 'thread-a',
        sessionOpenedAt: 1,
      })
      .run();
    const proposed = executeAction(
      { db: s.db, reposDir: s.reposDir },
      {
        id: 'project.delete',
        input: { projectId: 'project-a' },
        actor: 'coordinator',
        surface: 'coordinator',
        teamId: s.team.id,
        threadId: 'thread-a',
      },
    );
    expect(proposed.status).toBe('pending');
    const res = await req(s.app, 'GET', '/api/actions/proposals');
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { actionId: string; status: string }[];
    expect(rows).toEqual([
      expect.objectContaining({ actionId: 'project.delete', status: 'pending' }),
    ]);
    s.dispose();
  });

  test('POST /api/actions/journal/:id/undo applies the inverse, and a moved target 409s with the later journal id', async () => {
    const s = world();
    const archivedId = runAction(s, 'project.archive');
    const undone = await req(s.app, 'POST', `/api/actions/journal/${archivedId}/undo`);
    expect(undone.status).toBe(200);
    expect(archivedAt(s)).toBeNull();
    const reArchived = runAction(s, 'project.archive');
    const unarchived = runAction(s, 'project.unarchive');
    const refused = await req(s.app, 'POST', `/api/actions/journal/${reArchived}/undo`);
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as { conflictJournalId?: string };
    expect(body.conflictJournalId).toBe(unarchived);
    expect(archivedAt(s)).toBeNull();
    expect(journals(s).map((row) => row.kind)).toEqual([
      'run',
      'undo',
      'run',
      'run',
      'undo-refused',
    ]);
    s.dispose();
  });
});
