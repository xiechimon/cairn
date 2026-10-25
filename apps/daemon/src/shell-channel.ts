import { spawn } from 'node:child_process';
import {
  LOCAL_TOOL_REMOTE_SHELL,
  type LocalToolDef,
  type MachineShellPrecheckResponse,
  type MachineShellResultBody,
  SHELL_COMMAND_CHAR_LIMIT,
  SHELL_OUTPUT_CHAR_LIMIT,
} from '@cairn/shared';
import { MachineApiError } from './machine-client.js';

export const REMOTE_SHELL_TIMEOUT_MS = 120_000;

export interface ShellWire {
  shellPrecheck(stepId: string, command: string): Promise<MachineShellPrecheckResponse>;
  shellResult(runId: string, body: MachineShellResultBody): Promise<void>;
}

export interface RemoteShellOpts {
  wire: ShellWire;
  stepId: string;
  cwd: string;
  timeoutMs?: number;
  onAudit?: (line: string) => void;
}

type ExecOutcome =
  | { kind: 'done'; code: number | null; output: string; total: number; ms: number }
  | { kind: 'timeout'; output: string; total: number; ms: number }
  | { kind: 'spawn-error'; message: string };

function execCommand(command: string, cwd: string, timeoutMs: number): Promise<ExecOutcome> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let kept = '';
    let total = 0;
    const collect = (buf: Buffer) => {
      const s = buf.toString('utf8');
      total += s.length;
      if (kept.length < SHELL_OUTPUT_CHAR_LIMIT) {
        kept += s.slice(0, SHELL_OUTPUT_CHAR_LIMIT - kept.length);
      }
    };
    let timedOut = false;
    let spawnError: Error | null = null;
    let settled = false;
    const child = spawn('bash', ['-lc', command], {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
      } catch {}
    }, timeoutMs);
    child.on('error', (err: Error) => {
      spawnError = err;
      finish(null);
    });
    child.on('close', (code: number | null) => finish(code));
    function finish(code: number | null): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const ms = Date.now() - startedAt;
      if (spawnError) {
        resolve({ kind: 'spawn-error', message: spawnError.message });
      } else if (timedOut && code === null) {
        resolve({ kind: 'timeout', output: kept, total, ms });
      } else {
        resolve({ kind: 'done', code, output: kept, total, ms });
      }
    }
  });
}

function truncateOutput(kept: string, total: number): string {
  if (total <= SHELL_OUTPUT_CHAR_LIMIT) return kept;
  const marker = `\n[输出截断：共 ${total} 字符，仅保留前段]`;
  return `${kept.slice(0, SHELL_OUTPUT_CHAR_LIMIT - marker.length)}${marker}`;
}

function commandClip(command: string): string {
  const firstLine = command.split('\n', 1)[0] ?? '';
  return firstLine.length > 160 ? `${firstLine.slice(0, 160)}…` : firstLine;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function buildRemoteShellTool(opts: RemoteShellOpts): LocalToolDef {
  const timeoutMs = opts.timeoutMs ?? REMOTE_SHELL_TIMEOUT_MS;
  const audit = (line: string) => opts.onAudit?.(line);
  return {
    name: LOCAL_TOOL_REMOTE_SHELL,
    label: LOCAL_TOOL_REMOTE_SHELL,
    description:
      'Execute one shell command on this team machine (bash -lc) in the session working ' +
      'directory. Every call is authorized per-command by the server (agent tool switch ∩ ' +
      'machine shell access) and recorded in the team audit log before it runs; a denied or ' +
      'unreachable precheck returns an explicit reason and the command never executes. ' +
      `Killed process-group-wide after ${timeoutMs}ms; output is combined stdout+stderr, ` +
      `truncated at ${SHELL_OUTPUT_CHAR_LIMIT} chars with a marker. A non-zero exit code is ` +
      'appended as [exit N].',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell command to execute, e.g. "pnpm test -- run".',
        },
      },
      required: ['command'],
    },
    execute: async (params: Record<string, unknown>): Promise<string> => {
      const command = typeof params.command === 'string' ? params.command : '';
      if (command.trim() === '') return 'remote_shell 需要非空 "command" 参数。';
      if (command.length > SHELL_COMMAND_CHAR_LIMIT) {
        return `预检失败：命令长度 ${command.length} 超过上限 ${SHELL_COMMAND_CHAR_LIMIT} 字符。`;
      }

      let runId: string;
      try {
        ({ runId } = await opts.wire.shellPrecheck(opts.stepId, command));
      } catch (err) {
        if (err instanceof MachineApiError && err.status === 403) {
          audit(`shell denied step=${opts.stepId}: ${err.body}`);
          return `未授权：${err.body}`;
        }
        const msg = errText(err);
        audit(`shell precheck failed step=${opts.stepId}: ${msg}`);
        return `预检失败：${msg}`;
      }
      audit(`shell allowed step=${opts.stepId} run=${runId} cmd=${commandClip(command)}`);

      const r = await execCommand(command, opts.cwd, timeoutMs);
      let body: MachineShellResultBody;
      let resultText: string;
      if (r.kind === 'spawn-error') {
        body = { status: 'failed', errorMessage: r.message.slice(0, 2_000) };
        resultText = `执行失败：${r.message}`;
        audit(`shell spawn failed step=${opts.stepId} run=${runId}: ${r.message}`);
      } else if (r.kind === 'timeout') {
        const partial = truncateOutput(r.output, r.total);
        body = {
          status: 'failed',
          ...(partial !== '' ? { output: partial } : {}),
          errorMessage: `命令超时（${timeoutMs}ms），已杀整个进程组`,
        };
        resultText =
          `命令超时（${timeoutMs}ms）：已杀整个进程组。` +
          (partial !== '' ? `\n部分输出：\n${partial}` : '');
        audit(
          `shell timeout step=${opts.stepId} run=${runId} after ${timeoutMs}ms (process group killed)`,
        );
      } else {
        const output = truncateOutput(r.output, r.total);
        body = {
          status: 'done',
          ...(r.code !== null ? { exitCode: r.code } : {}),
          ...(output !== '' ? { output } : {}),
        };
        resultText =
          r.code !== null && r.code !== 0
            ? `${output.endsWith('\n') || output === '' ? output : `${output}\n`}[exit ${r.code}]`
            : output;
        audit(
          `shell done step=${opts.stepId} run=${runId} exit=${r.code ?? 'null'} chars=${r.total} ms=${r.ms}`,
        );
      }

      try {
        await opts.wire.shellResult(runId, body);
      } catch (err) {
        const msg = errText(err);
        audit(`shell writeback failed step=${opts.stepId} run=${runId}: ${msg}`);
        resultText += `\n[审计回写失败：${msg}——命令已执行，以上为真实结果]`;
      }
      return resultText;
    },
  };
}
