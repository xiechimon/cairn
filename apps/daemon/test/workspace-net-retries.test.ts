import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { commitEnv, gitPrim, runGitOk } from '../src/git.js';
import { createDaemonLogger } from '../src/log.js';
import { WorkspaceManager } from '../src/workspace.js';

let root: string;
let origin: string;
let logFile: string;
let workspace: WorkspaceManager;

beforeEach(async () => {
  root = makeTestTempDir('workspace-retries-');
  origin = join(root, 'origin');
  logFile = join(root, 'daemon.log');
  await runGitOk(['init', '--initial-branch=main', origin]);
  writeFileSync(join(origin, 'README.md'), '# retry fixture\n');
  await runGitOk(['add', 'README.md'], { cwd: origin });
  await runGitOk(['commit', '-m', 'seed'], {
    cwd: origin,
    env: commitEnv({ name: 'Fixture', email: 'fixture@example.test' }),
  });
  workspace = new WorkspaceManager({ logger: createDaemonLogger({ logFile }) });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  releaseTestTempDir(root);
});

function input() {
  return {
    projectId: 'project',
    conversationId: '01a0b86f-04f9-72a8-bba4-75c5cfd6598f',
    cloneUrl: origin,
    workspacesRoot: join(root, 'workspaces'),
    credentials: null,
    readonly: true,
  };
}

test('a transient clone logs its retry before the next attempt without the error payload', async () => {
  const realClone = gitPrim.clone;
  const clone = vi.spyOn(gitPrim, 'clone');
  let logAtRetry = '';
  clone.mockRejectedValueOnce(
    new Error('connection reset for https://fixture-user:fixture-secret@example.test/repo'),
  );
  clone.mockImplementation(async (...args) => {
    logAtRetry = readFileSync(logFile, 'utf8');
    await realClone(...args);
  });

  const prepared = await workspace.prepare(input());

  expect(readFileSync(join(prepared.cwd, 'README.md'), 'utf8')).toBe('# retry fixture\n');
  expect(clone).toHaveBeenCalledTimes(2);
  expect(logAtRetry).toContain('git clone network retry 1/4 after 2000ms');
  const log = readFileSync(logFile, 'utf8');
  expect(log.match(/network retry/g)).toHaveLength(1);
  expect(log).not.toContain('fixture-secret');
  expect(log).not.toContain('connection reset');
});

test('fetching an existing workspace reports the same network retry', async () => {
  await workspace.prepare(input());
  expect(readFileSync(logFile, 'utf8')).not.toContain('network retry');
  const realFetch = gitPrim.fetch;
  const fetch = vi.spyOn(gitPrim, 'fetch');
  fetch.mockRejectedValueOnce(new Error('connection reset'));
  fetch.mockImplementation(realFetch);

  await workspace.prepare(input());

  expect(fetch).toHaveBeenCalledTimes(2);
  expect(readFileSync(logFile, 'utf8')).toContain('git fetch network retry 1/4 after 2000ms');
});

test.each(['Authentication failed', 'repository not found'])(
  'a permanent failure (%s) does not announce a network retry',
  async (message) => {
    const clone = vi.spyOn(gitPrim, 'clone').mockRejectedValue(new Error(message));

    await expect(workspace.prepare(input())).rejects.toThrow(message);

    expect(clone).toHaveBeenCalledTimes(1);
    expect(readFileSync(logFile, 'utf8')).not.toContain('network retry');
  },
);

test('exhaustion logs exactly four retries with the actual backoff delays', async () => {
  vi.useFakeTimers();
  const clone = vi.spyOn(gitPrim, 'clone').mockRejectedValue(new Error('connection reset'));
  const rejected = expect(workspace.prepare(input())).rejects.toThrow('connection reset');

  await vi.runAllTimersAsync();
  await rejected;

  expect(clone).toHaveBeenCalledTimes(5);
  expect(
    readFileSync(logFile, 'utf8')
      .split('\n')
      .filter((line) => line.includes('network retry'))
      .map((line) => line.slice(line.indexOf('git clone'))),
  ).toEqual([
    'git clone network retry 1/4 after 2000ms',
    'git clone network retry 2/4 after 4000ms',
    'git clone network retry 3/4 after 8000ms',
    'git clone network retry 4/4 after 16000ms',
  ]);
});
