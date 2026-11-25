import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { conversationBranch } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { project, step, todo } from '../src/db/schema.js';
import { runGit } from '../src/lib/git.js';
import { sendBuildSteer, startBuilds } from '../src/services/builds.js';
import { readBuildChangeFile } from '../src/services/git.js';
import { sectionOf } from '../src/services/owner.js';
import { messageThreadAsUser } from '../src/services/thread-message.js';
import { createTodo, deleteTodo } from '../src/services/todos.js';
import { bootServer, insertMachine, postProject } from './helpers.js';

const NOW = 1_800_000_000_000;

describe('C12 task lifecycle safety (server)', () => {
  test('sectionOf checks archivedAt before ended phase so archived done tasks leave resolved', () => {
    expect(sectionOf({ phase: 'done', phaseAt: NOW, archivedAt: NOW }, null, NOW)).toBeNull();
    expect(sectionOf({ phase: 'closed', phaseAt: NOW, archivedAt: NOW }, null, NOW)).toBeNull();
    expect(sectionOf({ phase: 'stopped', phaseAt: NOW, archivedAt: NOW }, null, NOW)).toBeNull();
    expect(sectionOf({ phase: 'building', phaseAt: NOW, archivedAt: NOW }, null, NOW)).toBeNull();
    expect(sectionOf({ phase: 'done', phaseAt: NOW, archivedAt: null }, null, NOW)).toBe(
      'resolved',
    );
  });

  test('deleteTodo signals stop for claimed steps, clears conversation buffers, and broadcasts todo_deleted SSE', async () => {
    const s = bootServer();
    insertMachine(s);
    const projectId = await postProject(s.app);
    const created = createTodo(s.svc, {
      teamId: s.team.id,
      projectId,
      title: 'Running task to delete',
      spec: 'Do work',
      createdBy: s.user.id,
      ownerId: s.user.id,
    });
    const [b] = startBuilds(s.svc, { projectId, todoIds: [created.id] });
    const stepRow = s.db.select().from(step).where(eq(step.buildId, b!.id)).get()!;
    s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, stepRow.id)).run();

    const stopSpy = vi.spyOn(s.machineHub, 'stopSignal');
    const clearSpy = vi.spyOn(s.convHub, 'clearConversationBuffer');
    const received: object[] = [];
    const unsubscribe = s.hub.subscribe(s.team.id, {
      send: async (payload) => {
        received.push(payload);
      },
    });

    try {
      expect(deleteTodo(s.svc, created.id)).toBe(true);
      expect(stopSpy).toHaveBeenCalledWith(s.team.id, stepRow.id);
      expect(clearSpy).toHaveBeenCalledWith(b!.id);
      expect(received).toContainEqual({
        type: 'todo_deleted',
        todoId: created.id,
        projectId,
      });
    } finally {
      unsubscribe();
    }
  });

  test('stopped task resumes cleanly via messageThreadAsUser and defensively via sendBuildSteer', async () => {
    const s = bootServer();
    insertMachine(s);
    const projectId = await postProject(s.app);

    const t1 = createTodo(s.svc, {
      teamId: s.team.id,
      projectId,
      title: 'Stopped via message',
      spec: 'Initial spec',
      createdBy: s.user.id,
      ownerId: s.user.id,
    });
    const [b1] = startBuilds(s.svc, { projectId, todoIds: [t1.id] });
    s.db.update(step).set({ status: 'stopped' }).where(eq(step.buildId, b1!.id)).run();
    s.db.update(todo).set({ phase: 'stopped' }).where(eq(todo.id, t1.id)).run();

    const msgResult = await messageThreadAsUser(s.svc, s.team.id, t1.id, {
      content: 'Resume from here',
      clientMessageId: 'cm-msg-stopped-1',
    });
    expect(msgResult.delivered).toBe('restart');
    expect(s.db.select().from(todo).where(eq(todo.id, t1.id)).get()?.phase).toBe('queued');

    const t2 = createTodo(s.svc, {
      teamId: s.team.id,
      projectId,
      title: 'Stopped via steer',
      spec: 'Initial spec',
      createdBy: s.user.id,
      ownerId: s.user.id,
    });
    const [b2] = startBuilds(s.svc, { projectId, todoIds: [t2.id] });
    s.db.update(step).set({ status: 'stopped' }).where(eq(step.buildId, b2!.id)).run();
    s.db.update(todo).set({ phase: 'stopped' }).where(eq(todo.id, t2.id)).run();

    const steerResult = await sendBuildSteer(
      s.svc,
      b2!.id,
      { content: 'Continue stopped build', clientMessageId: 'cm-steer-stopped-1' },
      { human: true },
    );
    expect(steerResult.delivered).toBe('new-turn');
    expect(s.db.select().from(todo).where(eq(todo.id, t2.id)).get()?.phase).toBe('queued');
  });

  test('readBuildChangeFile reads full file content for local repo builds when localPath exists', async () => {
    const s = bootServer();
    insertMachine(s);
    const repoDir = join(makeTestTempDir('c12-local-repo'), 'repo');
    mkdirSync(repoDir, { recursive: true });
    await runGit(['init', '-b', 'main'], { cwd: repoDir });
    await runGit(['config', 'user.email', 'test@example.com'], { cwd: repoDir });
    await runGit(['config', 'user.name', 'Test'], { cwd: repoDir });
    writeFileSync(join(repoDir, 'hello.txt'), 'base line\n');
    await runGit(['add', 'hello.txt'], { cwd: repoDir });
    await runGit(['commit', '-m', 'init'], { cwd: repoDir });

    const projectId = 'proj-local-full';
    s.db
      .insert(project)
      .values({
        id: projectId,
        teamId: s.team.id,
        name: 'Local Repo',
        repoKind: 'local',
        localPath: repoDir,
      })
      .run();

    const created = createTodo(s.svc, {
      teamId: s.team.id,
      projectId,
      title: 'Local edit',
      spec: 'Update hello.txt',
      createdBy: s.user.id,
      ownerId: s.user.id,
    });
    const [b] = startBuilds(s.svc, { projectId, todoIds: [created.id] });
    const branch = conversationBranch(b!.id);
    await runGit(['checkout', '-b', branch], { cwd: repoDir });
    writeFileSync(join(repoDir, 'hello.txt'), 'base line\nadded line\n');
    await runGit(['add', 'hello.txt'], { cwd: repoDir });
    await runGit(['commit', '-m', 'edit'], { cwd: repoDir });

    const file = await readBuildChangeFile({ db: s.db, reposDir: s.reposDir }, b!.id, 'hello.txt');
    expect(file.encoding).toBe('utf-8');
    expect(file.content).toBe('base line\nadded line\n');
    expect(file.path).toBe('hello.txt');
  });
});
