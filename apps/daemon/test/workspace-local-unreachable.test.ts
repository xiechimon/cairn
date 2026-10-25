import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalRepoUnreachableError } from '@cairn/shared';
import { beforeEach, describe, expect, test } from 'vitest';
import { commitEnv, runGit } from '../src/git.js';
import type { DaemonLogger } from '../src/log.js';
import { localRepoUnreachableMessage, WorkspaceManager } from '../src/workspace.js';

const IDENTITY = { name: 'it-agent', email: 'it@cairn.local' };

function fakeLogger(): DaemonLogger & { lines: string[] } {
  const lines: string[] = [];
  const push = (msg: string) => lines.push(msg);
  const prefixed = (prefix: string, msg: string) => push(`[${prefix}] ${msg}`);
  return {
    lines,
    raw: push,
    prefixed,
    supervisor: (m) => prefixed('supervisor', m),
    machine: (m) => prefixed('machine', m),
    step: (m) => prefixed('step', m),
    workspace: (m) => prefixed('workspace', m),
    recover: (m) => prefixed('recover', m),
    wake: (m) => prefixed('wake', m),
    mcp: (m) => prefixed('mcp', m),
    skills: (m) => prefixed('skills', m),
    gate: (m) => prefixed('gate', m),
    trust: (m) => prefixed('trust', m),
  };
}

const PROJECT_ID = 'proj-local-unreach';
const CONV = '01a0b86f-04f9-72a8-bba4-75c5cfd65990';

let root: string;
let logger: ReturnType<typeof fakeLogger>;
let ws: WorkspaceManager;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cairn-lu-root-'));
  logger = fakeLogger();
  ws = new WorkspaceManager({ logger });
});

async function seedUserRepo(): Promise<string> {
  const dir = join(mkdtempSync(join(tmpdir(), 'cairn-lu-repo-')), 'repo');
  await runGit(['init', '-b', 'main', dir]);
  writeFileSync(join(dir, 'README.md'), '# user repo\n');
  await runGit(['add', '-A'], { cwd: dir });
  await runGit(['commit', '-m', 'seed'], { cwd: dir, env: commitEnv(IDENTITY) });
  return dir;
}

function localPrepareInput(cloneUrl: string, withKind: boolean) {
  return {
    projectId: PROJECT_ID,
    conversationId: CONV,
    cloneUrl,
    workspacesRoot: root,
    credentials: null,
    ...(withKind ? { repoKind: 'local' as const } : {}),
  };
}

describe('local-shape execution surface fail-loud (#1210 C fallback)', () => {
  test('L1 path missing → LocalRepoUnreachableError(not_found), no half-built base', async () => {
    const gone = join(root, 'definitely-not-here', 'repo');
    const err = await ws.prepare(localPrepareInput(gone, true)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LocalRepoUnreachableError);
    expect(err).toMatchObject({
      name: 'LocalRepoUnreachableError',
      repoPath: gone,
      reason: 'not_found',
    });
    expect(existsSync(join(root, PROJECT_ID, 'repo'))).toBe(false);
  });

  test('L2 path exists but is not a git repo → LocalRepoUnreachableError(not_git)', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'cairn-lu-plain-'));
    writeFileSync(join(plain, 'notes.txt'), 'not a repo\n');
    const err = await ws.prepare(localPrepareInput(plain, true)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LocalRepoUnreachableError);
    expect(err).toMatchObject({
      name: 'LocalRepoUnreachableError',
      repoPath: plain,
      reason: 'not_git',
    });
    rmSync(plain, { recursive: true, force: true });
  }, 30_000);

  test('L3 healthy worktree repo → prepare succeeds as usual (zero drift on the machine hosting the repo)', async () => {
    const repo = await seedUserRepo();
    const prepared = await ws.prepare(localPrepareInput(repo, true));
    expect(prepared.reused).toBe(false);
    expect(existsSync(join(prepared.cwd, 'README.md'))).toBe(true);
    expect(prepared.defaultBranch).toBe('main');
  }, 30_000);

  test('L4 repoKind absent + path missing → current behavior preserved: bare git error, not a typed error', async () => {
    const gone = join(root, 'definitely-not-here', 'repo');
    const err = await ws.prepare(localPrepareInput(gone, false)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(LocalRepoUnreachableError);
  }, 30_000);

  test('L5 wording: names machine + path + human-readable cause + two remedies', () => {
    const err = new LocalRepoUnreachableError('/Users/dev/code/cairn', 'not_found');
    const msg = localRepoUnreachableMessage('mea', err);
    expect(msg).toContain('mea');
    expect(msg).toContain('/Users/dev/code/cairn');
    expect(msg).toContain('路径不存在');
    expect(msg).toContain('钉选');
    expect(msg).toContain('GitHub 形态');
    expect(msg).not.toMatch(/token|password|x-access/i);
    const notGit = localRepoUnreachableMessage(
      'mea',
      new LocalRepoUnreachableError('/srv/plain', 'not_git'),
    );
    expect(notGit).toContain('不是 git 仓库');
  });
});
