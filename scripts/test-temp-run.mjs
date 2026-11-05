import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

const [separator, command, ...args] = process.argv.slice(2);
if (separator !== '--' || !command) {
  console.error('Usage: node scripts/test-temp-run.mjs -- <command> [args...]');
  process.exit(2);
}

const runId = randomUUID();
const root = join(process.env.CAIRN_TEST_TEMP_ROOT ?? tmpdir(), `cairn-test-${runId}-run`);
mkdirSync(root, { mode: 0o700 });
const report = join(root, 'allocations.jsonl');
writeFileSync(report, '', { flag: 'wx', mode: 0o600 });
const child = spawn(command, args, {
  env: {
    ...process.env,
    CAIRN_TEST_RUN_ID: runId,
    CAIRN_TEST_TEMP_STRICT: '1',
    CAIRN_TEST_TEMP_REPORT: report,
    CAIRN_TEST_TEMP_ROOT: root,
  },
  stdio: 'inherit',
  detached: true,
});
let finished = false;
let interrupted = false;
let terminationTimer;

function signalChild(signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function finish(code) {
  if (finished) return;
  finished = true;
  clearTimeout(terminationTimer);
  signalChild('SIGKILL');
  let failed = interrupted;
  const owned = new Set();
  try {
    const records = readFileSync(report, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    for (const record of records) {
      if (
        !record ||
        !['allocation', 'leak'].includes(record.kind) ||
        typeof record.path !== 'string' ||
        typeof record.runId !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(record.runId) ||
        dirname(record.path) !== root ||
        !basename(record.path).startsWith(`cairn-test-${record.runId}-`)
      )
        throw new Error('Invalid owned temporary allocation report');
      owned.add(record.path);
      if (record.kind === 'leak') {
        failed = true;
        console.error(`test-temp-run: survivor reclaimed by worker ${record.path}`);
      }
    }
  } catch {
    console.error('test-temp-run: allocation report inspection failed');
    failed = true;
  }
  try {
    rmSync(report, { force: true });
    for (const name of readdirSync(root)) {
      owned.add(join(root, name));
    }
    for (const path of owned) {
      if (!existsSync(path)) continue;
      failed = true;
      console.error(`test-temp-run: survivor ${path}`);
      rmSync(path, { recursive: true, force: true });
    }
    rmSync(root, { recursive: true, force: true });
  } catch {
    console.error('test-temp-run: survivor inspection or cleanup failed');
    failed = true;
  }
  process.exitCode = code || (failed ? 1 : 0);
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    interrupted = true;
    signalChild(signal);
    terminationTimer ??= setTimeout(() => signalChild('SIGKILL'), 1000);
  });
}
child.once('error', () => {
  console.error('test-temp-run: child failed to start');
  finish(1);
});
child.once('exit', (code) => finish(code ?? 1));
