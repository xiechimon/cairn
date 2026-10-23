#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const START_GRACE_MS = 500;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const USAGE = `Usage:
  node scripts/dispatch-agent.mjs start <id> [--cwd <dir>] -- <command> [args...]
  node scripts/dispatch-agent.mjs check <id>

start spawns the command in its own session (it survives the process-group
teardown that kills ( ... & ) / nohup jobs when a tool call returns), verifies
the process right away and writes <status-dir>/<id>.json. The default status
dir is $TMPDIR/cairn-dispatch; override with CAIRN_DISPATCH_STATUS_DIR.
Command output is written to <status-dir>/<id>.log. check re-verifies the
recorded pid and exits non-zero when the process is missing; run it before
reporting the state of a dispatched job instead of trusting impressions.`;

function isRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

const [subcommand, id, ...rest] = process.argv.slice(2);
const statusDir = process.env.CAIRN_DISPATCH_STATUS_DIR ?? join(tmpdir(), 'cairn-dispatch');

if ((subcommand !== 'start' && subcommand !== 'check') || !id || !ID_PATTERN.test(id)) {
  console.error(USAGE);
  process.exit(2);
}

if (subcommand === 'check') {
  if (rest.length > 0) {
    console.error(USAGE);
    process.exit(2);
  }
  const statusPath = join(statusDir, `${id}.json`);
  let record;
  try {
    record = JSON.parse(readFileSync(statusPath, 'utf8'));
  } catch {
    console.error(`dispatch ${id}: process missing (no status record)`);
    process.exit(1);
  }
  const alive = isRunning(record.pid);
  writeFileSync(
    statusPath,
    `${JSON.stringify({ ...record, alive, checkedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  if (!alive) {
    console.error(`dispatch ${id}: process missing (pid ${record.pid} not running)`);
    process.exit(1);
  }
  console.log(`dispatch ${id}: pid ${record.pid} alive (started ${record.startedAt})`);
  console.log(`log: ${record.log}`);
} else {
  const separator = rest.indexOf('--');
  const options = separator === -1 ? rest : rest.slice(0, separator);
  const command = separator === -1 ? [] : rest.slice(separator + 1);
  const cwd = options.length === 2 && options[0] === '--cwd' ? options[1] : undefined;
  if (command.length === 0 || command[0] === '' || (options.length > 0 && cwd === undefined)) {
    console.error(USAGE);
    process.exit(2);
  }
  const startedAt = new Date().toISOString();
  mkdirSync(statusDir, { recursive: true });
  const logPath = join(statusDir, `${id}.log`);
  const logFd = openSync(logPath, 'w');
  const child = spawn(command[0], command.slice(1), {
    cwd: cwd ?? process.cwd(),
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });
  child.once('error', () => {
    exited = true;
  });
  child.unref();
  await new Promise((resolve) => {
    setTimeout(resolve, START_GRACE_MS);
  });
  const alive = !exited && isRunning(child.pid);
  const record = {
    id,
    pid: child.pid ?? null,
    command: command.join(' '),
    cwd: cwd ?? process.cwd(),
    log: logPath,
    startedAt,
    alive,
    checkedAt: new Date().toISOString(),
  };
  writeFileSync(join(statusDir, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`);
  if (!alive) {
    console.error(`dispatch ${id}: process missing (pid ${record.pid} exited at start)`);
    process.exit(1);
  }
  console.log(`dispatch ${id}: pid ${record.pid} alive`);
  console.log(`status: ${join(statusDir, `${id}.json`)}`);
  console.log(`log: ${logPath}`);
}
