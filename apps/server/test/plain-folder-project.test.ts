import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type LocalErrorReason, parseLocalFolderActionInstruction } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { message as msgTable, step as stepTable, todo as todoTable } from '../src/db/schema.js';
import { runGit } from '../src/lib/git.js';
import { nowMs } from '../src/lib/ids.js';
import { sweepAbandonedBuildSteps } from '../src/services/build-abandoned-sweep.js';
import {
  readBuildChangeFile,
  readBuildChanges,
  readFile,
  readProjectReadme,
} from '../src/services/git.js';
import { claimStep } from '../src/services/machine-claim.js';
import { finishStep } from '../src/services/machines.js';
import {
  bootServer,
  deliverCodeStep,
  insertClaudeSubscription,
  insertMachine,
  req,
  seedSessionRoute,
} from './helpers.js';

const READ_GIT_ENV = {
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@cairn.local',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@cairn.local',
};

const tempRoots: string[] = [];

function tempDir(prefix: string): string {
  const dir = makeTestTempDir(prefix);
  tempRoots.push(dir);
  return dir;
}

describe('plain-folder project API, browse, merge/undo orchestration', () => {
  const s = bootServer({});

  afterAll(() => {
    s.dispose();
    for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
  });

  test('creates plain folder project, browses files/README with excludes and symlink guard, returns empty branches', async () => {
    const folder = tempDir('cairn-srv-pf-');
    writeFileSync(join(folder, 'README.md'), '# Plain Project\n');
    writeFileSync(join(folder, 'notes.txt'), 'hello plain\n');
    writeFileSync(join(folder, '.env'), 'TOKEN=hidden\n');
    mkdirSync(join(folder, 'node_modules', 'dep'), { recursive: true });
    writeFileSync(join(folder, 'node_modules', 'dep', 'x.js'), '1\n');
    const outside = tempDir('cairn-srv-outside-');
    writeFileSync(join(outside, 'leak.txt'), 'secret\n');
    symlinkSync(join(outside, 'leak.txt'), join(folder, 'escape.txt'));

    const created = await req(s.app, 'POST', '/api/projects', {
      name: 'plain-notes',
      kind: 'local',
      localPath: folder,
    });
    expect(created.status).toBe(201);
    const proj = (await created.json()) as { id: string; localPath: string };
    expect(proj.localPath).toBe(realpathSync(folder));

    const filesRes = await req(s.app, 'GET', `/api/projects/${proj.id}/files`);
    expect(filesRes.status).toBe(200);
    const filesBody = (await filesRes.json()) as { files: Array<{ path: string }> };
    const paths = filesBody.files.map((f) => f.path);
    expect(paths).toContain('README.md');
    expect(paths).toContain('notes.txt');
    expect(paths).not.toContain('.env');
    expect(paths).not.toContain('escape.txt');
    expect(paths.some((p) => p.includes('node_modules'))).toBe(false);

    const fileRes = await readFile(s, proj.id, 'notes.txt');
    expect(fileRes.commit).toBe('workspace');
    expect(fileRes.content).toBe('hello plain\n');

    const readme = await readProjectReadme(s, s.team.id, proj.id);
    expect(readme).toMatchObject({ status: 'ok', path: 'README.md' });
    if (readme?.status === 'ok') expect(readme.content).toContain('# Plain Project');

    const emptyDir = tempDir('cairn-srv-empty-');
    const emptyProj = (await (
      await req(s.app, 'POST', '/api/projects', {
        name: 'empty-pf',
        kind: 'local',
        localPath: emptyDir,
      })
    ).json()) as { id: string };
    expect((await req(s.app, 'GET', `/api/projects/${emptyProj.id}/files`)).status).toBe(200);
    expect(await readProjectReadme(s, s.team.id, emptyProj.id)).toMatchObject({
      status: 'missing',
    });

    const bigReadmeDir = tempDir('cairn-srv-bigreadme-');
    writeFileSync(join(bigReadmeDir, 'README.md'), 'x'.repeat(300 * 1024));
    const bigProj = (await (
      await req(s.app, 'POST', '/api/projects', {
        name: 'big-readme',
        kind: 'local',
        localPath: bigReadmeDir,
      })
    ).json()) as { id: string };
    expect(await readProjectReadme(s, s.team.id, bigProj.id)).toMatchObject({
      status: 'unreadable',
    });

    const branchesRes = await req(s.app, 'GET', `/api/projects/${proj.id}/branches`);
    expect(branchesRes.status).toBe(200);
    expect(await branchesRes.json()).toEqual({ defaultBranch: null, branches: [] });

    const outer = tempDir('cairn-srv-outer-git-');
    await runGit(['init', outer], { env: READ_GIT_ENV });
    writeFileSync(join(outer, 'root-only.txt'), 'outer\n');
    const nested = join(outer, 'sub');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'inside.txt'), 'inner\n');
    const nestedProj = (await (
      await req(s.app, 'POST', '/api/projects', {
        name: 'nested-pf',
        kind: 'local',
        localPath: nested,
      })
    ).json()) as { id: string };
    const nestedFiles = (await (
      await req(s.app, 'GET', `/api/projects/${nestedProj.id}/files`)
    ).json()) as { files: Array<{ path: string }> };
    expect(nestedFiles.files.map((f) => f.path)).toEqual(['inside.txt']);
  });

  test('rejects protected folders, symlinks to protected folders, and regular files while allowing subdirectories under them', async () => {
    const protectedServer = bootServer({});
    try {
      const fakeHome = tempDir('cairn-srv-home-');
      const docs = join(fakeHome, 'Documents');
      const subDocs = join(docs, 'notes');
      mkdirSync(subDocs, { recursive: true });
      const docsLink = join(fakeHome, 'link-docs');
      symlinkSync(docs, docsLink);
      const customCtx = { ...protectedServer.svc, db: protectedServer.db };
      const rRoot = await req(protectedServer.app, 'POST', '/api/projects', {
        name: 'root',
        kind: 'local',
        localPath: '/',
      });
      expect(rRoot.status).toBe(400);
      expect(((await rRoot.json()) as { reason?: LocalErrorReason }).reason).toBe(
        'protected_folder',
      );

      const fileDir = tempDir('cairn-srv-regfile-');
      const regFile = join(fileDir, 'doc.txt');
      writeFileSync(regFile, 'hello\n');
      const rFile = await req(protectedServer.app, 'POST', '/api/projects', {
        name: 'file',
        kind: 'local',
        localPath: regFile,
      });
      expect(rFile.status).toBe(400);
      expect(((await rFile.json()) as { reason?: LocalErrorReason }).reason).toBe('not_directory');

      const missing = join(tempDir('cairn-srv-miss-'), 'gone');
      const rMissing = await req(protectedServer.app, 'POST', '/api/projects', {
        name: 'missing',
        kind: 'local',
        localPath: missing,
      });
      expect(rMissing.status).toBe(400);
      expect(((await rMissing.json()) as { reason?: LocalErrorReason }).reason).toBe('not_found');

      const rSub = await req(protectedServer.app, 'POST', '/api/projects', {
        name: 'sub-docs',
        kind: 'local',
        localPath: subDocs,
      });
      expect(rSub.status).toBe(201);
      expect(customCtx.db).toBeDefined();
    } finally {
      protectedServer.dispose();
    }
  });

  test('supports /api/builds/:id/changes plainFolder metadata, readBuildChangeFile disk read/404, undo deduplication/settlement, offline sweep preservation, and merge 409/202 rules', async () => {
    const folder = tempDir('cairn-srv-actions-');
    writeFileSync(join(folder, 'note.md'), 'updated content\n');
    const projRes = await req(s.app, 'POST', '/api/projects', {
      name: 'actions-pf',
      kind: 'local',
      localPath: folder,
    });
    expect(projRes.status).toBe(201);
    const proj = (await projRes.json()) as { id: string };
    const projId = String(proj.id);

    const machineId = insertMachine(s, {
      name: 'plain-runner',
      claudeCodeReport: {
        installed: true,
        hostname: 'plain-runner',
        models: [],
        auth: { state: 'logged-in', method: 'claude.ai', provider: 'firstParty' },
      } as never,
      capabilities: {
        executor: 'host',
        computer: false,
        browser: false,
      } as never,
    });
    insertClaudeSubscription(s);
    seedSessionRoute(s, { machineId });
    const machineDeps = {
      ...s.svc,
      box: s.secretBox,
      reposDir: s.reposDir,
      attachmentsDir: s.attachmentsDir,
    };

    const todoRes = await req(s.app, 'POST', `/api/projects/${projId}/todos`, {
      title: 'edit plain note',
      spec: 'edit plain note',
    });
    const todoRow = (await todoRes.json()) as { id: string };
    const { buildId, stepId } = deliverCodeStep(s.svc, todoRow.id, { hasChanges: true });

    const currentFile = await readBuildChangeFile(
      { db: s.db, reposDir: s.reposDir },
      buildId,
      'note.md',
    );
    expect(currentFile.content).toBe('updated content\n');
    await expect(
      readBuildChangeFile({ db: s.db, reposDir: s.reposDir }, buildId, 'deleted.md'),
    ).rejects.toMatchObject({ status: 404 });

    s.db
      .update(stepTable)
      .set({ checkpointCommit: 'b'.repeat(40) })
      .where(eq(stepTable.id, stepId))
      .run();
    s.db
      .insert(stepTable)
      .values({
        id: 'done-step-1',
        buildId,
        kind: 'session',
        status: 'done',
        checkpointCommit: 'b'.repeat(40),
        createdAt: nowMs(),
      })
      .run();
    const u1 = await req(s.app, 'POST', `/api/builds/${buildId}/undo`);
    const u2 = await req(s.app, 'POST', `/api/builds/${buildId}/undo`);
    expect(u1.status).toBe(202);
    expect(u2.status).toBe(202);

    const undoSteps = s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, buildId))
      .all()
      .filter((row) => parseLocalFolderActionInstruction(row.prompt)?.action === 'undo');
    expect(undoSteps).toHaveLength(1);
    const undoStep = undoSteps[0]!;

    const msgRow = {
      id: `plain-folder-state-${stepId}`,
      conversationId: buildId,
      role: 'system' as const,
      content: JSON.stringify({
        kind: 'plain-folder-state',
        mode: 'isolated',
        status: 'merged',
        undoable: true,
      }),
      createdAt: nowMs(),
    };
    s.db.insert(msgTable).values(msgRow).onConflictDoNothing().run();
    s.db.update(todoTable).set({ phase: 'needs_input' }).where(eq(todoTable.id, todoRow.id)).run();

    const mergeInNeedsInput = await req(s.app, 'POST', `/api/builds/${buildId}/merge`);
    expect(mergeInNeedsInput.status).toBe(409);

    sweepAbandonedBuildSteps(s.svc, nowMs() + 300_000);
    const stillPending = s.db.select().from(stepTable).where(eq(stepTable.id, undoStep.id)).get();
    expect(stillPending?.status).toBe('pending');

    const pendingChanges = (await (
      await req(s.app, 'GET', `/api/builds/${buildId}/changes`)
    ).json()) as {
      plainFolder?: { undoPending: boolean; status: string };
    };
    expect(pendingChanges.plainFolder?.undoPending).toBe(true);

    const claimed = await claimStep(machineDeps, machineId, s.team.id, 0, 'http://localhost');
    expect(claimed?.step.id).toBe(undoStep.id);
    expect(claimed?.localFolderAction).toEqual({
      action: 'undo',
      projectId: projId,
      buildId,
    });
    s.db.update(todoTable).set({ phase: 'done' }).where(eq(todoTable.id, todoRow.id)).run();

    const gen = s.db
      .select({ claimedAt: stepTable.claimedAt })
      .from(stepTable)
      .where(eq(stepTable.id, undoStep.id))
      .get()!.claimedAt!;
    await finishStep(machineDeps, machineId, undoStep.id, {
      status: 'success',
      generation: gen,
      localFolderAction: {
        command: { action: 'undo', projectId: projId, buildId },
        result: { outcome: 'undone', commit: 'a'.repeat(40) },
      },
    });

    const undoneChanges = await readBuildChanges({ db: s.db, reposDir: s.reposDir }, buildId);
    expect(undoneChanges.plainFolder).toMatchObject({
      mode: 'isolated',
      status: 'undone',
      undoable: false,
      undoPending: false,
    });

    const mergeAfterUndo = await req(s.app, 'POST', `/api/builds/${buildId}/merge`);
    expect(mergeAfterUndo.status).toBe(409);

    const conflictStateId = `plain-folder-state-conf`;
    s.db
      .insert(msgTable)
      .values({
        id: conflictStateId,
        conversationId: buildId,
        role: 'system',
        content: JSON.stringify({
          kind: 'plain-folder-state',
          mode: 'isolated',
          status: 'conflict',
          undoable: false,
          conflictFiles: ['note.md'],
          reason: '合并冲突：note.md',
        }),
        createdAt: nowMs() + 50,
      })
      .run();

    const mergeConflictRetry = await req(s.app, 'POST', `/api/builds/${buildId}/merge`);
    expect(mergeConflictRetry.status).toBe(202);
    const mergeSteps = s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, buildId))
      .all()
      .filter((row) => parseLocalFolderActionInstruction(row.prompt)?.action === 'merge');
    expect(mergeSteps).toHaveLength(1);

    const claimMerge = await claimStep(machineDeps, machineId, s.team.id, 0, 'http://localhost');
    expect(claimMerge?.localFolderAction?.action).toBe('merge');

    s.db
      .insert(msgTable)
      .values({
        id: 'plain-folder-state-inplace',
        conversationId: buildId,
        role: 'system',
        content: JSON.stringify({
          kind: 'plain-folder-state',
          mode: 'in-place',
          status: 'conflict',
          undoable: false,
        }),
        createdAt: nowMs() + 100,
      })
      .run();
    s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, mergeSteps[0]!.id)).run();
    const mergeInPlace = await req(s.app, 'POST', `/api/builds/${buildId}/merge`);
    expect(mergeInPlace.status).toBe(409);

    s.db.update(todoTable).set({ archivedAt: nowMs() }).where(eq(todoTable.id, todoRow.id)).run();
    const undoArchived = await req(s.app, 'POST', `/api/builds/${buildId}/undo`);
    expect(undoArchived.status).toBe(409);
  });

  test('requestMerge without plain-folder state does not hijack local git merge routing', async () => {
    const dir = tempDir('cairn-pf-nonstate-');
    const createRes = await req(s.app, 'POST', '/api/projects', {
      name: 'non-plain-build',
      kind: 'local',
      localPath: dir,
    });
    expect(createRes.status).toBe(201);
    const { id: projId } = (await createRes.json()) as { id: string };
    const todoRes = await req(s.app, 'POST', `/api/projects/${projId}/todos`, {
      title: 'missing plain state merge',
      spec: 'missing plain state merge',
    });
    const todoRow = (await todoRes.json()) as { id: string };
    const { buildId, stepId } = deliverCodeStep(s.svc, todoRow.id, { hasChanges: true });
    s.db
      .update(stepTable)
      .set({ status: 'done', checkpointCommit: 'b'.repeat(40) })
      .where(eq(stepTable.id, stepId))
      .run();
    s.db.update(todoTable).set({ phase: 'done' }).where(eq(todoTable.id, todoRow.id)).run();

    const mergeRes = await req(s.app, 'POST', `/api/builds/${buildId}/merge`);
    expect(mergeRes.status).toBe(409);
    const body = (await mergeRes.json()) as { error?: string };
    expect(body.error).toContain('无法读取本地仓库默认分支');
    const actionSteps = s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, buildId))
      .all()
      .filter((row) => parseLocalFolderActionInstruction(row.prompt) !== null);
    expect(actionSteps).toHaveLength(0);
  });
});
