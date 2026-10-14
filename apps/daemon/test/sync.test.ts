// sync 执行层 checkout 步回归（#1329）。git 2.43 不认 `checkout --end-of-options`
// （当 pathspec 吞掉，退出 1）；旧实现 runGit 不看退出码，checkout 失败后 reset --hard
// 仍照常执行，performSync 回写 synced，且会移动当前检出的分支。
// 用例走 performSync 公开入口 + 真 git 仓库。2.43 上 reset --hard 本身的失败由
// #1316 / PR #1330 覆盖，本文件只断言 checkout 步的结果（HEAD 与本地 main）。

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MachineSyncCommand, MachineSyncResultBody } from '@pacman/shared';
import { describe, expect, test, vi } from 'vitest';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { performSync } from '../src/sync.js';

const GIT_ENV = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
};

function git(cwd: string, args: string[]): string {
  const res = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...GIT_ENV },
  });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`);
  return res.stdout.trim();
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

function syncCommand(f: Fixture, ref: string, commit: string): MachineSyncCommand {
  return {
    syncId: 'sync-1',
    buildId: 'build-1',
    projectId: 'project-1',
    cloneUrl: '',
    directory: f.work,
    ref,
    commit,
    force: false,
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
  test('ref 不存在：回写 failed 并点名 ref，当前分支保持原位', async () => {
    const f = makeFixture();
    const { client, results } = recordingClient();

    await performSync({ client, logger: silentLogger() }, syncCommand(f, 'nosuch', f.b));

    const last = results.at(-1);
    expect(last?.status).toBe('failed');
    expect(last?.errorMessage).toContain('nosuch');
    expect(git(f.work, ['rev-parse', 'refs/heads/main'])).toBe(f.a);
  });

  test('远端分支存在：HEAD 落到目标 commit，本地 main 不被移动', async () => {
    const f = makeFixture();
    const { client } = recordingClient();

    await performSync({ client, logger: silentLogger() }, syncCommand(f, 'feat', f.b));

    expect(git(f.work, ['rev-parse', 'HEAD'])).toBe(f.b);
    expect(git(f.work, ['rev-parse', 'refs/heads/main'])).toBe(f.a);
  });

  test('工作区有与目标冲突的未提交改动：checkout 仍落到 origin/<ref>', async () => {
    const f = makeFixture();
    writeFileSync(join(f.work, 'README.md'), 'dirty\n');
    const { client } = recordingClient();

    await performSync({ client, logger: silentLogger() }, syncCommand(f, 'feat', f.b));

    expect(git(f.work, ['rev-parse', 'HEAD'])).toBe(f.b);
    expect(git(f.work, ['rev-parse', 'refs/heads/main'])).toBe(f.a);
  });
});
