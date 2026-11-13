import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { gitPrim } from '../src/git.js';
import { createDaemonLogger } from '../src/log.js';
import { orbAgentHome, orbWorkspacesRoot } from '../src/orb/worker.js';
import { WorkspaceManager } from '../src/workspace.js';
import { testTempDir } from './test-temp-dir.js';

function copySeedRepo(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) copySeedRepo(from, to);
    else copyFileSync(from, to);
  }
}

test('seeds a private base clone, fetches with the step credential and leaves the seed untouched', async () => {
  const root = testTempDir('orb-seed-');
  const truth = join(root, 'truth');
  const seedRoot = join(root, 'seed');
  const seed = join(seedRoot, 'project', 'repo');
  execFileSync('git', ['init', '-b', 'main', truth]);
  writeFileSync(join(truth, 'file.txt'), 'first');
  execFileSync('git', ['-C', truth, 'add', 'file.txt']);
  execFileSync('git', [
    '-C',
    truth,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.test',
    '-c',
    'maintenance.auto=false',
    '-c',
    'gc.auto=0',
    'commit',
    '-m',
    'First',
  ]);
  copySeedRepo(truth, seed);
  const seedConfig = readFileSync(join(seed, '.git', 'config'), 'utf8');
  writeFileSync(join(truth, 'file.txt'), 'second');
  execFileSync('git', ['-C', truth, 'add', 'file.txt']);
  execFileSync('git', [
    '-C',
    truth,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.test',
    '-c',
    'maintenance.auto=false',
    '-c',
    'gc.auto=0',
    'commit',
    '-m',
    'Second',
  ]);
  const credentials = { url: truth, username: 'step', password: 'git-sentinel' };
  const fetch = vi.spyOn(gitPrim, 'fetch');
  const clone = vi.spyOn(gitPrim, 'clone');
  try {
    const workspace = new WorkspaceManager({ logger: createDaemonLogger({}), seedRoot });
    const prepared = await workspace.prepare({
      projectId: 'project',
      conversationId: 'thread',
      cloneUrl: truth,
      repoKind: 'github',
      workspacesRoot: join(root, 'work'),
      credentials,
      machineCredentialFallback: true,
    });
    expect(clone).toHaveBeenCalledWith(seed, prepared.baseRepoDir, null);
    expect(fetch).toHaveBeenCalledWith(prepared.baseRepoDir, credentials);
    expect(readFileSync(join(prepared.cwd, 'file.txt'), 'utf8')).toBe('second');
    expect(readFileSync(join(seed, 'file.txt'), 'utf8')).toBe('first');
    expect(readFileSync(join(seed, '.git', 'config'), 'utf8')).toBe(seedConfig);
    expect(readFileSync(join(prepared.baseRepoDir, '.git', 'config'), 'utf8')).not.toContain(
      'git-sentinel',
    );
  } finally {
    fetch.mockRestore();
    clone.mockRestore();
  }
}, 30_000);

test('the orb worker home is the passwd home of the user it runs as, not a fixed image path', () => {
  expect(orbAgentHome()).toBe(userInfo().homedir);
});

test('orb worker workspaces live under that home', () => {
  expect(orbWorkspacesRoot()).toBe(`${orbAgentHome()}/work`);
  expect(orbWorkspacesRoot()).not.toBe('/work');
});
