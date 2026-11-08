import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { commitEnv, runGit } from '../src/git.js';
import type { DaemonLogger } from '../src/log.js';
import { WorkspaceManager } from '../src/workspace.js';
import { testTempDir } from './test-temp-dir.js';

const IDENTITY = { name: 'it-agent', email: 'it@cairn.local' };
const PROJECT_ID = 'proj-staging-1';
const CONV = '01a0b86f-bbbb-72a8-bba4-75c5cfd6598f';
const SETUP_HOOK = [
  '#!/bin/sh',
  'printf "lockfileVersion: 9\\nsetup-drift: true\\n" > pnpm-lock.yaml',
  'mkdir -p .setup-cache && echo cache > .setup-cache/state',
  '',
].join('\n');

function quietLogger(): DaemonLogger & { lines: string[] } {
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
    skills: (m) => prefixed('skills', m),
    gate: (m) => prefixed('gate', m),
    trust: (m) => prefixed('trust', m),
    mcp: (m) => prefixed('mcp', m),
  };
}

let userRepo: string;
let root: string;

async function git(dir: string, args: string[]): Promise<string> {
  const r = await runGit(args, { cwd: dir, env: commitEnv(IDENTITY) });
  if (r.code !== 0) throw new Error(r.stderr || r.stdout);
  return r.stdout.trim();
}

async function seedRepo(dir: string, extraHook?: string): Promise<void> {
  await runGit(['init', '-b', 'main', dir]);
  writeFileSync(join(dir, 'README.md'), '# repo\n');
  writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  mkdirSync(join(dir, '.agents'), { recursive: true });
  writeFileSync(join(dir, '.agents', 'setup'), SETUP_HOOK + (extraHook ?? ''));
  chmodSync(join(dir, '.agents', 'setup'), 0o755);
  writeFileSync(join(dir, '.agents', 'resume'), SETUP_HOOK);
  chmodSync(join(dir, '.agents', 'resume'), 0o755);
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-m', 'init']);
}

function prepareInput() {
  return {
    projectId: PROJECT_ID,
    conversationId: CONV,
    cloneUrl: userRepo,
    workspacesRoot: root,
    credentials: null,
  };
}

async function committedPaths(cwd: string): Promise<string[]> {
  const out = await git(cwd, ['show', '--name-only', '--format=', 'HEAD']);
  return out.split('\n').filter((line) => line !== '');
}

beforeEach(() => {
  const base = testTempDir('cairn-commit-staging-');
  userRepo = join(base, 'user-repo');
  root = join(base, 'workspaces');
});

describe('commitAll stages only the agent work, never workspace setup drift (task stall S7)', () => {
  test('setup-hook lockfile drift and untracked setup output stay out of the commit and are reported', async () => {
    await seedRepo(userRepo);
    const ws = new WorkspaceManager({ logger: quietLogger() });
    const prepared = await ws.prepare(prepareInput());
    expect(readFileSync(join(prepared.cwd, 'pnpm-lock.yaml'), 'utf8')).toContain('setup-drift');
    writeFileSync(join(prepared.cwd, 'feature.txt'), 'agent work\n');

    const result = await ws.commitAll(prepared.cwd, 'build: feature', IDENTITY);

    expect(result.committed).toBe(true);
    expect(await committedPaths(prepared.cwd)).toEqual(['feature.txt']);
    expect(result.setupDrift.sort()).toEqual(['.setup-cache/state', 'pnpm-lock.yaml']);
    expect(readFileSync(join(prepared.cwd, 'pnpm-lock.yaml'), 'utf8')).toContain('setup-drift');
  }, 60_000);

  test('drift recorded at setup is still excluded after a resume hook rewrites it identically', async () => {
    await seedRepo(userRepo);
    await new WorkspaceManager({ logger: quietLogger() }).prepare(prepareInput());
    const resumed = new WorkspaceManager({ logger: quietLogger() });
    const prepared = await resumed.prepare(prepareInput());
    expect(prepared.reused).toBe(true);
    writeFileSync(join(prepared.cwd, 'feature.txt'), 'agent work\n');

    const result = await resumed.commitAll(prepared.cwd, 'build: feature', IDENTITY);

    expect(await committedPaths(prepared.cwd)).toEqual(['feature.txt']);
    expect(result.setupDrift).toContain('pnpm-lock.yaml');
  }, 60_000);

  test('an agent edit on top of a drifted path is the agent change and is committed', async () => {
    await seedRepo(userRepo);
    const ws = new WorkspaceManager({ logger: quietLogger() });
    const prepared = await ws.prepare(prepareInput());
    writeFileSync(join(prepared.cwd, 'pnpm-lock.yaml'), 'lockfileVersion: 9\nagent-dep: 1\n');

    const result = await ws.commitAll(prepared.cwd, 'build: dep', IDENTITY);

    expect(await committedPaths(prepared.cwd)).toEqual(['pnpm-lock.yaml']);
    expect(result.setupDrift).toEqual(['.setup-cache/state']);
  }, 60_000);

  test('drift the agent staged by hand is unstaged before the commit', async () => {
    await seedRepo(userRepo);
    const ws = new WorkspaceManager({ logger: quietLogger() });
    const prepared = await ws.prepare(prepareInput());
    writeFileSync(join(prepared.cwd, 'feature.txt'), 'agent work\n');
    await git(prepared.cwd, ['add', '--all']);

    await ws.commitAll(prepared.cwd, 'build: feature', IDENTITY);

    expect(await committedPaths(prepared.cwd)).toEqual(['feature.txt']);
  }, 60_000);

  test('the commit runs its hooks inside the repository hook budget, and a timeout says so', async () => {
    await seedRepo(
      userRepo,
      'git config core.hooksPath .commit-hooks\nmkdir -p .commit-hooks\nprintf "#!/bin/sh\\nexec sleep 30\\n" > .commit-hooks/pre-commit\nchmod +x .commit-hooks/pre-commit\n',
    );
    const ws = new WorkspaceManager({ logger: quietLogger(), hookTimeoutMs: 1_500 });
    const prepared = await ws.prepare(prepareInput());
    writeFileSync(join(prepared.cwd, 'feature.txt'), 'agent work\n');

    await expect(ws.commitAll(prepared.cwd, 'build: feature', IDENTITY)).rejects.toThrow(
      /git commit failed \(signal SIGTERM, timed out after 1500 ms\)/,
    );
  }, 60_000);
});
