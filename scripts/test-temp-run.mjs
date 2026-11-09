import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createTempEnvironment } from '../packages/shared/src/node/temp-environment.ts';
import { spawnOwned } from './owned-process.mjs';

const [separator, command, ...args] = process.argv.slice(2);
if (separator !== '--' || !command) {
  console.error('Usage: node scripts/test-temp-run.mjs -- <command> [args...]');
  process.exit(2);
}

const runId = randomUUID();
const temporary = createTempEnvironment();
const root = temporary.root;
const report = join(root, 'allocations.jsonl');
writeFileSync(report, '', { flag: 'wx', mode: 0o600 });
const owned = spawnOwned(command, args, {
  env: {
    ...process.env,
    ...temporary.env,
    CAIRN_TEST_RUN_ID: runId,
    CAIRN_TEST_TEMP_STRICT: '1',
    CAIRN_TEST_TEMP_REPORT: report,
    CAIRN_TEST_TEMP_ROOT: root,
  },
  stdio: 'inherit',
  name: 'test-temp-run',
  graceMs: 1_000,
});
let interrupted = false;

function finish(code) {
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
        !basename(record.path).startsWith(`ct-${record.runId.slice(0, 8)}-`)
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
    temporary.cleanup();
  } catch {
    console.error('test-temp-run: survivor inspection or cleanup failed');
    failed = true;
  }
  process.exitCode = code || (failed ? 1 : 0);
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    interrupted = true;
    owned.stop();
  });
}
const { code, error } = await owned.exited;
if (error) console.error('test-temp-run: child failed to start');
finish(error ? 1 : (code ?? 1));
