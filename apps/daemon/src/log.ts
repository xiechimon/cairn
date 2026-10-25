import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DAEMON_LOG_PREFIXES } from '@cairn/shared';
import pino from 'pino';

export type DaemonLogPrefix = (typeof DAEMON_LOG_PREFIXES)[number];

export interface DaemonLogger {
  raw(msg: string): void;
  prefixed(prefix: DaemonLogPrefix, msg: string): void;
  supervisor(msg: string): void;
  machine(msg: string): void;
  step(msg: string): void;
  workspace(msg: string): void;
  recover(msg: string): void;
  wake(msg: string): void;
  mcp(msg: string): void;
  skills(msg: string): void;
  gate(msg: string): void;
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
