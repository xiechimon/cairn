import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { commitEnv, gitPrim, runGit } from '../src/git.js';
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

  test('a setup path the agent staged by hand is the agent choice and is committed', async () => {
    await seedRepo(userRepo);
    const ws = new WorkspaceManager({ logger: quietLogger() });
    const prepared = await ws.prepare(prepareInput());
    writeFileSync(join(prepared.cwd, 'feature.txt'), 'agent work\n');
    await git(prepared.cwd, ['add', '.setup-cache/state']);

    const result = await ws.commitAll(prepared.cwd, 'build: feature', IDENTITY);

    expect((await committedPaths(prepared.cwd)).sort()).toEqual([
      '.setup-cache/state',
      'feature.txt',
    ]);
    expect(result.setupDrift).toEqual(['pnpm-lock.yaml']);
  }, 60_000);

  test('a merge step over a setup-edited tracked file that changed upstream elsewhere merges and regenerates the setup output', async () => {
    await seedRepo(userRepo, 'sed -i "s/^alpha$/alpha-setup/" config.txt\n');
    writeFileSync(join(userRepo, 'config.txt'), 'alpha\nbeta\ngamma\n');
    await git(userRepo, ['add', 'config.txt']);
    await git(userRepo, ['commit', '-m', 'config']);
    const ws = new WorkspaceManager({ logger: quietLogger() });
    const prepared = await ws.prepare(prepareInput());
    expect(readFileSync(join(prepared.cwd, 'config.txt'), 'utf8')).toBe(
      'alpha-setup\nbeta\ngamma\n',
    );
    writeFileSync(join(prepared.cwd, 'feature.txt'), 'agent work\n');
    const committed = await ws.commitAll(prepared.cwd, 'build: feature', IDENTITY);
    expect(committed.setupDrift).toContain('config.txt');

    writeFileSync(join(userRepo, 'config.txt'), 'alpha\nbeta\ngamma-upstream\n');
    await git(userRepo, ['commit', '-am', 'upstream: gamma']);
    await gitPrim.fetch(prepared.baseRepoDir, null);
    await git(prepared.cwd, ['config', 'user.name', IDENTITY.name]);
    await git(prepared.cwd, ['config', 'user.email', IDENTITY.email]);

    await ws.mergeDefaultBranch(prepared.cwd, prepared.defaultBranch, null);

    expect(readFileSync(join(prepared.cwd, 'config.txt'), 'utf8')).toBe(
      'alpha-setup\nbeta\ngamma-upstream\n',
    );
    expect(await git(prepared.cwd, ['show', 'HEAD:config.txt'])).toBe(
      'alpha\nbeta\ngamma-upstream',
    );
    writeFileSync(join(prepared.cwd, 'after.txt'), 'more agent work\n');
    const next = await ws.commitAll(prepared.cwd, 'build: after merge', IDENTITY);
    expect(next.setupDrift).toContain('config.txt');
    expect(await committedPaths(prepared.cwd)).toEqual(['after.txt']);
  }, 60_000);

  test('a deletion or rename the agent already staged is committed without re-adding the removed path', async () => {
    await seedRepo(userRepo);
    const ws = new WorkspaceManager({ logger: quietLogger() });
    const prepared = await ws.prepare(prepareInput());
    await git(prepared.cwd, ['mv', 'README.md', 'GUIDE.md']);

    const result = await ws.commitAll(prepared.cwd, 'build: rename readme', IDENTITY);

    expect(result.committed).toBe(true);
    expect(
      await git(prepared.cwd, ['ls-tree', '--name-only', 'HEAD', 'README.md', 'GUIDE.md']),
    ).toBe('GUIDE.md');
    expect(await git(prepared.cwd, ['ls-files', 'README.md'])).toBe('');
  }, 60_000);

  test('agent edits that existed before a resume hook touched the same file stay the agent change', async () => {
    await seedRepo(userRepo);
    writeFileSync(
      join(userRepo, '.agents', 'resume'),
      '#!/bin/sh\necho "resumed: true" >> pnpm-lock.yaml\n',
    );
    await git(userRepo, ['commit', '-am', 'append-only resume hook']);
    const ws = new WorkspaceManager({ logger: quietLogger() });
    const first = await ws.prepare(prepareInput());
    writeFileSync(join(first.cwd, 'pnpm-lock.yaml'), 'lockfileVersion: 9\nagent-dep: 1\n');
    const resumed = await new WorkspaceManager({ logger: quietLogger() }).prepare(prepareInput());
    expect(resumed.reused).toBe(true);

    const result = await ws.commitAll(resumed.cwd, 'build: dep', IDENTITY);

    expect(await committedPaths(resumed.cwd)).toContain('pnpm-lock.yaml');
    expect(result.setupDrift).not.toContain('pnpm-lock.yaml');
  }, 60_000);

  test('an agent making a setup-written script executable is the agent change and is committed', async () => {
    await seedRepo(userRepo, 'printf "#!/bin/sh\\necho hi\\n" > tool.sh\n');
    const ws = new WorkspaceManager({ logger: quietLogger() });
    const prepared = await ws.prepare(prepareInput());
    writeFileSync(join(prepared.cwd, 'feature.txt'), 'agent work\n');
    const first = await ws.commitAll(prepared.cwd, 'build: feature', IDENTITY);
    expect(first.setupDrift).toContain('tool.sh');

    chmodSync(join(prepared.cwd, 'tool.sh'), 0o755);
    const result = await ws.commitAll(prepared.cwd, 'build: make tool executable', IDENTITY);

    expect(await committedPaths(prepared.cwd)).toEqual(['tool.sh']);
    expect(result.setupDrift).not.toContain('tool.sh');
  }, 60_000);

  test('a path the setup hook also staged is still setup drift and stays out of the commit', async () => {
    await seedRepo(userRepo, 'git add pnpm-lock.yaml\n');
    const ws = new WorkspaceManager({ logger: quietLogger() });
    const prepared = await ws.prepare(prepareInput());
    writeFileSync(join(prepared.cwd, 'feature.txt'), 'agent work\n');

    const result = await ws.commitAll(prepared.cwd, 'build: feature', IDENTITY);

    expect(await committedPaths(prepared.cwd)).toEqual(['feature.txt']);
    expect(result.setupDrift).toContain('pnpm-lock.yaml');
    expect(readFileSync(join(prepared.cwd, 'pnpm-lock.yaml'), 'utf8')).toContain('setup-drift');

    writeFileSync(join(prepared.cwd, 'second.txt'), 'more agent work\n');
    const again = await ws.commitAll(prepared.cwd, 'build: second', IDENTITY);
    expect(await committedPaths(prepared.cwd)).toEqual(['second.txt']);
    expect(again.setupDrift).toContain('pnpm-lock.yaml');
  }, 60_000);

  test('a submodule the agent moved after setup moved it is the agent change and is committed', async () => {
    const sub = join(userRepo, '..', 'sub-repo');
    await runGit(['init', '-b', 'main', sub]);
    const commits: string[] = [];
    for (const body of ['one', 'two', 'three']) {
      writeFileSync(join(sub, 'a.txt'), `${body}\n`);
      await git(sub, ['add', 'a.txt']);
      await git(sub, ['commit', '-m', body]);
      commits.push(await git(sub, ['rev-parse', 'HEAD']));
    }
    await git(sub, ['checkout', '-q', commits[0] ?? '']);
    await seedRepo(
      userRepo,
      'git -c protocol.file.allow=always submodule update --init -q vendor/sub\ngit -C vendor/sub checkout -q main\n',
    );
    await git(userRepo, [
      '-c',
      'protocol.file.allow=always',
      'submodule',
      'add',
      '-q',
      sub,
      'vendor/sub',
    ]);
    await git(userRepo, ['commit', '-m', 'add submodule']);
    const ws = new WorkspaceManager({ logger: quietLogger() });
    const prepared = await ws.prepare(prepareInput());
    const submodule = join(prepared.cwd, 'vendor/sub');
    expect(await git(submodule, ['rev-parse', 'HEAD'])).toBe(commits[2]);

    writeFileSync(join(prepared.cwd, 'feature.txt'), 'agent work\n');
    const first = await ws.commitAll(prepared.cwd, 'build: feature', IDENTITY);
    expect(await committedPaths(prepared.cwd)).toEqual(['feature.txt']);
    expect(first.setupDrift).toContain('vendor/sub');

    await git(submodule, ['checkout', '-q', commits[1] ?? '']);
    const result = await ws.commitAll(prepared.cwd, 'build: pin submodule', IDENTITY);

    expect(await committedPaths(prepared.cwd)).toContain('vendor/sub');
    expect(result.setupDrift).not.toContain('vendor/sub');
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

test('a step with only setup drift skips commit hooks and finishes with no changes', async () => {
  await seedRepo(userRepo);
  const ws = new WorkspaceManager({ logger: quietLogger() });
  const prepared = await ws.prepare(prepareInput());
  const head = await ws.headCommit(prepared.cwd);
  const hook = await gitPrim.gitPath(prepared.cwd, 'hooks/pre-commit');
  mkdirSync(join(hook, '..'), { recursive: true });
  writeFileSync(hook, '#!/bin/sh\necho empty-step-hook-ran >&2\nexit 1\n', { mode: 0o755 });
  await expect(ws.commitAll(prepared.cwd, 'build: deliberate pause', IDENTITY)).resolves.toEqual({
    committed: false,
    head,
    setupDrift: expect.arrayContaining(['.setup-cache/state', 'pnpm-lock.yaml']),
  });
});
