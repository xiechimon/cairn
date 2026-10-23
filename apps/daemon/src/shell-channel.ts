// per-step 远程 shell 执行通道（XMON-110 R2；02 §5.6 MACHINE_CUSTOM_TOOLS 的
// remote_shell 词表占位自此有执行体）。授权模型（XMON-108 R1）：注册面 =
// claim localTools（server 双闸 agent「远程 shell」∩ machine.shellEnabled 算
// 好下发，本模块无策略）；每条命令的真实闸 = server 预检端点（审计行先于
// 放行落库，步中关闸下一条即拒）。密钥通道同律：所有失败面都返回明确原因
// 文本（「未授权」「预检失败」「执行失败」「回写失败」），绝不静默成功。
//
// 执行纪律：命令以 daemon 用户权限全量执行、无沙箱（XMON-85 §一风险面，
// 边界 = 人授双开关 + 每调用预检 + 审计）。spawn 走 argv 数组（bash -lc 单
// 参数，命令文本不经本进程 shell 二次解析）；detached 自建进程组，超时
// SIGKILL 整组——后台子孙（`cmd &`）不逃逸，这是「超时命令被杀」的组级语义。
// 输出 stdout+stderr 按到达序合并收集，内存中只保留前 SHELL_OUTPUT_CHAR_LIMIT
// 字符（总量计数进截断标记），回写与返回文本共用同一截断面。

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

/** 单命令超时缺省值 [设计]（票面未定值：够构建类命令跑完、短于挂死命令
 * 占住步的容忍度；git NET_TIMEOUT_MS 同量级。opts.timeoutMs 可调，测试钉
 * 小值验证杀组语义）。 */
export const REMOTE_SHELL_TIMEOUT_MS = 120_000;

/** 执行面依赖的 wire 缝（MachineApi 的结构化子集；测试注 fake）。 */
export interface ShellWire {
  shellPrecheck(stepId: string, command: string): Promise<MachineShellPrecheckResponse>;
  shellResult(runId: string, body: MachineShellResultBody): Promise<void>;
}

export interface RemoteShellOpts {
  wire: ShellWire;
  stepId: string;
  /** 命令执行目录 = 本步会话 cwd（worktree 或裸任务目录）。 */
  cwd: string;
  /** 超时（ms）；缺省 REMOTE_SHELL_TIMEOUT_MS。 */
  timeoutMs?: number;
  /** daemon 侧审计行出口（runner 接 logger.step；测试录制）。server 侧
   * shell_command 表是审计正本，本行 = 执行机日志面的可观察副本。 */
  onAudit?: (line: string) => void;
}

/** 执行结局三态：done = 进程自然跑完（exitCode 任意值均合法）；timeout =
 * 超时杀组（exitCode 无意义）；spawn-error = 进程压根没起来（bash 不可执行 /
 * cwd 不存在等，child 'error' 事件）。 */
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
      // 内存闸：只保留前 LIMIT 字符（total 继续计数供截断标记），大输出命令
      // 打不爆 daemon 进程。
      if (kept.length < SHELL_OUTPUT_CHAR_LIMIT) {
        kept += s.slice(0, SHELL_OUTPUT_CHAR_LIMIT - kept.length);
      }
    };
    let timedOut = false;
    let spawnError: Error | null = null;
    let settled = false;
    const child = spawn('bash', ['-lc', command], {
      cwd,
      // 自建进程组：超时 kill(-pid) 才能覆盖 `cmd &` 后台子孙（POSIX 语义；
      // daemon 只跑 macOS/Linux，supervisor detached 先例同族）。
      detached: true,
      // stdin 关死：等输入的命令立即失败而不是挂满超时。
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
      } catch {
        // ESRCH：进程组已自然退出（超时与自然收尾竞态）——close 分支按
        // code 是否为 null 判真实结局。
      }
    }, timeoutMs);
    child.on('error', (err: Error) => {
      spawnError = err;
      // spawn 失败（ENOENT 等）node 随后仍发 'close'；此处兜底防流未建全时
      // close 缺席挂死 promise。
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

/** 截断（带标记）：total 超限才动刀，标记含总字符数；成品长度 ≤
 * SHELL_OUTPUT_CHAR_LIMIT（wire schema 面第二道闸恒过）。 */
function truncateOutput(kept: string, total: number): string {
  if (total <= SHELL_OUTPUT_CHAR_LIMIT) return kept;
  const marker = `\n[输出截断：共 ${total} 字符，仅保留前段]`;
  return `${kept.slice(0, SHELL_OUTPUT_CHAR_LIMIT - marker.length)}${marker}`;
}

/** 审计/日志行的命令摘要：首行 + 限长（完整命令在 server 审计行，本地日志
 * 只留可对上号的摘要）。 */
function commandClip(command: string): string {
  const firstLine = command.split('\n', 1)[0] ?? '';
  return firstLine.length > 160 ? `${firstLine.slice(0, 160)}…` : firstLine;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** remote_shell 本地工具定义（runner 按 claim localTools 决定是否注册：
 * 词缺席 = 双闸任一关，agent 工具面不出现该词——least-privilege，密钥通道
 * 按 kind 裁剪同律）。 */
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
      // 超长命令本地先判（R1 口径：server 400 = 异常形，按「预检失败」处理，
      // 不当「未授权」；本地判掉省一跳且不给审计表塞必拒行）。
      if (command.length > SHELL_COMMAND_CHAR_LIMIT) {
        return `预检失败：命令长度 ${command.length} 超过上限 ${SHELL_COMMAND_CHAR_LIMIT} 字符。`;
      }

      // —— 预检（每条命令的真实闸；审计行先于放行落库）——
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

      // —— 执行（进程组级超时）——
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

      // —— 回写（终态一次；失败 = 明确上报，绝不静默成功）——
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
