#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectTicketSources, findTicketConflicts } from './dispatch-dedupe.mjs';

const START_GRACE_MS = 500;
const WAIT_POLL_MS = 500;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SCRIPT = fileURLToPath(import.meta.url);
const USAGE = `Usage:
  node scripts/dispatch-agent.mjs start <id> [--cwd <dir>] [--ticket <N> [--force]] -- <command> [args...]
  node scripts/dispatch-agent.mjs check <id>
  node scripts/dispatch-agent.mjs wait <id> [--timeout-s <n>]

start spawns the command in its own session (it survives the process-group
teardown that kills ( ... & ) / nohup jobs when a tool call returns), verifies
the process right away and writes <status-dir>/<id>.json. The default status
dir is $TMPDIR/cairn-dispatch; override with CAIRN_DISPATCH_STATUS_DIR.
Command output is written to <status-dir>/<id>.log. check re-verifies the
recorded pid and exits non-zero when the process is missing; run it before
reporting the state of a dispatched job instead of trusting impressions.
wait polls until the process exits (or --timeout-s elapses). The detached
supervisor records the real exit code into the status file after start
returns, so a late non-zero exit cannot be reported as wait ok.

--ticket <N> refuses to start when ticket N already has work in flight: a git
workdir under the temp dirs named after it, an origin branch, an open PR in
xiechimon/cairn, or a running codex / pi / grok process mentioning it. Sources
that cannot be queried are reported as unchecked. --force starts anyway.`;

function isRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function readStatus(statusPath) {
  try {
    return JSON.parse(readFileSync(statusPath, 'utf8'));
  } catch {
    return null;
  }
}

function writeStatus(statusPath, record) {
  writeFileSync(statusPath, `${JSON.stringify(record, null, 2)}\n`);
}

const [subcommand, id, ...rest] = process.argv.slice(2);
const statusDir = process.env.CAIRN_DISPATCH_STATUS_DIR ?? join(tmpdir(), 'cairn-dispatch');

if (subcommand === 'record-exit') {
  const statusPath = id;
  const separator = rest.indexOf('--');
  const command = separator === -1 ? [] : rest.slice(separator + 1);
  if (!statusPath || command.length === 0 || command[0] === '') {
    console.error(USAGE);
    process.exit(2);
  }
  const cwd = process.env.CAIRN_DISPATCH_RECORD_CWD || process.cwd();
  const child = spawn(command[0], command.slice(1), {
    cwd,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  child.once('exit', (code, signal) => {
    const exitCode = code === null ? (signal ? 1 : 0) : code;
    const previous = readStatus(statusPath) ?? {};
    writeStatus(statusPath, {
      ...previous,
      exitCode,
      alive: false,
      checkedAt: new Date().toISOString(),
    });
    process.exit(exitCode);
  });
  child.once('error', () => {
    const previous = readStatus(statusPath) ?? {};
    writeStatus(statusPath, {
      ...previous,
      exitCode: 1,
      alive: false,
      checkedAt: new Date().toISOString(),
    });
    process.exit(1);
  });
} else if (
  (subcommand !== 'start' && subcommand !== 'check' && subcommand !== 'wait') ||
  !id ||
  !ID_PATTERN.test(id)
) {
  console.error(USAGE);
  process.exit(2);
} else if (subcommand === 'check') {
  if (rest.length > 0) {
    console.error(USAGE);
    process.exit(2);
  }
  const statusPath = join(statusDir, `${id}.json`);
  const record = readStatus(statusPath);
  if (!record) {
    console.error(`dispatch ${id}: process missing (no status record)`);
    process.exit(1);
  }
  const alive = isRunning(record.pid);
  writeStatus(statusPath, { ...record, alive, checkedAt: new Date().toISOString() });
  if (!alive) {
    console.error(`dispatch ${id}: process missing (pid ${record.pid} not running)`);
    process.exit(1);
  }
  console.log(`dispatch ${id}: pid ${record.pid} alive (started ${record.startedAt})`);
  console.log(`log: ${record.log}`);
} else if (subcommand === 'wait') {
  let timeoutSeconds;
  let optionsValid = true;
  for (let i = 0; i < rest.length && optionsValid; i++) {
    const option = rest[i];
    if (
      option === '--timeout-s' &&
      timeoutSeconds === undefined &&
      /^\d+$/.test(rest[i + 1] ?? '')
    ) {
      timeoutSeconds = Number(rest[++i]);
    } else {
      optionsValid = false;
    }
  }
  if (!optionsValid) {
    console.error(USAGE);
    process.exit(2);
  }
  const statusPath = join(statusDir, `${id}.json`);
  const startedWait = Date.now();
  let record = readStatus(statusPath);
  if (!record) {
    console.error(`dispatch ${id}: process missing (no status record)`);
    process.exit(1);
  }
  while (isRunning(record.pid)) {
    if (timeoutSeconds !== undefined && (Date.now() - startedWait) / 1000 >= timeoutSeconds) {
      console.error(`dispatch ${id}: still running after ${timeoutSeconds}s (pid ${record.pid})`);
      process.exit(1);
    }
    await new Promise((resolve) => {
      setTimeout(resolve, WAIT_POLL_MS);
    });
    record = readStatus(statusPath) ?? record;
  }
  for (let attempt = 0; attempt < 40 && typeof record.exitCode !== 'number'; attempt++) {
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    record = readStatus(statusPath) ?? record;
  }
  if (typeof record.exitCode !== 'number') {
    console.error(`dispatch ${id}: wait failed: child exited without a recorded exit code`);
    console.error(`log: ${record.log}`);
    process.exit(1);
  }
  const endedAt = new Date().toISOString();
  const startedMs = Date.parse(record.startedAt);
  const durationSeconds = Number.isFinite(startedMs)
    ? Math.max(0, (Date.parse(endedAt) - startedMs) / 1000)
    : Number.NaN;
  writeStatus(statusPath, {
    ...record,
    alive: false,
    checkedAt: endedAt,
    endedAt,
    durationSeconds,
  });
  if (record.exitCode !== 0) {
    console.error(`dispatch ${id}: wait failed: child exited ${record.exitCode}`);
    console.error(`log: ${record.log}`);
    process.exit(1);
  }
  console.log(`dispatch ${id}: wait ok after ${durationSeconds}s`);
  console.log(`log: ${record.log}`);
} else {
  const separator = rest.indexOf('--');
  const options = separator === -1 ? rest : rest.slice(0, separator);
  const command = separator === -1 ? [] : rest.slice(separator + 1);
  let cwd;
  let ticket;
  let force = false;
  let optionsValid = true;
  for (let i = 0; i < options.length && optionsValid; i++) {
    const option = options[i];
    if (option === '--force' && !force) force = true;
    else if (option === '--cwd' && cwd === undefined && options[i + 1]) cwd = options[++i];
    else if (option === '--ticket' && ticket === undefined && /^\d+$/.test(options[i + 1] ?? ''))
      ticket = options[++i];
    else optionsValid = false;
  }
  if (
    command.length === 0 ||
    command[0] === '' ||
    !optionsValid ||
    (force && ticket === undefined)
  ) {
    console.error(USAGE);
    process.exit(2);
  }
  if (ticket !== undefined) {
    const { conflicts, unchecked } = findTicketConflicts(
      collectTicketSources(ticket, cwd ?? process.cwd()),
    );
    for (const { source } of unchecked) {
      console.error(`dispatch ${id}: ticket #${ticket} ${source} unchecked (query failed)`);
    }
    if (conflicts.length > 0) {
      const lines = conflicts.map(({ source, detail }) => `  [${source}] ${detail}`);
      if (!force) {
        console.error(
          [
            `dispatch ${id}: ticket #${ticket} already has work in flight:`,
            ...lines,
            'refusing to start; pass --force to start anyway',
          ].join('\n'),
        );
        process.exit(1);
      }
      console.error(
        [`dispatch ${id}: ticket #${ticket} conflicts overridden by --force:`, ...lines].join('\n'),
      );
    }
  }
  const startedAt = new Date().toISOString();
  mkdirSync(statusDir, { recursive: true });
  const logPath = join(statusDir, `${id}.log`);
  const statusPath = join(statusDir, `${id}.json`);
  const logFd = openSync(logPath, 'w');
  const workCwd = cwd ?? process.cwd();
  writeStatus(statusPath, {
    id,
    pid: null,
    command: command.join(' '),
    cwd: workCwd,
    log: logPath,
    startedAt,
    alive: false,
    checkedAt: startedAt,
  });
  const child = spawn(process.execPath, [SCRIPT, 'record-exit', statusPath, '--', ...command], {
    cwd: workCwd,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, CAIRN_DISPATCH_RECORD_CWD: workCwd },
  });
  let exited = false;
  let exitCode = null;
  child.once('exit', (code, signal) => {
    exited = true;
    exitCode = code === null ? (signal ? 1 : 0) : code;
    const previous = readStatus(statusPath) ?? {};
    writeStatus(statusPath, {
      ...previous,
      id,
      pid: child.pid ?? previous.pid ?? null,
      exitCode,
      alive: false,
      checkedAt: new Date().toISOString(),
    });
  });
  child.once('error', () => {
    exited = true;
    exitCode = 1;
  });
  child.unref();
  await new Promise((resolve) => {
    setTimeout(resolve, START_GRACE_MS);
  });
  const alive = !exited && isRunning(child.pid);
  const record = {
    ...(readStatus(statusPath) ?? {}),
    id,
    pid: child.pid ?? null,
    command: command.join(' '),
    cwd: workCwd,
    log: logPath,
    startedAt,
    alive,
    checkedAt: new Date().toISOString(),
    ...(exitCode === null ? {} : { exitCode }),
  };
  writeStatus(statusPath, record);
  if (!alive) {
    console.error(`dispatch ${id}: process missing (pid ${record.pid} exited at start)`);
    process.exit(1);
  }
  console.log(`dispatch ${id}: pid ${record.pid} alive`);
  console.log(`status: ${statusPath}`);
  console.log(`log: ${logPath}`);
}
