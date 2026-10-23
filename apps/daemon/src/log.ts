// daemon.log 行形（01 §4.3：pino 自定义输出行形；日志形状 = 平价面，r3 实测
// 词表）。行前缀词表 = DAEMON_LOG_PREFIXES 十件（supervisor/machine/step/
// workspace/recover/wake/mcp/skills/gate/trust，02 §5.3 + r3 §1.5 [mcp] 实测行 M4b 补录
// + [skills] spec 14/#371 补录 + [gate] #866 T5 补录 + [trust] #925 D1 补录）；
// 上线序列/步骤生命周期 canon 行为无前缀
// 原文（r3 §1.5 实测样本族）。落盘行 = `<wall-clock> <msg>`（#691：时间戳位
// 改采——无痕死亡事故里落盘行无法与墙钟对齐，取证代价过高）；stdout/pane 面
// 保持 canon 无时间戳（r3 平价面不动）。

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DAEMON_LOG_PREFIXES } from '@cairn/shared';
import pino from 'pino';

export type DaemonLogPrefix = (typeof DAEMON_LOG_PREFIXES)[number];

export interface DaemonLogger {
  /** canon 原文行（无前缀）：`claim step=<id>`、`Online (…)` 族。 */
  raw(msg: string): void;
  /** 前缀行 `[prefix] msg`（02 §5.3 词表九件）。 */
  prefixed(prefix: DaemonLogPrefix, msg: string): void;
  supervisor(msg: string): void;
  machine(msg: string): void;
  step(msg: string): void;
  workspace(msg: string): void;
  recover(msg: string): void;
  wake(msg: string): void;
  /** MCP per-turn 连接面（r3 §1.5：`[mcp] <slug>: connect failed — …`）。 */
  mcp(msg: string): void;
  /** skills 执行面注入诊断（spec 14/#371：`[skills] <type>: <msg>` 族，
   * type ∈ loaded/collision/invalid-frontmatter/missing-skill-md/cap/invalid）。 */
  skills(msg: string): void;
  /** 命令闸裁决（#866 T5：`[gate] <ask|reject>: rule=<id> command=<…>`——只记
   * 非放行裁决，allow 静默）。 */
  gate(msg: string): void;
  /** pi project trust 裁决（#925 D1：`[trust] denied: <.pi/…> present in
   * worktree …`——只记受保护资源在位的 denied 行，空 worktree 静默）。 */
  trust(msg: string): void;
}

export function isLogPrefix(value: string): value is DaemonLogPrefix {
  return (DAEMON_LOG_PREFIXES as readonly string[]).includes(value);
}

interface LineFields {
  msg?: string;
  prefix?: string;
}

export function formatLine(fields: LineFields): string {
  const msg = fields.msg ?? '';
  if (fields.prefix && isLogPrefix(fields.prefix)) return `[${fields.prefix}] ${msg}`;
  return msg;
}

/** 落盘行 wall-clock 前缀（#691）：本地时区 `YYYY-MM-DD HH:mm:ss`，可排序可 grep。 */
function wallClock(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

export function createDaemonLogger(opts: {
  logFile?: string;
  stdout?: boolean;
  level?: string;
}): DaemonLogger {
  if (opts.logFile) mkdirSync(dirname(opts.logFile), { recursive: true });
  const sink = {
    write(line: string): void {
      let fields: LineFields;
      try {
        fields = JSON.parse(line) as LineFields;
      } catch {
        fields = { msg: line.trimEnd() };
      }
      const text = `${formatLine(fields)}\n`;
      if (opts.logFile) appendFileSync(opts.logFile, `${wallClock()} ${text}`);
      if (opts.stdout) process.stdout.write(text);
    },
  };
  const log = pino({ level: opts.level ?? 'info', base: undefined }, sink);

  const prefixed = (prefix: DaemonLogPrefix, msg: string) => {
    log.info({ prefix }, msg);
  };
  return {
    raw: (msg) => log.info(msg),
    prefixed,
    supervisor: (msg) => prefixed('supervisor', msg),
    machine: (msg) => prefixed('machine', msg),
    step: (msg) => prefixed('step', msg),
    workspace: (msg) => prefixed('workspace', msg),
    recover: (msg) => prefixed('recover', msg),
    wake: (msg) => prefixed('wake', msg),
    mcp: (msg) => prefixed('mcp', msg),
    skills: (msg) => prefixed('skills', msg),
    gate: (msg) => prefixed('gate', msg),
    trust: (msg) => prefixed('trust', msg),
  };
}
