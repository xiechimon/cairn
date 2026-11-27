import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { CACHEDIR_TAG_SIGNATURE, type LocalRepoUnreachableError } from '@cairn/shared';
import { protectedFolderReason } from '@cairn/shared/plain-folder-path';
import { describe, expect, test } from 'vitest';
import { commitEnv, gitPrim, runGit } from '../src/git.js';
import type { DaemonLogger } from '../src/log.js';
import { ShadowDiskFullError, ShadowManager } from '../src/shadow-repo.js';
import { commitAndPushStep } from '../src/step-closing-git.js';
import { prepareVerifyClone } from '../src/step-workspace.js';
import { WorkspaceManager } from '../src/workspace.js';
import { testTempDir } from './test-temp-dir.js';

const IDENTITY = { name: 'cairn-test', email: 'test@cairn.local' };

function fakeLogger(): DaemonLogger {
  const noop = () => {};
  return {
    raw: noop,
    prefixed: noop,
    supervisor: noop,
    machine: noop,
    step: noop,
    workspace: noop,
    recover: noop,
    wake: noop,
    mcp: noop,
    skills: noop,
    gate: noop,
    trust: noop,
  };
}

function makeWorkspace(
  opts: Partial<ConstructorParameters<typeof WorkspaceManager>[0]> = {},
): WorkspaceManager {
  return new WorkspaceManager({ ...opts, logger: opts.logger ?? fakeLogger() });
}

describe('plain-folder workspace + shadow repo + CoW lifecycle', () => {
  test('isolates CoW copies without creating .git in real folder and omits built-in excludes + CACHEDIR.TAG', async () => {
    const root = testTempDir('cairn-pf-root-');
    const folder = testTempDir('cairn-pf-folder-');
    writeFileSync(join(folder, 'notes.md'), 'hello\n');
    writeFileSync(join(folder, '.env.local'), 'SECRET=123\n');
    mkdirSync(join(folder, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(folder, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1;\n');
    mkdirSync(join(folder, 'cache-dir'), { recursive: true });
    writeFileSync(join(folder, 'cache-dir', 'CACHEDIR.TAG'), `${CACHEDIR_TAG_SIGNATURE}\n`);
    writeFileSync(join(folder, 'cache-dir', 'blob.txt'), 'ignored\n');

    const wsMgr = makeWorkspace();
    const prepared = await wsMgr.prepare({
      projectId: 'proj-1',
      conversationId: 'conv-1',
      cloneUrl: folder,
      repoKind: 'local',
      workspacesRoot: root,
      credentials: null,
    });

    expect(existsSync(join(folder, '.git'))).toBe(false);
    expect(prepared.plainFolder?.mode).toBe('isolated');
    expect(prepared.cwd).not.toBe(folder);
    expect(existsSync(join(prepared.cwd, 'notes.md'))).toBe(true);

    writeFileSync(join(prepared.cwd, 'notes.md'), 'hello\nupdated\n');
    writeFileSync(join(prepared.cwd, 'node_modules', 'pkg', 'index.js'), 'changed\n');
    writeFileSync(join(prepared.cwd, '.env.local'), 'SECRET=changed\n');
    writeFileSync(join(prepared.cwd, 'cache-dir', 'blob.txt'), 'changed\n');

    await wsMgr.commitAll(prepared.cwd, 'session step', IDENTITY);
    const diff = await wsMgr.diffAgainstDefault(prepared.cwd, prepared.defaultBranch);
    expect(diff).toContain('notes.md');
    expect(diff).not.toContain('node_modules');
    expect(diff).not.toContain('.env.local');
    expect(diff).not.toContain('cache-dir');

    await wsMgr.push(prepared.cwd, prepared.branch, null, {
      base: null,
      identity: null,
      stepId: 'step-1',
    });
    expect(readFileSync(join(folder, 'notes.md'), 'utf8')).toBe('hello\nupdated\n');
    expect(readFileSync(join(folder, '.env.local'), 'utf8')).toBe('SECRET=123\n');
    expect(wsMgr.plainFolderMeta(prepared.cwd)).toMatchObject({
      mode: 'isolated',
      status: 'merged',
      undoable: true,
    });
  }, 30_000);

  test('classifies subdirectory inside an outer Git repo as plain folder consistently via fixed isGitDir', async () => {
    const outer = testTempDir('cairn-pf-outer-git-');
    await runGit(['init', '-b', 'main', outer]);
    writeFileSync(join(outer, 'outer.txt'), 'outer\n');
    await runGit(['add', '-A'], { cwd: outer });
    await runGit(['commit', '-m', 'init'], { cwd: outer, env: commitEnv(IDENTITY) });

    const inner = join(outer, 'sub', 'notes');
    mkdirSync(inner, { recursive: true });
    writeFileSync(join(inner, 'todo.txt'), 'inner\n');

    expect(await gitPrim.isGitDir(outer)).toBe(true);
    expect(await gitPrim.isGitDir(inner)).toBe(false);

    const root = testTempDir('cairn-pf-sub-ws-');
    const wsMgr = makeWorkspace();
    const prepared = await wsMgr.prepare({
      projectId: 'proj-sub',
      conversationId: 'conv-sub',
      cloneUrl: inner,
      repoKind: 'local',
      workspacesRoot: root,
      credentials: null,
    });
    expect(prepared.plainFolder?.mode).toBe('isolated');
    expect(existsSync(join(prepared.cwd, 'outer.txt'))).toBe(false);
    expect(existsSync(join(prepared.cwd, 'todo.txt'))).toBe(true);
  }, 30_000);

  test('parallel tasks merge cleanly while preserving non-overlapping edits and identical user+task edits mark undoable=false', async () => {
    const root = testTempDir('cairn-pf-par-root-');
    const folder = testTempDir('cairn-pf-par-dir-');
    writeFileSync(join(folder, 'alpha.txt'), 'a1\n');
    writeFileSync(join(folder, 'shared.txt'), 'line1\nline2\nline3\nline4\nline5\n');
    writeFileSync(join(folder, 'same.txt'), 'draft\n');

    const wsMgr = makeWorkspace();
    const wsA = await wsMgr.prepare({
      projectId: 'p-par',
      conversationId: 'conv-a',
      cloneUrl: folder,
      repoKind: 'local',
      workspacesRoot: root,
      credentials: null,
    });
    const wsB = await wsMgr.prepare({
      projectId: 'p-par',
      conversationId: 'conv-b',
      cloneUrl: folder,
      repoKind: 'local',
      workspacesRoot: root,
      credentials: null,
    });

    writeFileSync(join(wsA.cwd, 'alpha.txt'), 'a1\nfrom-a\n');
    writeFileSync(join(wsA.cwd, 'shared.txt'), 'LINE1-BY-A\nline2\nline3\nline4\nline5\n');
    writeFileSync(join(wsB.cwd, 'shared.txt'), 'line1\nline2\nline3\nline4\nLINE5-BY-B\n');
    writeFileSync(join(wsB.cwd, 'beta.txt'), 'from-b\n');

    await wsMgr.commitAll(wsA.cwd, 'step a', IDENTITY);
    await wsMgr.commitAll(wsB.cwd, 'step b', IDENTITY);
    await wsMgr.push(wsA.cwd, wsA.branch, null, { base: null, identity: null, stepId: 'step-a' });
    await wsMgr.push(wsB.cwd, wsB.branch, null, { base: null, identity: null, stepId: 'step-b' });

    expect(readFileSync(join(folder, 'alpha.txt'), 'utf8')).toBe('a1\nfrom-a\n');
    expect(readFileSync(join(folder, 'beta.txt'), 'utf8')).toBe('from-b\n');
    expect(readFileSync(join(folder, 'shared.txt'), 'utf8')).toBe(
      'LINE1-BY-A\nline2\nline3\nline4\nLINE5-BY-B\n',
    );

    const undoA = await wsMgr.runPlainFolderAction({
      workspacesRoot: root,
      projectId: 'p-par',
      buildId: 'conv-a',
      stepId: 'undo-a',
      realFolder: folder,
      action: 'undo',
    });
    expect(undoA.outcome).toBe('undone');
    expect(readFileSync(join(folder, 'alpha.txt'), 'utf8')).toBe('a1\n');
    expect(readFileSync(join(folder, 'beta.txt'), 'utf8')).toBe('from-b\n');
    expect(readFileSync(join(folder, 'shared.txt'), 'utf8')).toBe(
      'line1\nline2\nline3\nline4\nLINE5-BY-B\n',
    );

    const wsSame = await wsMgr.prepare({
      projectId: 'p-par',
      conversationId: 'conv-same',
      cloneUrl: folder,
      repoKind: 'local',
      workspacesRoot: root,
      credentials: null,
    });
    writeFileSync(join(wsSame.cwd, 'same.txt'), 'ready\n');
    writeFileSync(join(folder, 'same.txt'), 'ready\n');
    await wsMgr.commitAll(wsSame.cwd, 'same edit', IDENTITY);
    await wsMgr.push(wsSame.cwd, wsSame.branch, null, {
      base: null,
      identity: null,
      stepId: 'step-same',
    });
    const metaSame = wsMgr.plainFolderMeta(wsSame.cwd);
    expect(metaSame?.undoable).toBe(false);
    const noopUndo = await wsMgr.runPlainFolderAction({
      workspacesRoot: root,
      projectId: 'p-par',
      buildId: 'conv-same',
      stepId: 'undo-same',
      realFolder: folder,
      action: 'undo',
    });
    expect(noopUndo.outcome).toBe('no-changes');
    expect(readFileSync(join(folder, 'same.txt'), 'utf8')).toBe('ready\n');
  }, 30_000);

  test('detects 3-way merge conflict without writing conflict markers and supports retry merge after conflict resolution', async () => {
    const root = testTempDir('cairn-pf-conf-root-');
    const folder = testTempDir('cairn-pf-conf-dir-');
    writeFileSync(join(folder, 'conflict.txt'), 'initial\n');

    const wsMgr = makeWorkspace();
    const ws = await wsMgr.prepare({
      projectId: 'p-conf',
      conversationId: 'conv-conf',
      cloneUrl: folder,
      repoKind: 'local',
      workspacesRoot: root,
      credentials: null,
    });
    writeFileSync(join(ws.cwd, 'conflict.txt'), 'from-task\n');
    writeFileSync(join(folder, 'conflict.txt'), 'from-user\n');

    await wsMgr.commitAll(ws.cwd, 'conflicting edit', IDENTITY);
    await wsMgr.push(ws.cwd, ws.branch, null, {
      base: null,
      identity: null,
      stepId: 'step-conf',
    });
    expect(wsMgr.plainFolderMeta(ws.cwd)).toMatchObject({
      status: 'conflict',
      undoable: false,
      conflictFiles: ['conflict.txt'],
    });
    expect(readFileSync(join(folder, 'conflict.txt'), 'utf8')).toBe('from-user\n');

    writeFileSync(join(folder, 'conflict.txt'), 'initial\n');
    const retried = await wsMgr.runPlainFolderAction({
      workspacesRoot: root,
      projectId: 'p-conf',
      buildId: 'conv-conf',
      stepId: 'retry-merge',
      realFolder: folder,
      action: 'merge',
    });
    expect(retried.outcome).toBe('merged');
    expect(readFileSync(join(folder, 'conflict.txt'), 'utf8')).toBe('from-task\n');

    const dupMerge = await wsMgr.runPlainFolderAction({
      workspacesRoot: root,
      projectId: 'p-conf',
      buildId: 'conv-conf',
      stepId: 'dup-merge',
      realFolder: folder,
      action: 'merge',
    });
    expect(dupMerge.outcome).toBe('already-merged');
  }, 30_000);

  test('detects post-snapshot concurrent user edit (TOCTOU) and rolls back cleanly without clobbering', async () => {
    const root = testTempDir('cairn-pf-toctou-root-');
    const folder = testTempDir('cairn-pf-toctou-dir-');
    writeFileSync(join(folder, 'first.txt'), 'v1\n');
    writeFileSync(join(folder, 'second.txt'), 'v1\n');

    let mutated = false;
    const wsMgr = makeWorkspace({
      shadowWriteFileImpl: (target, content, mode) => {
        if (!mutated && target.endsWith('first.txt')) {
          mutated = true;
          writeFileSync(join(folder, 'second.txt'), 'saved-between-snapshot-and-write\n');
        }
        writeFileSync(target, content, { mode });
        chmodSync(target, mode);
      },
    });
    const ws = await wsMgr.prepare({
      projectId: 'p-toctou',
      conversationId: 'conv-toctou',
      cloneUrl: folder,
      repoKind: 'local',
      workspacesRoot: root,
      credentials: null,
    });
    writeFileSync(join(ws.cwd, 'first.txt'), 'task-first\n');
    writeFileSync(join(ws.cwd, 'second.txt'), 'task-second\n');
    await wsMgr.commitAll(ws.cwd, 'two files', IDENTITY);
    await wsMgr.push(ws.cwd, ws.branch, null, {
      base: null,
      identity: null,
      stepId: 'step-toctou',
    });

    expect(wsMgr.plainFolderMeta(ws.cwd)?.status).toBe('conflict');
    expect(readFileSync(join(folder, 'first.txt'), 'utf8')).toBe('v1\n');
    expect(readFileSync(join(folder, 'second.txt'), 'utf8')).toBe(
      'saved-between-snapshot-and-write\n',
    );
  }, 30_000);

  test('supports binary files, case-only renames, multi-leg reverse undo, idempotent receipts, and snapshot-missing', async () => {
    const root = testTempDir('cairn-pf-adv-root-');
    const folder = testTempDir('cairn-pf-adv-dir-');
    writeFileSync(join(folder, 'lowercase.txt'), 'hello\n');
    writeFileSync(join(folder, 'doc.md'), 'start\n');

    const wsMgr = makeWorkspace();
    const ws = await wsMgr.prepare({
      projectId: 'p-adv',
      conversationId: 'conv-adv',
      cloneUrl: folder,
      repoKind: 'local',
      workspacesRoot: root,
      credentials: null,
    });
    rmSync(join(ws.cwd, 'lowercase.txt'));
    writeFileSync(join(ws.cwd, 'LowerCase.txt'), 'hello\n');
    writeFileSync(join(ws.cwd, 'doc.md'), 'leg-1\n');
    writeFileSync(join(ws.cwd, 'bin.dat'), Buffer.from([0, 1, 2, 255, 42]));
    await wsMgr.commitAll(ws.cwd, 'leg 1', IDENTITY);
    await wsMgr.push(ws.cwd, ws.branch, null, { base: null, identity: null, stepId: 'step-1' });

    writeFileSync(join(ws.cwd, 'doc.md'), 'leg-2\n');
    await wsMgr.commitAll(ws.cwd, 'leg 2', IDENTITY);
    await wsMgr.push(ws.cwd, ws.branch, null, { base: null, identity: null, stepId: 'step-2' });

    expect(existsSync(join(folder, 'LowerCase.txt'))).toBe(true);
    expect(readFileSync(join(folder, 'bin.dat'))).toEqual(Buffer.from([0, 1, 2, 255, 42]));
    expect(readFileSync(join(folder, 'doc.md'), 'utf8')).toBe('leg-2\n');

    const undo1 = await wsMgr.runPlainFolderAction({
      workspacesRoot: root,
      projectId: 'p-adv',
      buildId: 'conv-adv',
      stepId: 'undo-step-1',
      realFolder: folder,
      action: 'undo',
    });
    expect(undo1.outcome).toBe('undone');
    expect(readFileSync(join(folder, 'doc.md'), 'utf8')).toBe('start\n');
    expect(existsSync(join(folder, 'bin.dat'))).toBe(false);

    const receiptReplay = await wsMgr.runPlainFolderAction({
      workspacesRoot: root,
      projectId: 'p-adv',
      buildId: 'conv-adv',
      stepId: 'undo-step-1',
      realFolder: folder,
      action: 'undo',
    });
    expect(receiptReplay.outcome).toBe('undone');

    const reMergeRefused = await wsMgr.runPlainFolderAction({
      workspacesRoot: root,
      projectId: 'p-adv',
      buildId: 'conv-adv',
      stepId: 'remerge-refused',
      realFolder: folder,
      action: 'merge',
    });
    expect(reMergeRefused.outcome).toBe('failed');

    const missing = await wsMgr.runPlainFolderAction({
      workspacesRoot: root,
      projectId: 'p-adv',
      buildId: 'nonexistent-conv',
      stepId: 'undo-missing',
      realFolder: folder,
      action: 'undo',
    });
    expect(missing.outcome).toBe('snapshot-missing');
  }, 30_000);

  test('serializes huge folders in-place, cancels queued waiter via AbortSignal, skips clone for readonly, and rewinds Stop & Discard keeping excluded files', async () => {
    const root = testTempDir('cairn-pf-huge-root-');
    const folder = testTempDir('cairn-pf-huge-dir-');
    writeFileSync(join(folder, 'big.txt'), 'x'.repeat(200));
    writeFileSync(join(folder, '.env'), 'KEEP=1\n');

    const wsMgr = makeWorkspace({ hugeFolderBytes: 100 });
    const ac = new AbortController();
    const ws1 = await wsMgr.prepare({
      projectId: 'p-huge',
      conversationId: 'conv-h1',
      cloneUrl: folder,
      repoKind: 'local',
      workspacesRoot: root,
      credentials: null,
    });
    expect(ws1.plainFolder?.mode).toBe('in-place');
    expect(ws1.cwd).toBe(folder);

    const ro = await wsMgr.prepare({
      projectId: 'p-huge',
      conversationId: 'conv-ro',
      cloneUrl: folder,
      repoKind: 'local',
      workspacesRoot: root,
      credentials: null,
      readonly: true,
    });
    expect(ro.readonly).toBe(true);
    expect(ro.cwd).toBe(folder);

    let ws2Resolved = false;
    const ws2Promise = wsMgr
      .prepare({
        projectId: 'p-huge',
        conversationId: 'conv-h2',
        cloneUrl: folder,
        repoKind: 'local',
        workspacesRoot: root,
        credentials: null,
        signal: ac.signal,
      })
      .then((res) => {
        ws2Resolved = true;
        return res;
      });
    await new Promise((r) => setTimeout(r, 30));
    expect(ws2Resolved).toBe(false);

    ac.abort();
    await expect(ws2Promise).rejects.toThrow(/Aborted/i);

    writeFileSync(join(folder, 'big.txt'), 'modified-in-place\n');
    await wsMgr.restoreCheckpoint(folder, ws1.plainFolder!.baseCommit!);
    expect(readFileSync(join(folder, 'big.txt'), 'utf8')).toBe('x'.repeat(200));
    expect(readFileSync(join(folder, '.env'), 'utf8')).toBe('KEEP=1\n');

    writeFileSync(join(folder, 'big.txt'), 'final-in-place\n');
    await wsMgr.commitAll(ws1.cwd, 'huge step', IDENTITY);
    await wsMgr.push(ws1.cwd, ws1.branch, null, { base: null, identity: null, stepId: 'h-step' });
    ws1.release?.();

    expect(wsMgr.plainFolderMeta(ws1.cwd)).toMatchObject({
      mode: 'in-place',
      status: 'merged',
      undoable: true,
    });

    const mergeInPlace = await wsMgr.runPlainFolderAction({
      workspacesRoot: root,
      projectId: 'p-huge',
      buildId: 'conv-h1',
      stepId: 'merge-inplace',
      realFolder: folder,
      action: 'merge',
    });
    expect(mergeInPlace.outcome).toBe('failed');
  }, 30_000);

  test('falls back to in-place when CoW copy fails on a directory whose total size exceeds huge budget', async () => {
    const root = testTempDir('cairn-pf-cowfb-root-');
    const folder = testTempDir('cairn-pf-cowfb-dir-');
    writeFileSync(join(folder, 'code.txt'), 'small\n');
    mkdirSync(join(folder, 'node_modules'), { recursive: true });
    writeFileSync(join(folder, 'node_modules', 'bundle.bin'), 'z'.repeat(200));

    const wsMgr = makeWorkspace({
      hugeFolderBytes: 100,
      shadowCopyImpl: async () => {
        throw new Error('EXDEV: cross-device reflink unsupported');
      },
    });
    const prepared = await wsMgr.prepare({
      projectId: 'p-cowfb',
      conversationId: 'conv-cowfb',
      cloneUrl: folder,
      repoKind: 'local',
      workspacesRoot: root,
      credentials: null,
    });
    expect(prepared.plainFolder?.mode).toBe('in-place');
    expect(prepared.cwd).toBe(folder);
    prepared.release?.();
  }, 30_000);

  test('never writes back on plan/review/verify steps and never lets missing AGENT_TOOL_PUSH block plain-folder build merge-back', async () => {
    const root = testTempDir('cairn-pf-kind-root-');
    const folder = testTempDir('cairn-pf-kind-dir-');
    writeFileSync(join(folder, 'doc.txt'), 'base\n');

    const wsMgr = makeWorkspace();
    const wsPlan = await wsMgr.prepare({
      projectId: 'p-kind',
      conversationId: 'conv-plan',
      cloneUrl: folder,
      repoKind: 'local',
      workspacesRoot: root,
      credentials: null,
    });
    writeFileSync(join(wsPlan.cwd, 'doc.txt'), 'plan-draft\n');
    let pushed = false;
    const planOut = await commitAndPushStep({
      git: wsMgr,
      ws: wsPlan,
      claimed: {
        step: {
          id: 's-plan',
          buildId: 'conv-plan',
          kind: 'plan',
          machineId: 'm1',
          createdAt: 1,
          generation: 1,
        },
        conversationId: 'conv-plan',
        session: { action: 'new' },
        agent: { tools: [] },
        project: {
          id: 'p-kind',
          name: 'p',
          repo: { kind: 'local', cloneUrl: folder, baseBranch: null },
        },
      } as never,
      stepId: 's-plan',
      identity: IDENTITY,
      mergeCredential: null,
      headAtStart: null,
      stepStartMs: Date.now(),
      push: async () => {
        pushed = true;
        return 'integration';
      },
      note: () => {},
      log: () => {},
      logRaw: () => {},
    });
    expect(pushed).toBe(false);
    expect(planOut.error).toBeNull();
    expect(readFileSync(join(folder, 'doc.txt'), 'utf8')).toBe('base\n');

    const wsBuild = await wsMgr.prepare({
      projectId: 'p-kind',
      conversationId: 'conv-build',
      cloneUrl: folder,
      repoKind: 'local',
      workspacesRoot: root,
      credentials: null,
    });
    writeFileSync(join(wsBuild.cwd, 'doc.txt'), 'built\n');
    const buildOut = await commitAndPushStep({
      git: wsMgr,
      ws: wsBuild,
      claimed: {
        step: {
          id: 's-build',
          buildId: 'conv-build',
          kind: 'session',
          machineId: 'm1',
          createdAt: 1,
          generation: 1,
        },
        conversationId: 'conv-build',
        session: { action: 'new' },
        agent: { tools: [] },
        project: {
          id: 'p-kind',
          name: 'p',
          repo: { kind: 'local', cloneUrl: folder, baseBranch: null },
        },
      } as never,
      stepId: 's-build',
      identity: IDENTITY,
      mergeCredential: null,
      headAtStart: null,
      stepStartMs: Date.now(),
      push: async () => {
        await wsMgr.push(wsBuild.cwd, wsBuild.branch, null, {
          base: null,
          identity: null,
          stepId: 's-build',
        });
        return 'integration';
      },
      note: () => {},
      log: () => {},
      logRaw: () => {},
    });
    expect(buildOut.error).toBeNull();
    expect(readFileSync(join(folder, 'doc.txt'), 'utf8')).toBe('built\n');
  }, 30_000);

  test('reconciles applying crash journal cleanly and blocks auto-writes on partial-unknown', async () => {
    const root = testTempDir('cairn-pf-journal-root-');
    const folder = testTempDir('cairn-pf-journal-dir-');
    writeFileSync(join(folder, 'a.txt'), 'v1\n');

    const wsMgr = makeWorkspace();
    const ws = await wsMgr.prepare({
      projectId: 'p-j',
      conversationId: 'conv-j',
      cloneUrl: folder,
      repoKind: 'local',
      workspacesRoot: root,
      credentials: null,
    });
    writeFileSync(join(ws.cwd, 'a.txt'), 'v2\n');
    await wsMgr.commitAll(ws.cwd, 'step', IDENTITY);
    await wsMgr.push(ws.cwd, ws.branch, null, { base: null, identity: null, stepId: 'step-j1' });

    const shadow = new ShadowManager({ logger: fakeLogger() });
    const shadowDir = shadow.shadowDirFor(root, folder);
    const journalPath = join(shadowDir, 'journals', 'conv-j.json');
    expect(existsSync(journalPath)).toBe(true);
    const savedJournal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      preCommit: string;
      targetTree: string;
    };
    writeFileSync(
      journalPath,
      JSON.stringify({
        buildId: 'conv-j',
        stepId: 'step-j-rec',
        action: 'merge',
        state: 'applying',
        preCommit: savedJournal.preCommit,
        targetTree: savedJournal.targetTree,
        updatedAt: Date.now(),
      }),
    );
    const wsRec = makeWorkspace();
    await wsRec.prepare({
      projectId: 'p-j',
      conversationId: 'conv-j',
      cloneUrl: folder,
      repoKind: 'local',
      workspacesRoot: root,
      credentials: null,
    });
    const recoveredJournal = JSON.parse(readFileSync(journalPath, 'utf8')) as { state: string };
    expect(recoveredJournal.state).toBe('applied');

    writeFileSync(
      journalPath,
      JSON.stringify({
        buildId: 'conv-j',
        stepId: 'step-j1',
        action: 'undo',
        state: 'partial-unknown',
        preCommit: '',
        targetTree: '',
        updatedAt: Date.now(),
      }),
    );
    const blocked = await wsMgr.runPlainFolderAction({
      workspacesRoot: root,
      projectId: 'p-j',
      buildId: 'conv-j',
      stepId: 'undo-after-partial',
      realFolder: folder,
      action: 'undo',
    });
    expect(blocked.outcome).toBe('partial-unknown');
  }, 30_000);

  test('aborts write-back if folder deleted or replaced by .git mid-task, rejects protected roots + symlinks, handles timeout/foreign GIT_*/ENOSPC', async () => {
    const home = testTempDir('cairn-pf-home-');
    const docs = join(home, 'Documents');
    const subDoc = join(docs, 'project');
    mkdirSync(subDoc, { recursive: true });
    const linkToDocs = join(home, 'docs-link');
    symlinkSync(docs, linkToDocs);
    const opts = { homeDir: home, platform: 'darwin' as const };
    expect(protectedFolderReason('/', opts)).not.toBeNull();
    expect(protectedFolderReason(home, opts)).not.toBeNull();
    expect(protectedFolderReason(docs, opts)).not.toBeNull();
    expect(protectedFolderReason(linkToDocs, opts)).not.toBeNull();
    expect(protectedFolderReason(subDoc, opts)).toBeNull();

    const root = testTempDir('cairn-pf-guard-root-');
    const wsMgr = makeWorkspace();
    await expect(
      wsMgr.prepare({
        projectId: 'p-prot',
        conversationId: 'conv-prot',
        cloneUrl: '/',
        repoKind: 'local',
        workspacesRoot: root,
        credentials: null,
      }),
    ).rejects.toMatchObject({
      reason: 'protected_folder',
    } satisfies Partial<LocalRepoUnreachableError>);

    const folderGit = testTempDir('cairn-pf-rep-dir-');
    writeFileSync(join(folderGit, 'f.txt'), 'before\n');
    const wsRep = await wsMgr.prepare({
      projectId: 'p-rep',
      conversationId: 'conv-rep',
      cloneUrl: folderGit,
      repoKind: 'local',
      workspacesRoot: root,
      credentials: null,
    });
    writeFileSync(join(wsRep.cwd, 'f.txt'), 'after\n');
    await wsMgr.commitAll(wsRep.cwd, 'edit', IDENTITY);
    await runGit(['init', folderGit]);
    await wsMgr.push(wsRep.cwd, wsRep.branch, null, {
      base: null,
      identity: null,
      stepId: 'rep-1',
    });
    expect(wsMgr.plainFolderMeta(wsRep.cwd)?.status).toBe('folder-replaced');
    expect(readFileSync(join(folderGit, 'f.txt'), 'utf8')).toBe('before\n');

    const folderDel = testTempDir('cairn-pf-del-dir-');
    writeFileSync(join(folderDel, 'f.txt'), 'before\n');
    const wsDel = await wsMgr.prepare({
      projectId: 'p-del',
      conversationId: 'conv-del',
      cloneUrl: folderDel,
      repoKind: 'local',
      workspacesRoot: root,
      credentials: null,
    });
    writeFileSync(join(wsDel.cwd, 'f.txt'), 'after\n');
    await wsMgr.commitAll(wsDel.cwd, 'edit', IDENTITY);
    rmSync(folderDel, { recursive: true, force: true });
    await wsMgr.push(wsDel.cwd, wsDel.branch, null, {
      base: null,
      identity: null,
      stepId: 'del-1',
    });
    expect(wsMgr.plainFolderMeta(wsDel.cwd)?.status).toBe('missing-folder');

    const enospcFolder = testTempDir('cairn-pf-nospc-');
    writeFileSync(join(enospcFolder, 'a.txt'), 'orig\n');
    const partialWs = makeWorkspace({
      shadowCopyImpl: async (_src, dst) => {
        writeFileSync(join(dst, 'partial.tmp'), 'junk');
        const err = new Error('ENOSPC: no space left on device') as NodeJS.ErrnoException;
        err.code = 'ENOSPC';
        throw err;
      },
    });
    await expect(
      partialWs.prepare({
        projectId: 'p-enospc',
        conversationId: 'conv-enospc-cow',
        cloneUrl: enospcFolder,
        repoKind: 'local',
        workspacesRoot: root,
        credentials: null,
      }),
    ).rejects.toBeInstanceOf(ShadowDiskFullError);
    expect(existsSync(join(root, 'conv-enospc-cow'))).toBe(false);

    const writeNospcWs = makeWorkspace({
      shadowWriteFileImpl: () => {
        const err = new Error('ENOSPC: no space left on device') as NodeJS.ErrnoException;
        err.code = 'ENOSPC';
        throw err;
      },
    });
    const wsWriteErr = await writeNospcWs.prepare({
      projectId: 'p-wnospc',
      conversationId: 'conv-wnospc',
      cloneUrl: enospcFolder,
      repoKind: 'local',
      workspacesRoot: root,
      credentials: null,
    });
    writeFileSync(join(wsWriteErr.cwd, 'a.txt'), 'updated\n');
    await writeNospcWs.commitAll(wsWriteErr.cwd, 'edit', IDENTITY);
    await writeNospcWs.push(wsWriteErr.cwd, wsWriteErr.branch, null, {
      base: null,
      identity: null,
      stepId: 'wnospc-1',
    });
    expect(writeNospcWs.plainFolderMeta(wsWriteErr.cwd)?.status).toBe('disk-full');
    expect(readFileSync(join(enospcFolder, 'a.txt'), 'utf8')).toBe('orig\n');
    expect(statSync(enospcFolder).isDirectory()).toBe(true);
  }, 30_000);

  test('ignores foreign GIT_DIR/GIT_CONFIG_GLOBAL with gpgsign=true and disables shadow checkpoints without blocking on timeout', async () => {
    const root = testTempDir('cairn-pf-env-root-');
    const folder = testTempDir('cairn-pf-env-dir-');
    const foreign = testTempDir('cairn-pf-env-foreign-');
    const badCfg = join(root, 'bad-gitconfig');
    writeFileSync(badCfg, '[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = /nonexistent/gpg\n');
    writeFileSync(join(folder, 'item.txt'), 'v1\n');
    await runGit(['init', foreign]);

    const prevGitDir = process.env.GIT_DIR;
    const prevCfg = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_DIR = join(foreign, '.git');
    process.env.GIT_CONFIG_GLOBAL = badCfg;
    try {
      const wsMgr = makeWorkspace();
      const ws = await wsMgr.prepare({
        projectId: 'p-env',
        conversationId: 'conv-env',
        cloneUrl: folder,
        repoKind: 'local',
        workspacesRoot: root,
        credentials: null,
      });
      writeFileSync(join(ws.cwd, 'item.txt'), 'v2\n');
      await wsMgr.commitAll(ws.cwd, 'step with foreign git env', IDENTITY);
      await wsMgr.push(ws.cwd, ws.branch, null, { base: null, identity: null, stepId: 's-env' });
      expect(readFileSync(join(folder, 'item.txt'), 'utf8')).toBe('v2\n');
    } finally {
      if (prevGitDir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = prevGitDir;
      if (prevCfg === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = prevCfg;
    }

    const timedOutWs = makeWorkspace({ shadowGitTimeoutMs: 1 });
    const hugeTimedOut = await timedOutWs.prepare({
      projectId: 'p-to',
      conversationId: 'conv-to',
      cloneUrl: folder,
      repoKind: 'local',
      workspacesRoot: root,
      credentials: null,
    });
    expect(hugeTimedOut.cwd).not.toBe('');
    const act = await timedOutWs.runPlainFolderAction({
      workspacesRoot: root,
      projectId: 'p-to',
      buildId: 'conv-to',
      stepId: 's-to',
      realFolder: folder,
      action: 'undo',
    });
    expect(['disabled', 'snapshot-missing', 'no-changes']).toContain(act.outcome);
  }, 30_000);

  test('pins postCommit from merged tree without sweeping concurrent user saves during write-back', async () => {
    const root = testTempDir('cairn-pf-rev1-root-');
    const f1 = testTempDir('cairn-pf-rev1-');
    writeFileSync(join(f1, 'base.txt'), 'base\n');
    let injectedSave = false;
    const ws1 = makeWorkspace({
      shadowWriteFileImpl: (target, content, mode) => {
        if (!injectedSave) {
          injectedSave = true;
          writeFileSync(join(f1, 'concurrent-user.txt'), 'user kept this\n');
        }
        writeFileSync(target, content, { mode });
        chmodSync(target, mode);
      },
    });
    const prep1 = await ws1.prepare({
      projectId: 'p-rev1',
      conversationId: 'conv-rev1',
      cloneUrl: f1,
      repoKind: 'local',
      workspacesRoot: root,
      credentials: null,
    });
    writeFileSync(join(prep1.cwd, 'task-new.txt'), 'task delivered\n');
    await ws1.commitAll(prep1.cwd, 'task-new', IDENTITY);
    await ws1.push(prep1.cwd, prep1.branch, null, { base: null, identity: null, stepId: 's-r1' });
    expect(readFileSync(join(f1, 'concurrent-user.txt'), 'utf8')).toBe('user kept this\n');
    const undo1 = await ws1.runPlainFolderAction({
      workspacesRoot: root,
      projectId: 'p-rev1',
      buildId: 'conv-rev1',
      stepId: 's-r1-undo',
      realFolder: f1,
      action: 'undo',
    });
    expect(undo1.outcome).toBe('undone');
    expect(existsSync(join(f1, 'task-new.txt'))).toBe(false);
    expect(readFileSync(join(f1, 'concurrent-user.txt'), 'utf8')).toBe('user kept this\n');
  }, 30_000);

  test('snapshots convDir after cloneCow so files entering convDir during copy are in base and not falsely delivered', async () => {
    const root = testTempDir('cairn-pf-rev2-root-');
    const f2 = testTempDir('cairn-pf-rev2-');
    writeFileSync(join(f2, 'tracked.txt'), 'v1\n');
    const ws2 = makeWorkspace({
      shadowCopyImpl: async (src, dst) => {
        writeFileSync(join(src, 'race-created.txt'), 'user pre-copy\n');
        for (const name of ['tracked.txt', 'race-created.txt']) {
          writeFileSync(join(dst, name), readFileSync(join(src, name)));
        }
      },
    });
    const prep2 = await ws2.prepare({
      projectId: 'p-rev2',
      conversationId: 'conv-rev2',
      cloneUrl: f2,
      repoKind: 'local',
      workspacesRoot: root,
      credentials: null,
    });
    await ws2.commitAll(prep2.cwd, 'noop after race copy', IDENTITY);
    await ws2.push(prep2.cwd, prep2.branch, null, { base: null, identity: null, stepId: 's-r2' });
    expect(ws2.plainFolderMeta(prep2.cwd)?.status).toBe('no-changes');
    expect(ws2.plainFolderMeta(prep2.cwd)?.undoable).toBe(false);
  }, 30_000);

  test('preserves restrictive 0600 file permissions across merge-back, undo, and TOCTOU rollback', async () => {
    const root = testTempDir('cairn-pf-rev3-root-');
    const f3 = testTempDir('cairn-pf-rev3-');
    writeFileSync(join(f3, 'secret.cfg'), 'k=1\n');
    chmodSync(join(f3, 'secret.cfg'), 0o600);
    writeFileSync(join(f3, 'z-last.txt'), 'orig\n');
    const ws3 = makeWorkspace();
    const prep3 = await ws3.prepare({
      projectId: 'p-rev3',
      conversationId: 'conv-rev3',
      cloneUrl: f3,
      repoKind: 'local',
      workspacesRoot: root,
      credentials: null,
    });
    writeFileSync(join(prep3.cwd, 'secret.cfg'), 'k=2\n');
    await ws3.commitAll(prep3.cwd, 'edit 0600', IDENTITY);
    await ws3.push(prep3.cwd, prep3.branch, null, { base: null, identity: null, stepId: 's-r3' });
    expect(statSync(join(f3, 'secret.cfg')).mode & 0o777).toBe(0o600);
    await ws3.runPlainFolderAction({
      workspacesRoot: root,
      projectId: 'p-rev3',
      buildId: 'conv-rev3',
      stepId: 's-r3-undo',
      realFolder: f3,
      action: 'undo',
    });
    expect(readFileSync(join(f3, 'secret.cfg'), 'utf8')).toBe('k=1\n');
    expect(statSync(join(f3, 'secret.cfg')).mode & 0o777).toBe(0o600);

    let failSecondWrite = false;
    const ws3Rollback = makeWorkspace({
      shadowWriteFileImpl: (target, content, mode) => {
        if (target.endsWith('secret.cfg') && failSecondWrite) {
          writeFileSync(join(f3, 'z-last.txt'), 'external race\n');
        }
        writeFileSync(target, content, { mode });
        chmodSync(target, mode);
      },
    });
    const prep3Rb = await ws3Rollback.prepare({
      projectId: 'p-rev3-rb',
      conversationId: 'conv-rev3-rb',
      cloneUrl: f3,
      repoKind: 'local',
      workspacesRoot: root,
      credentials: null,
    });
    writeFileSync(join(prep3Rb.cwd, 'secret.cfg'), 'k=3\n');
    writeFileSync(join(prep3Rb.cwd, 'z-last.txt'), 'task-z\n');
    await ws3Rollback.commitAll(prep3Rb.cwd, 'rb test', IDENTITY);
    failSecondWrite = true;
    await ws3Rollback.push(prep3Rb.cwd, prep3Rb.branch, null, {
      base: null,
      identity: null,
      stepId: 's-r3-rb',
    });
    expect(readFileSync(join(f3, 'secret.cfg'), 'utf8')).toBe('k=1\n');
    expect(statSync(join(f3, 'secret.cfg')).mode & 0o777).toBe(0o600);
  }, 30_000);

  test('blocks sibling task writes on cross-task partial-unknown journal and reconciles applied leg missing from task record', async () => {
    const root = testTempDir('cairn-pf-rev4-root-');
    const f4 = testTempDir('cairn-pf-rev4-');
    writeFileSync(join(f4, 'a.txt'), 'v1\n');
    const ws4A = makeWorkspace();
    const prep4A = await ws4A.prepare({
      projectId: 'p-rev4',
      conversationId: 'conv-rev4a',
      cloneUrl: f4,
      repoKind: 'local',
      workspacesRoot: root,
      credentials: null,
    });
    const prep4B = await ws4A.prepare({
      projectId: 'p-rev4',
      conversationId: 'conv-rev4b',
      cloneUrl: f4,
      repoKind: 'local',
      workspacesRoot: root,
      credentials: null,
    });
    writeFileSync(
      join(prep4A.baseRepoDir, 'journals', 'conv-rev4a.json'),
      JSON.stringify({
        buildId: 'conv-rev4a',
        stepId: 's-4a',
        action: 'merge',
        state: 'partial-unknown',
        preCommit: '0'.repeat(40),
        targetTree: '1'.repeat(40),
        updatedAt: Date.now(),
      }),
    );
    writeFileSync(join(prep4B.cwd, 'b.txt'), 'from b\n');
    await ws4A.commitAll(prep4B.cwd, 'task B', IDENTITY);
    await ws4A.push(prep4B.cwd, prep4B.branch, null, {
      base: null,
      identity: null,
      stepId: 's-4b',
    });
    expect(ws4A.plainFolderMeta(prep4B.cwd)?.status).toBe('partial-unknown');
    expect(existsSync(join(f4, 'b.txt'))).toBe(false);
  }, 30_000);

  test('marks huge non-build plan step readonly and clones attachment verify workspace from shadowRepo', async () => {
    const root = testTempDir('cairn-pf-rev5-root-');
    const hugeDir = testTempDir('cairn-pf-rev5-huge-');
    writeFileSync(join(hugeDir, 'big.txt'), 'x'.repeat(200));
    const tinyWsMgr = makeWorkspace({ hugeFolderBytes: 50 });
    const hugePlanWs = await tinyWsMgr.prepare({
      projectId: 'p-huge-plan',
      conversationId: 'conv-huge-plan',
      cloneUrl: hugeDir,
      repoKind: 'local',
      workspacesRoot: root,
      credentials: null,
      stepKind: 'plan',
    });
    expect(hugePlanWs.readonly).toBe(true);
    hugePlanWs.release?.();

    const normalDir = testTempDir('cairn-pf-rev5-norm-');
    writeFileSync(join(normalDir, 'init.txt'), 'init\n');
    const wsMgr = makeWorkspace();
    const verifyPrep = await wsMgr.prepare({
      projectId: 'p-verify',
      conversationId: 'conv-verify',
      cloneUrl: normalDir,
      repoKind: 'local',
      workspacesRoot: root,
      credentials: null,
      stepKind: 'build',
    });
    writeFileSync(join(verifyPrep.cwd, 'verified.txt'), 'proof\n');
    const committed = await wsMgr.commitAll(verifyPrep.cwd, 'verify target', IDENTITY);
    const cleanups: (() => void | Promise<void>)[] = [];
    const verifyClone = await prepareVerifyClone({
      workspace: wsMgr,
      ws: verifyPrep,
      headAtStart: committed.head,
      evidenceDirectory: '.cairn-verify/run_1/',
      expectedHeadSha: committed.head ?? undefined,
      cleanups,
    });
    try {
      expect('error' in verifyClone).toBe(false);
      if (!('error' in verifyClone)) {
        expect(readFileSync(join(verifyClone.cwd, 'verified.txt'), 'utf8')).toBe('proof\n');
        expect(verifyClone.ws.plainFolder).toBeUndefined();
      }
    } finally {
      for (const cleanup of cleanups) await cleanup();
    }
  }, 30_000);
});
