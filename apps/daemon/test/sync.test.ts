import * as childProcess from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

import { join } from 'node:path';
import type { MachineSyncCommand, MachineSyncResultBody } from '@cairn/shared';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { performSync } from '../src/sync.js';

vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof childProcess>();
  return { ...real, spawn: vi.fn(real.spawn) };
});

const GIT_ENV = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
};

function git(cwd: string, args: string[]): string {
  const res = childProcess.spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...GIT_ENV },
  });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`);
  return res.stdout.trim();
}

function daemonGitArgv(): string[][] {
  return vi.mocked(childProcess.spawn).mock.calls.map(([, args]) => [...args]);
}

interface Fixture {
  work: string;
  a: string;
  b: string;
}

function makeFixture(): Fixture {
  const root = makeTestTempDir('cairn-sync-');
  const origin = join(root, 'origin.git');
  const seed = join(root, 'seed');
  const work = join(root, 'work');
  git(root, ['init', '-q', '--bare', '-b', 'main', origin]);
  git(root, ['init', '-q', '-b', 'main', seed]);
  writeFileSync(join(seed, 'README.md'), 'base\n');
  git(seed, ['add', 'README.md']);
  git(seed, ['commit', '-qm', 'A']);
  const a = git(seed, ['rev-parse', 'HEAD']);
  git(seed, ['checkout', '-q', '-b', 'feat']);
  writeFileSync(join(seed, 'README.md'), 'feat\n');
  writeFileSync(join(seed, 'feature.txt'), 'x\n');
  git(seed, ['add', '-A']);
  git(seed, ['commit', '-qm', 'B']);
  const b = git(seed, ['rev-parse', 'HEAD']);
  git(seed, ['push', '-q', origin, 'main', 'feat']);
  git(root, ['clone', '-q', origin, work]);
  git(work, ['checkout', '-q', 'main']);
  return { work, a, b };
}

function syncCommand(f: Fixture, ref: string, commit: string, force = false): MachineSyncCommand {
  return {
    syncId: 'sync-1',
    buildId: 'build-1',
    projectId: 'project-1',
    cloneUrl: '',
    directory: f.work,
    ref,
    commit,
    force,
  };
}

function recordingClient() {
  const results: MachineSyncResultBody[] = [];
  const syncResult = vi.fn(async (_syncId: string, body: MachineSyncResultBody) => {
    results.push(body);
  });
  return { client: { syncResult } as unknown as MachineApi, results };
}

function silentLogger(): DaemonLogger {
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
    skills: noop,
    gate: noop,
    trust: noop,
    mcp: noop,
  };
}

describe('performSync — the checkout step does not swallow failures (#1329)', () => {
  beforeEach(() => {
    vi.mocked(childProcess.spawn).mockClear();
  });

  test('ref missing: failed written back naming the ref, current branch stays put', async () => {
    const f = makeFixture();
    const { client, results } = recordingClient();

    await performSync({ client, logger: silentLogger() }, syncCommand(f, 'nosuch', f.b));

    const last = results.at(-1);
    expect(last?.status).toBe('failed');
    expect(last?.errorMessage).toContain('nosuch');
    expect(git(f.work, ['rev-parse', 'refs/heads/main'])).toBe(f.a);
  });

  test('remote branch exists: HEAD lands detached on the target commit, local main not moved (contract: do not advance a same-named local branch)', async () => {
    const f = makeFixture();
    const { client } = recordingClient();

    await performSync({ client, logger: silentLogger() }, syncCommand(f, 'feat', f.b));

    expect(git(f.work, ['rev-parse', 'HEAD'])).toBe(f.b);
    expect(
      childProcess.spawnSync('git', ['symbolic-ref', '-q', 'HEAD'], { cwd: f.work }).status,
    ).toBe(1);
    expect(git(f.work, ['rev-parse', 'refs/heads/main'])).toBe(f.a);
  });

  test('non-force: checkout refuses to overwrite conflicting uncommitted worktree changes, file contents preserved', async () => {
    const f = makeFixture();
    writeFileSync(join(f.work, 'README.md'), 'dirty\n');
    const { client, results } = recordingClient();

    await performSync({ client, logger: silentLogger() }, syncCommand(f, 'feat', f.b));

    expect(results.at(-1)?.status).toBe('failed');
    expect(results.at(-1)?.errorMessage).toContain('README.md');
    expect(readFileSync(join(f.work, 'README.md'), 'utf8')).toBe('dirty\n');
    expect(git(f.work, ['rev-parse', 'HEAD'])).toBe(f.a);
  });

  test('force: conflicting worktree changes discarded by checkout, HEAD lands on origin/<ref>', async () => {
    const f = makeFixture();
    writeFileSync(join(f.work, 'README.md'), 'dirty\n');
    const { client } = recordingClient();

    await performSync({ client, logger: silentLogger() }, syncCommand(f, 'feat', f.b, true));

    expect(readFileSync(join(f.work, 'README.md'), 'utf8')).toBe('feat\n');
    expect(git(f.work, ['rev-parse', 'HEAD'])).toBe(f.b);
  });

  test('remote-branch checkout argv is exactly the fully-qualified ref + `--`: no --force when non-force, and no --end-of-options', async () => {
    const f = makeFixture();
    const { client } = recordingClient();

    await performSync({ client, logger: silentLogger() }, syncCommand(f, 'feat', f.b));

    expect(daemonGitArgv()).toContainEqual(['checkout', 'refs/remotes/origin/feat', '--']);
  });

  test('remote-branch checkout argv is exactly --force + fully-qualified ref + `--` (when forced)', async () => {
    const f = makeFixture();
    const { client } = recordingClient();

    await performSync({ client, logger: silentLogger() }, syncCommand(f, 'feat', f.b, true));

    expect(daemonGitArgv()).toContainEqual([
      'checkout',
      '--force',
      'refs/remotes/origin/feat',
      '--',
    ]);
  });

  test('tag: resolved to a commit when no same-named branch exists, checked out detached by oid', async () => {
    const f = makeFixture();
    git(f.work, ['tag', 'v1', f.b]);
    const { client } = recordingClient();

    await performSync({ client, logger: silentLogger() }, syncCommand(f, 'v1', f.b));

    expect(daemonGitArgv()).toContainEqual(['checkout', f.b, '--']);
    expect(git(f.work, ['rev-parse', 'HEAD'])).toBe(f.b);
    expect(git(f.work, ['rev-parse', 'refs/heads/main'])).toBe(f.a);
  });

  test('SHA: resolved to a commit when no same-named branch exists, checked out detached by oid', async () => {
    const f = makeFixture();
    const { client } = recordingClient();

    await performSync({ client, logger: silentLogger() }, syncCommand(f, f.b, f.b));

    expect(daemonGitArgv()).toContainEqual(['checkout', f.b, '--']);
    expect(git(f.work, ['rev-parse', 'HEAD'])).toBe(f.b);
    expect(git(f.work, ['rev-parse', 'refs/heads/main'])).toBe(f.a);
  });
});
