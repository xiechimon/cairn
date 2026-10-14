// sync 执行层 checkout 步回归（#1329）。git 2.43 不认 `checkout --end-of-options`
// （当 pathspec 吞掉，退出 1）；旧实现 runGit 不看退出码，checkout 失败后 reset --hard
// 仍照常执行，performSync 回写 synced，且会移动当前检出的分支。
// 用例走 performSync 公开入口 + 真 git 仓库。2.43 上 reset --hard 本身的失败由
// #1316 / PR #1330 覆盖，本文件只断言 checkout 步的结果（HEAD、本地 main、工作区文件）。
// argv 断言读 spawn 包装记下的实际参数：git 2.47 也接受 --end-of-options，只看行为
// 抓不住回退，必须比对传给 git 的 argv。

import * as childProcess from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MachineSyncCommand, MachineSyncResultBody } from '@pacman/shared';
import { beforeEach, describe, expect, test, vi } from 'vitest';
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

/** daemon 经 spawn 发出的 git argv（发出顺序；夹具的 spawnSync 不计入）。 */
function daemonGitArgv(): string[][] {
  return vi.mocked(childProcess.spawn).mock.calls.map(([, args]) => [...args]);
}

interface Fixture {
  work: string;
  a: string;
  b: string;
}

/** origin：main@A、feat@B。work 是克隆后停在 main@A 的工作副本（复用路径）。 */
function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'pacman-sync-'));
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

describe('performSync — checkout 步不吞失败（#1329）', () => {
  beforeEach(() => {
    vi.mocked(childProcess.spawn).mockClear();
  });

  test('ref 不存在：回写 failed 并点名 ref，当前分支保持原位', async () => {
    const f = makeFixture();
    const { client, results } = recordingClient();

    await performSync({ client, logger: silentLogger() }, syncCommand(f, 'nosuch', f.b));

    const last = results.at(-1);
    expect(last?.status).toBe('failed');
    expect(last?.errorMessage).toContain('nosuch');
    expect(git(f.work, ['rev-parse', 'refs/heads/main'])).toBe(f.a);
  });

  test('远端分支存在：HEAD 以 detached 落到目标 commit，本地 main 不被移动（契约：不推进同名本地分支）', async () => {
    const f = makeFixture();
    const { client } = recordingClient();

    await performSync({ client, logger: silentLogger() }, syncCommand(f, 'feat', f.b));

    expect(git(f.work, ['rev-parse', 'HEAD'])).toBe(f.b);
    expect(
      childProcess.spawnSync('git', ['symbolic-ref', '-q', 'HEAD'], { cwd: f.work }).status,
    ).toBe(1);
    expect(git(f.work, ['rev-parse', 'refs/heads/main'])).toBe(f.a);
  });

  test('非 force：工作区有与目标冲突的未提交改动时 checkout 拒绝覆盖，文件内容保留', async () => {
    const f = makeFixture();
    writeFileSync(join(f.work, 'README.md'), 'dirty\n');
    const { client, results } = recordingClient();

    await performSync({ client, logger: silentLogger() }, syncCommand(f, 'feat', f.b));

    expect(results.at(-1)?.status).toBe('failed');
    expect(results.at(-1)?.errorMessage).toContain('README.md');
    expect(readFileSync(join(f.work, 'README.md'), 'utf8')).toBe('dirty\n');
    expect(git(f.work, ['rev-parse', 'HEAD'])).toBe(f.a);
  });

  test('force：工作区冲突改动被 checkout 丢弃，HEAD 落到 origin/<ref>', async () => {
    const f = makeFixture();
    writeFileSync(join(f.work, 'README.md'), 'dirty\n');
    const { client } = recordingClient();

    await performSync({ client, logger: silentLogger() }, syncCommand(f, 'feat', f.b, true));

    expect(readFileSync(join(f.work, 'README.md'), 'utf8')).toBe('feat\n');
    expect(git(f.work, ['rev-parse', 'HEAD'])).toBe(f.b);
  });

  test('远端分支 checkout argv 精确为全限定 ref + `--`：非 force 不带 --force，且不含 --end-of-options', async () => {
    const f = makeFixture();
    const { client } = recordingClient();

    await performSync({ client, logger: silentLogger() }, syncCommand(f, 'feat', f.b));

    expect(daemonGitArgv()).toContainEqual(['checkout', 'refs/remotes/origin/feat', '--']);
  });

  test('远端分支 checkout argv 精确为 --force + 全限定 ref + `--`（force 时）', async () => {
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

  test('tag：无同名分支时解析为 commit，以 oid detached 检出', async () => {
    const f = makeFixture();
    git(f.work, ['tag', 'v1', f.b]);
    const { client } = recordingClient();

    await performSync({ client, logger: silentLogger() }, syncCommand(f, 'v1', f.b));

    expect(daemonGitArgv()).toContainEqual(['checkout', f.b, '--']);
    expect(git(f.work, ['rev-parse', 'HEAD'])).toBe(f.b);
    expect(git(f.work, ['rev-parse', 'refs/heads/main'])).toBe(f.a);
  });

  test('SHA：无同名分支时解析为 commit，以 oid detached 检出', async () => {
    const f = makeFixture();
    const { client } = recordingClient();

    await performSync({ client, logger: silentLogger() }, syncCommand(f, f.b, f.b));

    expect(daemonGitArgv()).toContainEqual(['checkout', f.b, '--']);
    expect(git(f.work, ['rev-parse', 'HEAD'])).toBe(f.b);
    expect(git(f.work, ['rev-parse', 'refs/heads/main'])).toBe(f.a);
  });
});
