// 环境生命周期钩子执行原语（#1149）：.agents/setup 与 .agents/resume 的进程
// 执行面（直接 exec 文件——+x 必需、shebang 生效；detached 进程组、stdin
// ignore、输出到达序合并、超时 SIGKILL 杀组）。策略层（fresh→setup 抛错、
// reused→resume warn、失败回滚 worktree）在 workspace.ts 挂点，见
// workspace.test.ts。
// 失败方式先固化（issue #1149 失败方式 1–4）：
//   1. 缺失 = 跳过（null，零进程零日志）——「无钩子仓与现状逐字节一致」的根基
//   2. exit 0 = ok note，stdout/stderr 到达序合并
//   3. exit 非 0 = 抛 WorkspaceHookError（exit code + stderr 尾）
//   4. 超时 = 杀整组进程（含挂起的孙进程），抛 timeout 形错误
//   5. 非可执行 / 非普通文件 = 清晰错误（fail-loud，不静默跳过）
//   6. 输出上限：超限截断（内存闸）
//   7. 凭据 env：credentials 非空 → 步级 GIT_CONFIG_* 凭据注入进钩子 env
//      （消费步级下发凭据，不新开口子）；null → 无注入

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitCredentials } from '@pacman/shared';
import { describe, expect, test } from 'vitest';
import {
  HOOK_OUTPUT_CHAR_LIMIT,
  runWorkspaceHook,
  WorkspaceHookError,
} from '../src/workspace-hooks.js';

const CREDS: GitCredentials = { username: 'x-access-token', password: 'step-token-secret' };

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'pacman-hook-'));
}

/** 在 dir 下写可执行钩子脚本（.agents/<name>），返回脚本绝对路径。 */
function writeHook(dir: string, name: string, body: string, opts: { exec?: boolean } = {}): string {
  const agentsDir = join(dir, '.agents');
  mkdirSync(agentsDir, { recursive: true });
  const path = join(agentsDir, name);
  writeFileSync(path, body);
  if (opts.exec !== false) chmodSync(path, 0o755);
  return path;
}

function writeHookNonExec(dir: string, name: string, body: string): string {
  return writeHook(dir, name, body, { exec: false });
}

/** 等待 pid 死透（SIGKILL 后到 launchd reaping 有小延迟）。 */
async function assertDead(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      await new Promise((r) => setTimeout(r, 50));
    } catch {
      return; // ESRCH = 死透
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`pid ${pid} still alive after group kill`);
}

describe('workspace hook 原语（#1149）', () => {
  test('失败方式 1：钩子文件缺失 → null（静默跳过，零进程零日志）', async () => {
    const root = tmpRoot();
    const log: string[] = [];
    const note = await runWorkspaceHook({
      cwd: root,
      name: 'setup',
      credentials: null,
      timeoutMs: 10_000,
      log: (l) => log.push(l),
    });
    expect(note).toBeNull();
    expect(log).toEqual([]);
  });

  test('失败方式 2：exit 0 → ok note，stdout 捕获', async () => {
    const root = tmpRoot();
    writeHook(root, 'setup', '#!/bin/sh\necho hello-setup-marker\n');
    const log: string[] = [];
    const note = await runWorkspaceHook({
      cwd: root,
      name: 'setup',
      credentials: null,
      timeoutMs: 30_000,
      log: (l) => log.push(l),
    });
    expect(note).not.toBeNull();
    expect(note!.name).toBe('setup');
    expect(note!.status).toBe('ok');
    expect(note!.exitCode).toBe(0);
    expect(note!.output).toContain('hello-setup-marker');
    // 步日志面：start + 结局行（stdout 不进原语日志——投影面在 runner）。
    expect(log.some((l) => l.startsWith('setup hook: running'))).toBe(true);
    expect(log.some((l) => l.includes('ok (') && l.startsWith('setup hook:'))).toBe(true);
  });

  test('失败方式 3：exit 1 → 抛 WorkspaceHookError，message 带 exit code 与 stderr 尾', async () => {
    const root = tmpRoot();
    writeHook(root, 'setup', '#!/bin/sh\necho some-stdout\necho boom-setup-stderr >&2\nexit 1\n');
    const err = (await runWorkspaceHook({
      cwd: root,
      name: 'setup',
      credentials: null,
      timeoutMs: 30_000,
      log: () => {},
    }).catch((e: unknown) => e)) as WorkspaceHookError;
    expect(err).toBeInstanceOf(WorkspaceHookError);
    expect(err!.message).toContain('.agents/setup');
    expect(err!.message).toContain('exited 1');
    expect(err!.message).toContain('boom-setup-stderr');
    expect(err!.note.status).toBe('failed');
    expect(err!.note.exitCode).toBe(1);
    expect(err!.note.output).toContain('boom-setup-stderr');
  });

  test('失败方式 4：超时 → 杀整组进程（挂起孙进程全灭）+ timeout 形错误', async () => {
    const root = tmpRoot();
    const pidFile = join(root, 'grandchild-pid.txt');
    // 钩子主进程保持存活（wait），后台孙进程挂起——超时整组 SIGKILL。
    writeHook(root, 'setup', `#!/bin/sh\nsleep 5 &\necho $! > ${pidFile}\nwait\n`);
    const started = Date.now();
    const err = (await runWorkspaceHook({
      cwd: root,
      name: 'setup',
      credentials: null,
      timeoutMs: 200,
      log: () => {},
    }).catch((e: unknown) => e)) as WorkspaceHookError;
    expect(err).toBeInstanceOf(WorkspaceHookError);
    expect(err!.message).toContain('timed out');
    expect(Date.now() - started).toBeLessThan(3_000); // 快杀，不等到 5s sleep 自然死
    const grandchild = Number(readFileSync(pidFile, 'utf8').trim());
    expect(grandchild).toBeGreaterThan(0);
    await assertDead(grandchild);
  }, 15_000);

  test('失败方式 5：非可执行文件 → 清晰错误（不静默跳过）', async () => {
    const root = tmpRoot();
    writeHookNonExec(root, 'setup', '#!/bin/sh\necho nope\n');
    const err = (await runWorkspaceHook({
      cwd: root,
      name: 'setup',
      credentials: null,
      timeoutMs: 10_000,
      log: () => {},
    }).catch((e: unknown) => e)) as WorkspaceHookError;
    expect(err).toBeInstanceOf(WorkspaceHookError);
    expect(err!.message).toContain('not executable');
    expect(err!.message).toContain('chmod +x');
  });

  test('失败方式 5b：.agents/setup 是目录 → 清晰错误', async () => {
    const root = tmpRoot();
    mkdirSync(join(root, '.agents', 'setup'), { recursive: true });
    const err = (await runWorkspaceHook({
      cwd: root,
      name: 'setup',
      credentials: null,
      timeoutMs: 10_000,
      log: () => {},
    }).catch((e: unknown) => e)) as WorkspaceHookError;
    expect(err).toBeInstanceOf(WorkspaceHookError);
    expect(err!.message).toContain('not a regular file');
  });

  test('失败方式 6：输出超限截断（内存闸）', async () => {
    const root = tmpRoot();
    // 200KB stdout → 捕获 buffer 封顶 HOOK_OUTPUT_CHAR_LIMIT（默认 100k）。
    writeHook(root, 'setup', '#!/bin/sh\nhead -c 200000 /dev/zero | tr "\\0" "A"\n');
    const note = await runWorkspaceHook({
      cwd: root,
      name: 'setup',
      credentials: null,
      timeoutMs: 30_000,
      log: () => {},
    });
    expect(note).not.toBeNull();
    expect(note!.output.length).toBeLessThanOrEqual(HOOK_OUTPUT_CHAR_LIMIT);
    expect(note!.output.length).toBeGreaterThan(HOOK_OUTPUT_CHAR_LIMIT - 100);
    expect(note!.output).not.toContain('truncated'); // 原语不贴标记，截断面由消费层呈现
  }, 30_000);

  test('失败方式 7：credentials 非空 → GIT_CONFIG_* 进钩子 env；null → 无注入', async () => {
    const root = tmpRoot();
    writeHook(root, 'setup', '#!/bin/sh\necho "cred=${GIT_CONFIG_COUNT:-unset}"\n');
    const withCreds = await runWorkspaceHook({
      cwd: root,
      name: 'setup',
      credentials: CREDS,
      timeoutMs: 30_000,
      log: () => {},
    });
    expect(withCreds!.output).toContain('cred=2');
    // 换脚本重跑（同一 cwd，凭证 null → env 无 GIT_CONFIG 注入）。
    writeHook(root, 'setup', '#!/bin/sh\necho "cred=${GIT_CONFIG_COUNT:-unset}"\n');
    const without = await runWorkspaceHook({
      cwd: root,
      name: 'setup',
      credentials: null,
      timeoutMs: 30_000,
      log: () => {},
    });
    expect(without!.output).toContain('cred=unset');
  });

  test('resume 名字同样可跑（原语与名字无关）', async () => {
    const root = tmpRoot();
    writeHook(root, 'resume', '#!/bin/sh\necho resume-ran\n');
    const note = await runWorkspaceHook({
      cwd: root,
      name: 'resume',
      credentials: null,
      timeoutMs: 30_000,
      log: () => {},
    });
    expect(note!.name).toBe('resume');
    expect(note!.output).toContain('resume-ran');
  });
});
