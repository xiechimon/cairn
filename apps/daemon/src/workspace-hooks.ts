// 环境生命周期钩子执行原语（#1149）：.agents/setup 与 .agents/resume 两个
// 可执行文件驱动环境生命周期，形态照 Amp（docs/research/amp-native-sandbox-orb.md
// §3.2）—— 同路径同名 = 一份配置 Amp 与 pacman 两用。本模块 = 进程执行面：
// 直接 exec 文件（+x 必需、shebang 生效）、detached 自建进程组、stdin ignore、
// stdout/stderr 到达序合并收集、超时 SIGKILL 杀整组（后台挂起的孙进程全灭）。
// 策略层（fresh→setup 失败=步失败、reused→resume 失败=warning、worktree 回滚）
// 在 workspace.ts 挂点；runner 只把 note 投影进 transcript。
// 凭据面：钩子消费步级下发凭据（02 §5.4/§8 per-step token → GIT_CONFIG_*
// credential.helper env 注入，gitPrim 同族纪律——不新开口子）。

import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { GitCredentials } from '@pacman/shared';
import { gitCredentialEnv } from './git.js';

/** 输出内存闸（字符）：stdout+stderr 按到达序合并，超出即停收（shell-channel
 * 同律，值对齐 SHELL_OUTPUT_CHAR_LIMIT）。 */
export const HOOK_OUTPUT_CHAR_LIMIT = 100_000;

/** 钩子执行结局 note（workspace → runner 投影面）。 */
export interface WorkspaceHookNote {
  name: 'setup' | 'resume';
  /** ok = exit 0；failed = exit 非 0；timeout = 超时杀组。 */
  status: 'ok' | 'failed' | 'timeout';
  exitCode: number | null;
  /** 合并输出（截断后）。 */
  output: string;
  /** 真实输出字符总数（截断判据，消费层贴 truncated 标记）。 */
  totalChars: number;
  /** 耗时 ms。 */
  ms: number;
}

/** 钩子失败（exit 非 0 / 超时 / 不可执行）：note 随身，消费层组错误文案。 */
export class WorkspaceHookError extends Error {
  readonly note: WorkspaceHookNote;
  constructor(note: WorkspaceHookNote, message: string) {
    super(message);
    this.name = 'WorkspaceHookError';
    this.note = note;
  }
}

export interface RunWorkspaceHookInput {
  /** 任务 worktree 根（钩子文件按 `<cwd>/.agents/<name>` 解析）。 */
  cwd: string;
  name: 'setup' | 'resume';
  /** 步级 git 凭证（非空 → GIT_CONFIG_* env 注入；null → 无注入）。 */
  credentials: GitCredentials | null;
  timeoutMs: number;
  /** 日志行出口（workspace 前缀面；缺失即跳过 = 零行）。 */
  log: (line: string) => void;
}

/**
 * 执行 `<cwd>/.agents/<name>`（存在才跑；缺失 = null，零进程零日志——
 * 「无钩子的仓行为与现状一致」的根基）。结局：
 * - exit 0 → ok note
 * - exit 非 0 → WorkspaceHookError（exit code + stderr 尾）
 * - 超时 → SIGKILL 杀进程组 → timeout 形 WorkspaceHookError
 * - 文件存在但非可执行 / 非普通文件 → fail-loud（不静默跳过）
 */
export async function runWorkspaceHook(
  input: RunWorkspaceHookInput,
): Promise<WorkspaceHookNote | null> {
  const { cwd, name, credentials, timeoutMs, log } = input;
  const path = join(cwd, '.agents', name);
  if (!existsSync(path)) return null;
  const st = statSync(path);
  if (!st.isFile()) {
    throw new WorkspaceHookError(
      hookNote(name, 'failed', null, '', 0, 0),
      `workspace hook .agents/${name} is not a regular file — fix or remove it`,
    );
  }
  if (!(st.mode & 0o111)) {
    throw new WorkspaceHookError(
      hookNote(name, 'failed', null, '', 0, 0),
      `workspace hook .agents/${name} is not executable — run chmod +x .agents/${name}`,
    );
  }
  log(`${name} hook: running`);
  const env: NodeJS.ProcessEnv =
    credentials !== null
      ? { ...process.env, ...gitCredentialEnv(credentials) }
      : { ...process.env };
  const startedAt = Date.now();
  let kept = '';
  let total = 0;
  const collect = (buf: Buffer): void => {
    const s = buf.toString('utf8');
    total += s.length;
    if (kept.length < HOOK_OUTPUT_CHAR_LIMIT) {
      kept += s.slice(0, HOOK_OUTPUT_CHAR_LIMIT - kept.length);
    }
  };
  let timedOut = false;
  let spawnError: Error | null = null;
  let settled = false;
  const child = spawn(path, [], {
    cwd,
    // 自建进程组：超时 kill(-pid) 覆盖 `cmd &` 后台子孙（POSIX 语义，
    // shell-channel / supervisor detached 先例同族）。
    detached: true,
    // stdin 关死：等输入的钩子立即失败而不是挂满超时。
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
    } catch {
      // ESRCH：进程组已自然退出（超时与收尾竞态）——close 按 code null 判定。
    }
  }, timeoutMs);
  const note = await new Promise<WorkspaceHookNote>((resolve) => {
    child.on('error', (err: Error) => {
      spawnError = err;
      // spawn 失败后 node 仍发 'close'；此处兜底防 close 缺席挂死 promise。
      finish(null);
    });
    child.on('close', (code: number | null) => finish(code));
    function finish(code: number | null): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const ms = Date.now() - startedAt;
      if (spawnError !== null) {
        log(`${name} hook: spawn failed (${spawnError.message})`);
        resolve(hookNote(name, 'failed', null, kept, total, ms));
        return;
      }
      if (timedOut && code === null) {
        resolve(hookNote(name, 'timeout', null, kept, total, ms));
        return;
      }
      resolve(hookNote(name, code === 0 ? 'ok' : 'failed', code, kept, total, ms));
    }
  });
  if (note.status === 'ok') {
    log(`${name} hook: ok (${note.ms}ms)`);
    return note;
  }
  // 失败即抛（策略层接住：setup = 步失败上浮、resume = 降级 warning）。
  throw new WorkspaceHookError(note, workspaceHookErrorMessage(note));
}

function hookNote(
  name: 'setup' | 'resume',
  status: WorkspaceHookNote['status'],
  exitCode: number | null,
  output: string,
  totalChars: number,
  ms: number,
): WorkspaceHookNote {
  return { name, status, exitCode, output, totalChars, ms };
}

/** WorkspaceHookError 的 message 组装（policy 层共用词形）。 */
export function workspaceHookErrorMessage(note: WorkspaceHookNote): string {
  const tail = tailOf(note.output);
  if (note.status === 'timeout') {
    return `workspace hook .agents/${note.name} timed out after ${Math.round(note.ms / 1000)}s and its process group was killed${tail !== '' ? ` — last output: ${tail}` : ''}`;
  }
  return `workspace hook .agents/${note.name} exited ${note.exitCode}${tail !== '' ? ` — ${tail}` : ''}`;
}

function tailOf(output: string): string {
  const trimmed = output.trim();
  if (trimmed === '') return '';
  const lines = trimmed.split('\n');
  return lines.slice(-5).join('\n').slice(-500);
}
