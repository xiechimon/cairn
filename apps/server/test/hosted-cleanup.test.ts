import { existsSync, mkdirSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { actionJournal, hostedCleanupOutbox, project as projectTable } from '../src/db/schema.js';
import { repoDirFor } from '../src/services/git.js';
import { dispatchHostedCleanup } from '../src/services/hosted-cleanup.js';
import { bootServer } from './helpers.js';

function world() {
  return bootServer();
}

function seedDelete(s: ReturnType<typeof world>, projectId: string, repoName: string) {
  s.db
    .insert(actionJournal)
    .values({
      id: `journal-${projectId}`,
      teamId: s.team.id,
      actionId: 'project.delete',
      targetId: projectId,
      actor: 'coordinator',
      surface: 'web',
      kind: 'run',
      inputHash: 'a'.repeat(64),
      createdAt: 1,
    })
    .run();
  s.db
    .insert(hostedCleanupOutbox)
    .values({
      id: `cleanup-${projectId}`,
      teamId: s.team.id,
      projectId,
      repoName,
      state: 'pending',
      attempts: 0,
      nextAttemptAt: 1,
      lastError: null,
    })
    .run();
}

function journals(s: ReturnType<typeof world>) {
  return s.db.select().from(actionJournal).all();
}

describe('hosted cleanup journal', () => {
  test('a finished removal journals done in the same transition as the outbox', () => {
    const s = world();
    seedDelete(s, 'project-deleted', 'gone-name');
    const dir = repoDirFor(s.reposDir, s.team.id, 'gone-name');
    mkdirSync(dir, { recursive: true });

    dispatchHostedCleanup(s.db, s.reposDir, 50);

    expect(existsSync(dir)).toBe(false);
    expect(s.db.select().from(hostedCleanupOutbox).get()).toMatchObject({
      state: 'done',
      lastError: null,
    });
    const added = journals(s).filter((row) => row.id !== 'journal-project-deleted');
    expect(added).toEqual([
      expect.objectContaining({
        teamId: s.team.id,
        actionId: 'project.delete',
        targetId: 'project-deleted',
        actor: 'coordinator',
        surface: 'web',
        kind: 'run',
        inputHash: 'a'.repeat(64),
        createdAt: 50,
      }),
    ]);
    dispatchHostedCleanup(s.db, s.reposDir, 60);
    expect(journals(s)).toHaveLength(2);
    s.dispose();
  });

  test('a name owned by another project journals conflict and does not remove the directory', () => {
    const s = world();
    seedDelete(s, 'project-deleted', 'taken-name');
    s.db
      .insert(projectTable)
      .values({
        id: 'project-owner',
        teamId: s.team.id,
        name: 'Owner',
        repoKind: 'hosted',
        repoName: 'taken-name',
      })
      .run();
    const dir = repoDirFor(s.reposDir, s.team.id, 'taken-name');
    mkdirSync(dir, { recursive: true });

    dispatchHostedCleanup(s.db, s.reposDir, 50);

    expect(existsSync(dir)).toBe(true);
    expect(s.db.select().from(hostedCleanupOutbox).get()).toMatchObject({
      state: 'conflict',
      lastError: 'a project owns this repo name',
    });
    const added = journals(s).filter((row) => row.id !== 'journal-project-deleted');
    expect(added).toEqual([
      expect.objectContaining({
        teamId: s.team.id,
        actionId: 'project.delete',
        targetId: 'project-deleted',
        actor: 'coordinator',
        surface: 'web',
        kind: 'error',
        inputHash: 'a'.repeat(64),
        createdAt: 50,
      }),
    ]);
    s.dispose();
  });

  test('a refused cleanup journal rolls the outbox status back', () => {
    const s = world();
    seedDelete(s, 'project-deleted', 'gone-name');
    s.db.run(
      sql`CREATE TRIGGER refuse_cleanup_journal BEFORE INSERT ON action_journal BEGIN SELECT RAISE(ROLLBACK, 'journal refused'); END`,
    );

    expect(() => dispatchHostedCleanup(s.db, s.reposDir, 50)).not.toThrow();
    expect(s.db.select().from(hostedCleanupOutbox).get()?.state).toBe('pending');
    expect(journals(s).map((row) => row.id)).toEqual(['journal-project-deleted']);
    s.dispose();
  });

  test('a removal failure stays retrying and writes no cleanup journal', async () => {
    const git = await import('../src/services/git.js');
    const s = world();
    seedDelete(s, 'project-deleted', 'gone-name');
    const remove = vi.spyOn(git, 'removeHostedRepoDir').mockImplementation(() => {
      throw new Error('disk full');
    });

    dispatchHostedCleanup(s.db, s.reposDir, 50);

    expect(s.db.select().from(hostedCleanupOutbox).get()).toMatchObject({
      state: 'retrying',
      attempts: 1,
      lastError: 'disk full',
    });
    expect(journals(s)).toHaveLength(1);
    remove.mockRestore();
    s.dispose();
  });
});
