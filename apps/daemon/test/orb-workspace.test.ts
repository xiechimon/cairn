import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { gitPrim } from '../src/git.js';
import { createDaemonLogger } from '../src/log.js';
import { ORB_AGENT_HOME, ORB_WORKSPACES_ROOT } from '../src/orb/worker.js';
import { WorkspaceManager } from '../src/workspace.js';

test('seeds a private base clone, fetches with the step credential and leaves the seed untouched', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orb-seed-'));
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
    'commit',
    '-m',
    'First',
  ]);
  cpSync(truth, seed, { recursive: true });
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

test('orb worker workspaces live under the agent home the image creates', () => {
  expect(ORB_WORKSPACES_ROOT.startsWith(`${ORB_AGENT_HOME}/`)).toBe(true);
  expect(ORB_WORKSPACES_ROOT).not.toBe('/work');
});
